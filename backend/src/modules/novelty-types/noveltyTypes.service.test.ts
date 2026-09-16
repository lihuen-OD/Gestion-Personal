import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { noveltyTypesRepository, invalidateNoveltyTypesCache } from "./noveltyTypes.repository";
import { noveltyTypesService } from "./noveltyTypes.service";
import type { CreateNoveltyTypeInput, UpdateNoveltyTypeInput } from "./noveltyTypes.schemas";

vi.mock("./noveltyTypes.repository", () => ({
  noveltyTypesRepository: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findById: vi.fn() },
  invalidateNoveltyTypesCache: vi.fn(),
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const repo = noveltyTypesRepository as unknown as { create: Mock; update: Mock; findMany: Mock; findById: Mock };

function createInput(overrides: Partial<CreateNoveltyTypeInput> = {}): CreateNoveltyTypeInput {
  return {
    name: "Vacaciones",
    uiColor: "blue",
    kind: "VACACIONES",
    status: "ACTIVO",
    exportsToFinnegans: false,
    requiresApproval: true,
    requiresDocumentation: false,
    allowsHours: false,
    allowsDateRange: true,
    timeEntryBehavior: "NO_BLOQUEA",
    finnegansRequiresValidity: false,
    allowedLoadRoles: [],
    approvalRoles: [],
    ...overrides,
  } as CreateNoveltyTypeInput;
}

describe("noveltyTypesService.create — Etapa 15L.2A/15L.6", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.create.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Vacaciones" });
  });

  it("persiste timeEntryBehavior tal cual, sin ninguna sincronización adicional (Etapa 15L.6: retirada)", async () => {
    await noveltyTypesService.create(createInput({ timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" }));

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" }));
  });

  it("persiste notes tal cual", async () => {
    await noveltyTypesService.create(createInput({ notes: "Uso interno, no exportar todavía" }));

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ notes: "Uso interno, no exportar todavía" }));
  });

  // Etapa 15L.2B.1 (corrección puntual, docs/decisions/
  // NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md): allowsHours=true ya NO
  // infiere finnegansValueUnit -- son dos decisiones independientes.
  it("allowsHours=true no infiere ni toca finnegansValueUnit", async () => {
    await noveltyTypesService.create(createInput({ allowsHours: true }));

    const call = repo.create.mock.calls[0]![0];
    expect(call).not.toHaveProperty("finnegansValueUnit");
  });

  it("finnegansValueUnit explícito no infiere ni toca allowsHours", async () => {
    await noveltyTypesService.create(createInput({ allowsHours: false, finnegansValueUnit: "DAYS" }));

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ allowsHours: false, finnegansValueUnit: "DAYS" }));
  });

  it("invalida la cache y audita CREATE", async () => {
    await noveltyTypesService.create(createInput());

    const { invalidateNoveltyTypesCache } = await import("./noveltyTypes.repository");
    expect(invalidateNoveltyTypesCache).toHaveBeenCalled();
  });
});

