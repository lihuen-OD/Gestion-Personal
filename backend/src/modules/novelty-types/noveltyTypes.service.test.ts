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
    origin: "INTERNA",
    status: "ACTIVO",
    exportsToFinnegans: false,
    requiresApproval: true,
    requiresDocumentation: false,
    allowsHours: false,
    allowsDateTo: true,
    hasValidity: true,
    blocksTimeEntry: false,
    setsWorkedHoursToZero: false,
    timeImpact: "NO_AFECTA_HORAS",
    allowedLoadRoles: [],
    approvalRoles: [],
    finnegansLinks: [],
    ...overrides,
  } as CreateNoveltyTypeInput;
}

// Etapa 15L.2A (docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md):
// el módulo no tenía tests de create/update hasta esta etapa (sólo de
// repository/controller) -- se agregan acá porque es donde vive la
// sincronización nueva (aplicada antes de llegar al repositorio).
describe("noveltyTypesService.create — Etapa 15L.2A", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.create.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Vacaciones" });
  });

  it("sincroniza el modelo nuevo desde el legacy antes de llamar al repositorio", async () => {
    await noveltyTypesService.create(createInput({ blocksTimeEntry: true }));

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        timeEntryBehavior: "BLOQUEA_NUEVA_CARGA",
        blocksTimeEntry: true,
        setsWorkedHoursToZero: false,
        timeImpact: "BLOQUEA_CARGA_DIA",
      }),
    );
  });

  it("persiste notes tal cual (antes no existía en el modelo)", async () => {
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
// si el tipo exporta a Finnegans, exige vínculo (código+nombre) y unidad de
// Valor 1 -- antes 15L.2A dejaba esto sin exigir para no romper el
// frontend viejo, que todavía no tenía UI para elegir la unidad.
describe("noveltyTypesService.create — Etapa 15L.2B (coherencia Finnegans)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.create.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Vacaciones" });
  });

  it("exportsToFinnegans=false no exige ningún vínculo ni unidad", async () => {
    await expect(noveltyTypesService.create(createInput({ exportsToFinnegans: false }))).resolves.toBeDefined();
  });

  it("exportsToFinnegans=true sin vínculos rechaza (NOVELTY_TYPE_FINNEGANS_LINK_REQUIRED)", async () => {
    await expect(
      noveltyTypesService.create(createInput({ exportsToFinnegans: true, finnegansLinks: [] })),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TYPE_FINNEGANS_LINK_REQUIRED" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("exportsToFinnegans=true con vínculo pero sin finnegansValueUnit rechaza (NOVELTY_TYPE_FINNEGANS_VALUE_UNIT_REQUIRED)", async () => {
    await expect(
      noveltyTypesService.create(
        createInput({
          exportsToFinnegans: true,
          finnegansLinks: [{ code: "VAC", name: "Vacaciones", exportConcept: "", priority: 1, status: "ACTIVO", hasValidity: false, notes: null }],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TYPE_FINNEGANS_VALUE_UNIT_REQUIRED" });
  });

  // Etapa 15L.2B.1: allowsHours=true NO alcanza para satisfacer el
  // requisito de unidad -- confirma que la decisión de exportación no se
  // infiere de la capacidad operativa, hay que mandar finnegansValueUnit
  // explícito.
  it("exportsToFinnegans=true con vínculo y allowsHours=true, pero SIN finnegansValueUnit explícito, sigue rechazando", async () => {
    await expect(
      noveltyTypesService.create(
        createInput({
          exportsToFinnegans: true,
          allowsHours: true,
          finnegansLinks: [{ code: "VAC", name: "Vacaciones", exportConcept: "", priority: 1, status: "ACTIVO", hasValidity: false, notes: null }],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TYPE_FINNEGANS_VALUE_UNIT_REQUIRED" });
  });

  it("exportsToFinnegans=true con vínculo y finnegansValueUnit explícito se crea sin error, sin importar allowsHours", async () => {
    await expect(
      noveltyTypesService.create(
        createInput({
          exportsToFinnegans: true,
          allowsHours: false,
          finnegansValueUnit: "UNIT",
          finnegansLinks: [{ code: "VAC", name: "Vacaciones", exportConcept: "", priority: 1, status: "ACTIVO", hasValidity: false, notes: null }],
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe("noveltyTypesService.update — Etapa 15L.2A", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.update.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Vacaciones" });
    repo.findById.mockResolvedValue({ exportsToFinnegans: false, finnegansValueUnit: null, finnegansLinks: [] });
  });

  it("un PATCH que sólo cambia name no toca ninguno de los campos sincronizables", async () => {
    const patch: UpdateNoveltyTypeInput = { name: "Vacaciones anuales" };
    await noveltyTypesService.update("nt-1", patch);

    const call = repo.update.mock.calls[0]![1];
    expect(call).toEqual({ name: "Vacaciones anuales" });
  });

  it("un PATCH que manda timeEntryBehavior fuerza los 3 legacy, incluso si el mismo PATCH manda otro valor contradictorio", async () => {
    await noveltyTypesService.update("nt-1", { timeEntryBehavior: "BLOQUEA_NUEVA_CARGA", timeImpact: "NO_AFECTA_HORAS" } as UpdateNoveltyTypeInput);

    expect(repo.update).toHaveBeenCalledWith(
      "nt-1",
      expect.objectContaining({ timeEntryBehavior: "BLOQUEA_NUEVA_CARGA", blocksTimeEntry: true, setsWorkedHoursToZero: false, timeImpact: "BLOQUEA_CARGA_DIA" }),
    );
  });

  it("un PATCH que sólo manda allowsDateTo (legacy) sincroniza allowsDateRange", async () => {
    await noveltyTypesService.update("nt-1", { allowsDateTo: false } as UpdateNoveltyTypeInput);

    expect(repo.update).toHaveBeenCalledWith("nt-1", expect.objectContaining({ allowsDateRange: false, allowsDateTo: false }));
  });
});

// Etapa 15L.2B: la validación de coherencia Finnegans en update() mira el
// estado RESULTANTE (fila actual + patch) -- un PATCH que no toca
// exportsToFinnegans/finnegansValueUnit/finnegansLinks no debe fallar ni
// tampoco debe dejar pasar una fila que YA exporta sin vínculo/unidad si el
// patch intenta apagar justo lo que la hacía válida.
describe("noveltyTypesService.update — Etapa 15L.2B (coherencia Finnegans)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.update.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Vacaciones" });
  });

  it("un PATCH que no toca nada de Finnegans no exige nada, aunque la fila actual no exporte", async () => {
    repo.findById.mockResolvedValue({ exportsToFinnegans: false, finnegansValueUnit: null, finnegansLinks: [] });

    await expect(noveltyTypesService.update("nt-1", { name: "Vacaciones anuales" } as UpdateNoveltyTypeInput)).resolves.toBeDefined();
  });

  it("un PATCH que sólo prende exportsToFinnegans, con la fila actual sin vínculo, rechaza", async () => {
    repo.findById.mockResolvedValue({ exportsToFinnegans: false, finnegansValueUnit: null, finnegansLinks: [] });

    await expect(
      noveltyTypesService.update("nt-1", { exportsToFinnegans: true } as UpdateNoveltyTypeInput),
    ).rejects.toMatchObject({ code: "NOVELTY_TYPE_FINNEGANS_LINK_REQUIRED" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("un PATCH que sólo cambia name, con la fila actual ya exportando correctamente, no exige nada de nuevo", async () => {
    repo.findById.mockResolvedValue({
      exportsToFinnegans: true,
      finnegansValueUnit: "HOURS",
      finnegansLinks: [{ code: "VAC", name: "Vacaciones" }],
    });

    await expect(noveltyTypesService.update("nt-1", { name: "Vacaciones anuales" } as UpdateNoveltyTypeInput)).resolves.toBeDefined();
  });
});
