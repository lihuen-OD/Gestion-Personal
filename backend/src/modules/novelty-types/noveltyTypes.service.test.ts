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

  it("infiere finnegansValueUnit=HOURS cuando allowsHours=true y no vino el campo nuevo", async () => {
    await noveltyTypesService.create(createInput({ allowsHours: true }));

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ finnegansValueUnit: "HOURS" }));
  });

  it("invalida la cache y audita CREATE", async () => {
    await noveltyTypesService.create(createInput());

    const { invalidateNoveltyTypesCache } = await import("./noveltyTypes.repository");
    expect(invalidateNoveltyTypesCache).toHaveBeenCalled();
  });
});

describe("noveltyTypesService.update — Etapa 15L.2A", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.update.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Vacaciones" });
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
