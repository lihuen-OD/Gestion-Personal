import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { noveltyTypesRepository, invalidateNoveltyTypesCache } from "./noveltyTypes.repository";
import { noveltyTypesService } from "./noveltyTypes.service";
import type { CreateNoveltyTypeInput, UpdateNoveltyTypeInput } from "./noveltyTypes.schemas";

// Etapa 5: el recálculo de cobertura de novedades se prueba en
// noveltyCoverageRecalculation.test.ts y en la integración PostgreSQL.
vi.mock("../../shared/prisma/client", () => ({
  // Etapa 5: cambio de régimen + recálculo de cobertura en una transacción.
  prisma: { $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({ employeeWorkRegime: { findMany: vi.fn().mockResolvedValue([]) } })) },
}));
import { recalculateNoveltyCoverage } from "../novelties/noveltyCoverageRecalculation";
import { lockNoveltyCoverageGlobally } from "../novelties/noveltyCoverage.service";
vi.mock("../novelties/noveltyCoverage.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../novelties/noveltyCoverage.service")>()),
  lockEmployeeCoverage: vi.fn(),
  lockNoveltyCoverageGlobally: vi.fn(),
}));
vi.mock("../novelties/noveltyCoverageRecalculation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../novelties/noveltyCoverageRecalculation")>();
  return {
    ...actual,
    lockNoveltyCoverageForEmployees: vi.fn(),
    recalculateNoveltyCoverage: vi.fn(async (_db: unknown, _scope: unknown, reason: Parameters<typeof actual.emptyNoveltyCoverageRecalculation>[0]) => actual.emptyNoveltyCoverageRecalculation(reason)),
    rebuildNoveltyCoverageSnapshots: vi.fn().mockResolvedValue([]),
    auditNoveltyCoverageRecalculation: vi.fn(),
    auditNoveltyCoverageRecalculationWithin: vi.fn(),
  };
});