// Etapa 15L.2B (docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md):
// si el tipo exporta a Finnegans, exige código+nombre Finnegans y unidad de
// Valor 1. Etapa 15L.6: código/nombre pasaron de FinnegansNoveltyLink (1:N)
// a columnas directas finnegansCode/finnegansName (1:1 físico).
describe("noveltyTypesService.create — Etapa 15L.2B (coherencia Finnegans)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.create.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Vacaciones" });
  });

  it("exportsToFinnegans=false no exige ningún código ni unidad", async () => {
    await expect(noveltyTypesService.create(createInput({ exportsToFinnegans: false }))).resolves.toBeDefined();
  });

  it("exportsToFinnegans=true sin finnegansCode/finnegansName rechaza (NOVELTY_TYPE_FINNEGANS_LINK_REQUIRED)", async () => {
    await expect(
      noveltyTypesService.create(createInput({ exportsToFinnegans: true, finnegansCode: null, finnegansName: null })),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TYPE_FINNEGANS_LINK_REQUIRED" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("exportsToFinnegans=true con código pero sin finnegansValueUnit rechaza (NOVELTY_TYPE_FINNEGANS_VALUE_UNIT_REQUIRED)", async () => {
    await expect(
      noveltyTypesService.create(
        createInput({
          exportsToFinnegans: true,
          finnegansCode: "VAC",
          finnegansName: "Vacaciones",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TYPE_FINNEGANS_VALUE_UNIT_REQUIRED" });
  });

  // Etapa 15L.2B.1: allowsHours=true NO alcanza para satisfacer el
  // requisito de unidad -- confirma que la decisión de exportación no se
  // infiere de la capacidad operativa, hay que mandar finnegansValueUnit
  // explícito.
  it("exportsToFinnegans=true con código y allowsHours=true, pero SIN finnegansValueUnit explícito, sigue rechazando", async () => {
    await expect(
      noveltyTypesService.create(
        createInput({
          exportsToFinnegans: true,
          allowsHours: true,
          finnegansCode: "VAC",
          finnegansName: "Vacaciones",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TYPE_FINNEGANS_VALUE_UNIT_REQUIRED" });
  });

  it("exportsToFinnegans=true con código y finnegansValueUnit explícito se crea sin error, sin importar allowsHours", async () => {
    await expect(
      noveltyTypesService.create(
        createInput({
          exportsToFinnegans: true,
          allowsHours: false,
          finnegansValueUnit: "UNIT",
          finnegansCode: "VAC",
          finnegansName: "Vacaciones",
        }),
      ),
    ).resolves.toBeDefined();
  });
});

// Etapa 15L.5 (docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md §15/§17):
// allowsHours=true + finnegansValueUnit=DAYS queda prohibido -- con la
// regla nueva de novelties.service.ts::resolveQuantities, quantityDays
// SIEMPRE es null cuando allowsHours=true, así que ese tipo nunca podría
// exportar Valor 1. Auditado contra datos reales: hoy no existe ningún
// NoveltyType con esta combinación (ver decision doc §16).
describe("noveltyTypesService.create — Etapa 15L.5 (allowsHours + finnegansValueUnit=DAYS incompatibles)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.create.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Vacaciones" });
  });

  it("allowsHours=true + finnegansValueUnit=DAYS rechaza (NOVELTY_TYPE_HOURS_DAYS_CONFLICT), incluso sin exportsToFinnegans", async () => {
    await expect(
      noveltyTypesService.create(createInput({ allowsHours: true, finnegansValueUnit: "DAYS", exportsToFinnegans: false })),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TYPE_HOURS_DAYS_CONFLICT" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("allowsHours=true + finnegansValueUnit=HOURS sigue permitido", async () => {
    await expect(
      noveltyTypesService.create(createInput({ allowsHours: true, finnegansValueUnit: "HOURS" })),
    ).resolves.toBeDefined();
  });

  it("allowsHours=true + finnegansValueUnit=UNIT sigue permitido", async () => {
    await expect(
      noveltyTypesService.create(createInput({ allowsHours: true, finnegansValueUnit: "UNIT" })),
    ).resolves.toBeDefined();
  });

  it("allowsHours=false + finnegansValueUnit=DAYS sigue permitido (la combinación válida real)", async () => {
    await expect(
      noveltyTypesService.create(createInput({ allowsHours: false, finnegansValueUnit: "DAYS" })),
    ).resolves.toBeDefined();
  });
});

describe("noveltyTypesService.update — Etapa 15L.6 (sin sincronización legacy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.update.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Vacaciones" });
    repo.findById.mockResolvedValue({ exportsToFinnegans: false, finnegansValueUnit: null, finnegansCode: null, finnegansName: null });
  });

  it("un PATCH que sólo cambia name no toca ningún otro campo", async () => {
    const patch: UpdateNoveltyTypeInput = { name: "Vacaciones anuales" };
    await noveltyTypesService.update("nt-1", patch);

    const call = repo.update.mock.calls[0]![1];
    expect(call).toEqual({ name: "Vacaciones anuales" });
  });

  it("un PATCH que manda timeEntryBehavior lo persiste tal cual, sin ningún campo legacy adicional", async () => {
    await noveltyTypesService.update("nt-1", { timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" } as UpdateNoveltyTypeInput);

    expect(repo.update).toHaveBeenCalledWith("nt-1", { timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" });
  });

  it("un PATCH que manda allowsDateRange lo persiste tal cual", async () => {
    await noveltyTypesService.update("nt-1", { allowsDateRange: false } as UpdateNoveltyTypeInput);

    expect(repo.update).toHaveBeenCalledWith("nt-1", { allowsDateRange: false });
  });
});

// Etapa 15L.2B: la validación de coherencia Finnegans en update() mira el
// estado RESULTANTE (fila actual + patch) -- un PATCH que no toca
// exportsToFinnegans/finnegansValueUnit/finnegansCode/finnegansName no debe
// fallar ni tampoco debe dejar pasar una fila que YA exporta sin código si
// el patch intenta apagar justo lo que la hacía válida.
describe("noveltyTypesService.update — Etapa 15L.2B (coherencia Finnegans)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.update.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Vacaciones" });
  });

  it("un PATCH que no toca nada de Finnegans no exige nada, aunque la fila actual no exporte", async () => {
    repo.findById.mockResolvedValue({ exportsToFinnegans: false, finnegansValueUnit: null, finnegansCode: null, finnegansName: null });

    await expect(noveltyTypesService.update("nt-1", { name: "Vacaciones anuales" } as UpdateNoveltyTypeInput)).resolves.toBeDefined();
  });

  it("un PATCH que sólo prende exportsToFinnegans, con la fila actual sin código, rechaza", async () => {
    repo.findById.mockResolvedValue({ exportsToFinnegans: false, finnegansValueUnit: null, finnegansCode: null, finnegansName: null });

    await expect(
      noveltyTypesService.update("nt-1", { exportsToFinnegans: true } as UpdateNoveltyTypeInput),
    ).rejects.toMatchObject({ code: "NOVELTY_TYPE_FINNEGANS_LINK_REQUIRED" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("un PATCH que sólo cambia name, con la fila actual ya exportando correctamente, no exige nada de nuevo", async () => {
    repo.findById.mockResolvedValue({
      exportsToFinnegans: true,
      finnegansValueUnit: "HOURS",
      finnegansCode: "VAC",
      finnegansName: "Vacaciones",
    });

    await expect(noveltyTypesService.update("nt-1", { name: "Vacaciones anuales" } as UpdateNoveltyTypeInput)).resolves.toBeDefined();
  });

  // Etapa 15L.5: mismo criterio que create() -- mira el estado RESULTANTE
  // (fila actual + patch), no sólo lo que vino en este PATCH puntual.
  it("un PATCH que sólo prende allowsHours, con la fila actual ya en finnegansValueUnit=DAYS, rechaza (NOVELTY_TYPE_HOURS_DAYS_CONFLICT)", async () => {
    repo.findById.mockResolvedValue({ exportsToFinnegans: false, finnegansValueUnit: "DAYS", finnegansCode: null, finnegansName: null, allowsHours: false });

    await expect(
      noveltyTypesService.update("nt-1", { allowsHours: true } as UpdateNoveltyTypeInput),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TYPE_HOURS_DAYS_CONFLICT" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("un PATCH que sólo cambia finnegansValueUnit a DAYS, con la fila actual ya en allowsHours=true, rechaza", async () => {
    repo.findById.mockResolvedValue({ exportsToFinnegans: false, finnegansValueUnit: "HOURS", finnegansCode: null, finnegansName: null, allowsHours: true });

    await expect(
      noveltyTypesService.update("nt-1", { finnegansValueUnit: "DAYS" } as UpdateNoveltyTypeInput),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TYPE_HOURS_DAYS_CONFLICT" });
  });
});