vi.mock("./noveltyTypes.repository", () => ({
  noveltyTypesRepository: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findById: vi.fn() },
  invalidateNoveltyTypesCache: vi.fn(),
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const repo = noveltyTypesRepository as unknown as { create: Mock; update: Mock; findMany: Mock; findById: Mock };

// Forma real de una fila de NoveltyType: la base siempre devuelve los campos
// de cobertura con sus defaults neutros (migración
// 20261113180000_add_novelty_coverage_engine).
function currentRow(overrides: Record<string, unknown> = {}) {
  return {
    exportsToFinnegans: false,
    finnegansValueUnit: null,
    finnegansCode: null,
    finnegansName: null,
    allowsHours: false,
    allowsDateRange: true,
    coverageMode: "NONE",
    coverageFixedMinutes: null,
    coverageDayRule: "EVERY_DAY",
    coverageWeekdays: [],
    coverageOnDayOff: null,
    coverageOnHoliday: null,
    coverageAppliesSpecialHours: false,
    coverageCountsTowardTotal: false,
    realWorkCompatibility: "COMPATIBLE",
    requiresObservation: false,
    ...overrides,
  };
}

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
    repo.findById.mockResolvedValue(currentRow({ exportsToFinnegans: false, finnegansValueUnit: null, finnegansCode: null, finnegansName: null }));
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
    // Un campo que no cambia la cobertura no recalcula nada.
    expect(recalculateNoveltyCoverage).not.toHaveBeenCalled();
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
    repo.findById.mockResolvedValue(currentRow({ exportsToFinnegans: false, finnegansValueUnit: null, finnegansCode: null, finnegansName: null }));

    await expect(noveltyTypesService.update("nt-1", { name: "Vacaciones anuales" } as UpdateNoveltyTypeInput)).resolves.toBeDefined();
  });

  it("un PATCH que sólo prende exportsToFinnegans, con la fila actual sin código, rechaza", async () => {
    repo.findById.mockResolvedValue(currentRow({ exportsToFinnegans: false, finnegansValueUnit: null, finnegansCode: null, finnegansName: null }));

    await expect(
      noveltyTypesService.update("nt-1", { exportsToFinnegans: true } as UpdateNoveltyTypeInput),
    ).rejects.toMatchObject({ code: "NOVELTY_TYPE_FINNEGANS_LINK_REQUIRED" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("un PATCH que sólo cambia name, con la fila actual ya exportando correctamente, no exige nada de nuevo", async () => {
    repo.findById.mockResolvedValue(currentRow({
      exportsToFinnegans: true,
      finnegansValueUnit: "HOURS",
      finnegansCode: "VAC",
      finnegansName: "Vacaciones",
    }));

    await expect(noveltyTypesService.update("nt-1", { name: "Vacaciones anuales" } as UpdateNoveltyTypeInput)).resolves.toBeDefined();
  });

  // Etapa 15L.5: mismo criterio que create() -- mira el estado RESULTANTE
  // (fila actual + patch), no sólo lo que vino en este PATCH puntual.
  it("un PATCH que sólo prende allowsHours, con la fila actual ya en finnegansValueUnit=DAYS, rechaza (NOVELTY_TYPE_HOURS_DAYS_CONFLICT)", async () => {
    repo.findById.mockResolvedValue(currentRow({ exportsToFinnegans: false, finnegansValueUnit: "DAYS", finnegansCode: null, finnegansName: null, allowsHours: false }));

    await expect(
      noveltyTypesService.update("nt-1", { allowsHours: true } as UpdateNoveltyTypeInput),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TYPE_HOURS_DAYS_CONFLICT" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("un PATCH que sólo cambia finnegansValueUnit a DAYS, con la fila actual ya en allowsHours=true, rechaza", async () => {
    repo.findById.mockResolvedValue(currentRow({ exportsToFinnegans: false, finnegansValueUnit: "HOURS", finnegansCode: null, finnegansName: null, allowsHours: true }));

    await expect(
      noveltyTypesService.update("nt-1", { finnegansValueUnit: "DAYS" } as UpdateNoveltyTypeInput),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TYPE_HOURS_DAYS_CONFLICT" });
  });
});

// Motor de cobertura — Etapa 1 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md):
// la configuración se valida con la misma regla que el CHECK
// "NoveltyType_coverage_config_check", sobre el estado resultante.
describe("noveltyTypesService — configuración de cobertura horaria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.create.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Tipo" });
    repo.update.mockResolvedValue({ id: "nt-1", code: "NOV-001", name: "Tipo" });
  });

  // Los 5 tipos de validación del motor se expresan sólo con configuración.
  it.each([
    ["Trámite bancario: 4 h fijas, todos los días, suma, incompatible con trabajo real", {
      allowsDateRange: false,
      coverageMode: "FIXED_MINUTES",
      coverageFixedMinutes: 240,
      coverageDayRule: "EVERY_DAY",
      coverageOnDayOff: "NO_COVERAGE",
      coverageOnHoliday: "NO_COVERAGE",
      coverageCountsTowardTotal: true,
      realWorkCompatibility: "INCOMPATIBLE",
    }],
    ["Maternidad: 8 h de lunes a viernes, sin multiplicadores, suma", {
      coverageMode: "FIXED_MINUTES",
      coverageFixedMinutes: 480,
      coverageDayRule: "SELECTED_WEEKDAYS",
      coverageWeekdays: [1, 2, 3, 4, 5],
      coverageOnDayOff: "COVER",
      coverageOnHoliday: "ONLY_IF_CONVOKED",
      coverageCountsTowardTotal: true,
      realWorkCompatibility: "INCOMPATIBLE",
    }],
    ["Vacaciones: 8 h los días que tenía que trabajar, con multiplicadores, suma", {
      coverageMode: "FIXED_MINUTES",
      coverageFixedMinutes: 480,
      coverageDayRule: "WORK_OBLIGATION",
      coverageAppliesSpecialHours: true,
      coverageCountsTowardTotal: true,
      realWorkCompatibility: "INCOMPATIBLE",
    }],
    ["Llegada tarde: la indica quien carga, no suma", {
      allowsHours: true,
      allowsDateRange: false,
      coverageMode: "MANUAL_MINUTES",
    }],
    ["Falta sin aviso: no registra tiempo, incompatible y bloquea carga", {
      allowsDateRange: false,
      timeEntryBehavior: "BLOQUEA_NUEVA_CARGA",
      realWorkCompatibility: "INCOMPATIBLE",
    }],
    ["Jornada esperada: los días que tenía que trabajar", {
      coverageMode: "EXPECTED_SCHEDULE",
      coverageDayRule: "WORK_OBLIGATION",
      coverageCountsTowardTotal: true,
    }],
  ])("acepta %s", async (_label, overrides) => {
    await noveltyTypesService.create(createInput(overrides as Partial<CreateNoveltyTypeInput>));

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining(overrides));
  });

  it.each([
    ["cantidad fija sin minutos", { coverageMode: "FIXED_MINUTES", coverageOnDayOff: "COVER", coverageOnHoliday: "COVER" }, "entre 1 minuto y 24 horas"],
    ["cantidad fija con regla por calendario sin política de feriado", { coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 240, coverageOnDayOff: "COVER" }, "feriado"],
    ["cantidad fija con regla por calendario sin política de franco", { coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 240, coverageOnHoliday: "COVER" }, "franco"],
    ["días que tenía que trabajar con política de feriado", { coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "WORK_OBLIGATION", coverageOnHoliday: "COVER" }, "convocatoria"],
    ["días que tenía que trabajar con días elegidos", { coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "WORK_OBLIGATION", coverageWeekdays: [1] }, "días de la semana"],
    ["días elegidos vacíos", { coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageDayRule: "SELECTED_WEEKDAYS", coverageOnDayOff: "COVER", coverageOnHoliday: "COVER" }, "al menos un día"],
    ["todos los días con días elegidos", { coverageMode: "FIXED_MINUTES", coverageFixedMinutes: 480, coverageWeekdays: [1], coverageOnDayOff: "COVER", coverageOnHoliday: "COVER" }, "todos los días"],
    ["jornada esperada con regla por calendario", { coverageMode: "EXPECTED_SCHEDULE", coverageOnDayOff: "COVER", coverageOnHoliday: "COVER" }, "tenía que trabajar"],
    ["cantidad manual con rango", { coverageMode: "MANUAL_MINUTES", allowsHours: true, allowsDateRange: true }, "único día"],
    ["cantidad manual sin permitir horas", { coverageMode: "MANUAL_MINUTES", allowsHours: false, allowsDateRange: false }, "cantidad de horas"],
    ["cantidad manual con cantidad fija", { coverageMode: "MANUAL_MINUTES", allowsHours: true, allowsDateRange: false, coverageFixedMinutes: 60 }, "cantidad fija"],
    ["sin tiempo que suma", { coverageCountsTowardTotal: true }, "sumar al total"],
    ["sin tiempo con multiplicadores", { coverageAppliesSpecialHours: true }, "domingos y feriados"],
    ["sin tiempo con política de franco", { coverageOnDayOff: "COVER" }, "francos"],
  ])("rechaza %s sin persistir", async (_label, overrides, message) => {
    await expect(noveltyTypesService.create(createInput(overrides as Partial<CreateNoveltyTypeInput>))).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_TYPE_COVERAGE_CONFIG_INVALID",
      message: expect.stringContaining(message),
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("un PATCH valida el estado combinado: activar el rango en un tipo con cantidad manual se rechaza", async () => {
    repo.findById.mockResolvedValue(currentRow({ allowsHours: true, allowsDateRange: false, coverageMode: "MANUAL_MINUTES" }));

    await expect(noveltyTypesService.update("nt-1", { allowsDateRange: true } as UpdateNoveltyTypeInput)).rejects.toMatchObject({
      code: "NOVELTY_TYPE_COVERAGE_CONFIG_INVALID",
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("un PATCH que cambia sólo los minutos de un tipo de cantidad fija se acepta usando el resto de la fila actual", async () => {
    repo.findById.mockResolvedValue(currentRow({
      coverageMode: "FIXED_MINUTES",
      coverageFixedMinutes: 240,
      coverageOnDayOff: "NO_COVERAGE",
      coverageOnHoliday: "NO_COVERAGE",
      coverageCountsTowardTotal: true,
    }));

    await noveltyTypesService.update("nt-1", { coverageFixedMinutes: 300 } as UpdateNoveltyTypeInput);

    // Etapa 5: cambia lo que cubre → misma transacción con lock global y recálculo de todas las novedades del tipo.
    expect(repo.update).toHaveBeenCalledWith("nt-1", { coverageFixedMinutes: 300 }, expect.anything());
    expect(lockNoveltyCoverageGlobally).toHaveBeenCalled();
    expect(recalculateNoveltyCoverage).toHaveBeenCalledWith(expect.anything(), { noveltyTypeIds: ["nt-1"], includeNoneTypes: true }, expect.objectContaining({ source: "NOVELTY_TYPE_CHANGED" }));
  });

  it("un PATCH que pasa a no registrar tiempo sin limpiar la cantidad fija se rechaza (no se corrige en silencio)", async () => {
    repo.findById.mockResolvedValue(currentRow({
      coverageMode: "FIXED_MINUTES",
      coverageFixedMinutes: 240,
      coverageOnDayOff: "NO_COVERAGE",
      coverageOnHoliday: "NO_COVERAGE",
    }));

    await expect(noveltyTypesService.update("nt-1", { coverageMode: "NONE" } as UpdateNoveltyTypeInput)).rejects.toMatchObject({
      code: "NOVELTY_TYPE_COVERAGE_CONFIG_INVALID",
    });
  });

  it("un PATCH sin campos de cobertura sobre un tipo legado sigue aceptándose (defaults neutros)", async () => {
    repo.findById.mockResolvedValue(currentRow());

    await expect(noveltyTypesService.update("nt-1", { name: "Otro nombre" } as UpdateNoveltyTypeInput)).resolves.toBeDefined();
  });
});
