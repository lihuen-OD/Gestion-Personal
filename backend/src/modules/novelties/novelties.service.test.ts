import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { noveltiesRepository } from "./novelties.repository";
import { noveltiesService } from "./novelties.service";
import { createNoveltySchema, noveltyCoveragePreviewSchema } from "./novelties.schemas";
import { computeNoveltyCoverage, loadRealWorkedMinutesByDay } from "./noveltyCoverage.service";
import { prisma } from "../../shared/prisma/client";
import { storageService } from "../../shared/storage/storage.service";
import { AppError } from "../../shared/errors/AppError";
import { persistNoveltyCoverageWithin } from "./noveltyCoverage.service";
import { roles } from "../../shared/security/roles";

vi.mock("./novelties.repository", () => ({
  noveltiesRepository: {
    findById: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    remove: vi.fn(),
    countEmployees: vi.fn(),
    findNoveltyType: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn(),
    findOverlapping: vi.fn(),
    findNoveltyDocumentCategory: vi.fn(),
    findEmployeeIdentities: vi.fn(),
    createDocumentsWithin: vi.fn(),
  },
}));

vi.mock("../../shared/storage/storage.service", () => ({
  storageService: { uploadManagedObject: vi.fn(), persistManagedUploadWithArchive: vi.fn(), compensateManagedUpload: vi.fn() },
}));

// Etapa 3: las mutaciones abren una transacción de Prisma. El cliente se
// mockea siempre: un test unitario nunca debe alcanzar una base real.
const txStub = { noveltyDayCoverage: { deleteMany: vi.fn() } };
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txStub)),
    employee: { findMany: vi.fn() },
    noveltyDayCoverage: { findMany: vi.fn() },
  },
}));

vi.mock("./noveltyCoverage.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./noveltyCoverage.service")>()),
  persistNoveltyCoverageWithin: vi.fn().mockResolvedValue({ novelties: 1, days: 1, pendingReviewDays: 0, droppedResolutions: 0, protectedPeriods: [] }),
  assertNoveltyCoverageWritableWithin: vi.fn().mockResolvedValue([]),
  computeNoveltyCoverage: vi.fn(),
  loadRealWorkedMinutesOnDate: vi.fn(),
  loadRealWorkedMinutesByDay: vi.fn(),
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

vi.mock("../workforce-management/workforce.service", () => ({
  notifyRrhh: vi.fn().mockResolvedValue(undefined),
}));

const repo = noveltiesRepository as unknown as {
  findById: Mock;
  approve: Mock;
  reject: Mock;
  remove: Mock;
  countEmployees: Mock;
  findNoveltyType: Mock;
  createMany: Mock;
  findMany: Mock;
  findOverlapping: Mock;
  findNoveltyDocumentCategory: Mock;
  findEmployeeIdentities: Mock;
  createDocumentsWithin: Mock;
};

const rrhhUser = { id: "user-rrhh", role: roles.rrhh } as unknown as Express.AuthUser;
const supervisionUser = { id: "user-sup", role: roles.supervision } as unknown as Express.AuthUser;
const cargaUser = { id: "user-carga", role: roles.cargaHoraria } as unknown as Express.AuthUser;

describe("noveltiesService.list PII", () => {
  it("Nivel 3 recibe la novedad operativa sin DNI, CUIL ni documentos", async () => {
    repo.findMany.mockResolvedValue([[
      novelty({
        employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez", dni: "30000000", cuil: "20300000001" },
        documents: [{ fileName: "certificado-medico.pdf" }],
      }),
    ], 1]);

    const result = await noveltiesService.list({ page: 1, take: 25 } as never, cargaUser);

    expect(result.items[0]?.employee).toMatchObject({ id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" });
    expect(result.items[0]?.employee).not.toHaveProperty("dni");
    expect(result.items[0]?.employee).not.toHaveProperty("cuil");
    expect(result.items[0]).not.toHaveProperty("documents");
  });
});

function novelty(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "novelty-1",
    status: "PENDIENTE",
    noveltyType: { code: "VAC", name: "Vacaciones", approvalRoles: [] },
    employee: { legajo: "100" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Etapa 15G.1 (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
// Novedades es justificación administrativa — nunca crea ni modifica
// TimeEntry, sea cual sea su status o `timeEntryBehavior` de su
// NoveltyType. approve() sólo cambia status + auditoría, siempre con la
// misma firma de 2 argumentos — no existe ningún "effect" horario que armar
// ni pasar.
describe("noveltiesService.approve", () => {
  it("aprueba una novedad PENDIENTE cambiando sólo status/auditoría, sin ningún efecto horario", async () => {
    repo.findById.mockResolvedValue(novelty());
    repo.approve.mockResolvedValue(novelty({ status: "APROBADO" }));

    const result = await noveltiesService.approve("novelty-1", rrhhUser);

    expect(result.status).toBe("APROBADO");
    expect(repo.approve).toHaveBeenCalledWith("novelty-1", rrhhUser.id, expect.anything());
  });

  it("aprobar un tipo con timeEntryBehavior=BLOQUEA_NUEVA_CARGA tampoco dispara ningún efecto horario (llamada idéntica)", async () => {
    repo.findById.mockResolvedValue(
      novelty({ noveltyType: { code: "LLT", name: "Llegada tarde", approvalRoles: [], timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" } }),
    );
    repo.approve.mockResolvedValue(novelty({ status: "APROBADO", noveltyType: { code: "LLT", name: "Llegada tarde" } }));

    await noveltiesService.approve("novelty-1", rrhhUser);

    expect(repo.approve).toHaveBeenCalledWith("novelty-1", rrhhUser.id, expect.anything());
    expect(repo.approve).toHaveBeenCalledTimes(1);
  });

  it("impide aprobar una novedad ya aprobada (regresion: la guarda ya existia, se protege con test)", async () => {
    repo.findById.mockResolvedValue(novelty({ status: "APROBADO" }));

    await expect(noveltiesService.approve("novelty-1", rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_STATUS_NOT_APPROVABLE",
    });
    expect(repo.approve).not.toHaveBeenCalled();
  });

  it("impide que un rol sin permiso de aprobacion para ese tipo de novedad apruebe", async () => {
    repo.findById.mockResolvedValue(novelty({ noveltyType: { code: "VAC", name: "Vacaciones", approvalRoles: [] } }));

    await expect(noveltiesService.approve("novelty-1", supervisionUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "NOVELTY_APPROVAL_FORBIDDEN",
    });
    expect(repo.approve).not.toHaveBeenCalled();
  });
});

describe("noveltiesService.reject", () => {
  it("rechaza una novedad PENDIENTE con motivo, sin tocar ningún TimeEntry", async () => {
    repo.findById.mockResolvedValue(novelty());
    repo.reject.mockResolvedValue(novelty({ status: "RECHAZADO" }));

    const result = await noveltiesService.reject("novelty-1", { reason: "Datos incompletos" }, rrhhUser);

    expect(result.status).toBe("RECHAZADO");
    // reject() sólo recibe el id: no hay ningún dato de horas para pasar.
    expect(repo.reject).toHaveBeenCalledWith("novelty-1", expect.anything());
  });

  it("impide rechazar dos veces la misma novedad (regresion)", async () => {
    repo.findById.mockResolvedValue(novelty({ status: "RECHAZADO" }));

    await expect(noveltiesService.reject("novelty-1", { reason: "otra vez" }, rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_STATUS_NOT_REJECTABLE",
    });
    expect(repo.reject).not.toHaveBeenCalled();
  });
});

// Etapa 15G.1 — ajuste de residual (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
// remove() no tenía ningún test antes de este ajuste. El guard
// NOVELTY_DELETE_HAS_TIME_IMPACT ("Novelty generated time entries") se
// eliminó porque ya no existe ningún camino por el que una novedad genere
// TimeEntry — estos tests fijan que un tipo con timeEntryBehavior=
// BLOQUEA_NUEVA_CARGA ya NO bloquea el borrado por ese motivo, y que los
// otros dos guards (documentos relacionados, aprobada+exportable a
// Finnegans) siguen intactos.
describe("noveltiesService.remove", () => {
  it("borra una novedad sin documentos ni impacto exportable", async () => {
    repo.findById.mockResolvedValue(novelty({ documents: [], status: "PENDIENTE" }));
    repo.remove.mockResolvedValue(undefined);

    const result = await noveltiesService.remove("novelty-1", rrhhUser);

    expect(result).toEqual({ id: "novelty-1" });
    expect(repo.remove).toHaveBeenCalledWith("novelty-1", expect.anything());
  });

  it("Regla ajustada: un tipo con timeEntryBehavior=BLOQUEA_NUEVA_CARGA YA NO bloquea el borrado (ya no genera TimeEntry)", async () => {
    repo.findById.mockResolvedValue(
      novelty({
        documents: [],
        status: "PENDIENTE",
        noveltyType: { code: "LLT", name: "Llegada tarde", timeEntryBehavior: "BLOQUEA_NUEVA_CARGA", exportsToFinnegans: false },
      }),
    );
    repo.remove.mockResolvedValue(undefined);

    const result = await noveltiesService.remove("novelty-1", rrhhUser);

    expect(result).toEqual({ id: "novelty-1" });
    expect(repo.remove).toHaveBeenCalledWith("novelty-1", expect.anything());
  });

  it("bloquea el borrado si tiene documentos relacionados (NOVELTY_DELETE_HAS_DOCUMENTS)", async () => {
    repo.findById.mockResolvedValue(novelty({ documents: [{ fileName: "certificado.pdf" }] }));

    await expect(noveltiesService.remove("novelty-1", rrhhUser)).rejects.toMatchObject({
      statusCode: 409,
      code: "NOVELTY_DELETE_HAS_DOCUMENTS",
    });
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it("sigue bloqueando el borrado de una novedad APROBADA y exportable a Finnegans (NOVELTY_DELETE_EXPORTABLE_APPROVED, sin cambios)", async () => {
    repo.findById.mockResolvedValue(
      novelty({
        documents: [],
        status: "APROBADO",
        noveltyType: { code: "VAC", name: "Vacaciones", exportsToFinnegans: true },
      }),
    );

    await expect(noveltiesService.remove("novelty-1", rrhhUser)).rejects.toMatchObject({
      statusCode: 409,
      code: "NOVELTY_DELETE_EXPORTABLE_APPROVED",
    });
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it("una novedad exportable pero todavia PENDIENTE (no aprobada) SI se puede borrar", async () => {
    repo.findById.mockResolvedValue(
      novelty({
        documents: [],
        status: "PENDIENTE",
        noveltyType: { code: "VAC", name: "Vacaciones", exportsToFinnegans: true },
      }),
    );
    repo.remove.mockResolvedValue(undefined);

    const result = await noveltiesService.remove("novelty-1", rrhhUser);

    expect(result).toEqual({ id: "novelty-1" });
    expect(repo.remove).toHaveBeenCalledWith("novelty-1", expect.anything());
  });

  it("404 si la novedad no existe o esta fuera de alcance", async () => {
    repo.findById.mockResolvedValue(null);

    await expect(noveltiesService.remove("novelty-1", rrhhUser)).rejects.toMatchObject({
      statusCode: 404,
      code: "NOVELTY_NOT_FOUND",
    });
    expect(repo.remove).not.toHaveBeenCalled();
  });
});

function createInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    employeeIds: ["emp-1"],
    noveltyTypeId: "type-1",
    fromDate: new Date("2026-08-10"),
    toDate: null,
    quantityHours: null,
    quantityDays: null,
    observation: null,
    targetHourConceptId: null,
    ...overrides,
  } as Parameters<typeof noveltiesService.create>[0];
}

function noveltyType(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "type-1",
    code: "VAC",
    name: "Vacaciones",
    status: "ACTIVO",
    allowsHours: false,
    allowsDateRange: true,
    finnegansRequiresValidity: false,
    timeEntryBehavior: "NO_BLOQUEA",
    allowedLoadRoles: [] as string[],
    coverageMode: "NONE",
    ...overrides,
  };
}

describe("noveltiesService.create", () => {
  beforeEach(() => {
    repo.countEmployees.mockResolvedValue(1);
    repo.findNoveltyType.mockResolvedValue(noveltyType());
    repo.createMany.mockResolvedValue([{ id: "novelty-new" }]);
    repo.findOverlapping.mockResolvedValue([]);
  });

  it("crea una novedad valida: RRHH crea ya APROBADO y no notifica a RH (es RH)", async () => {
    const items = await noveltiesService.create(createInput(), rrhhUser);

    expect(items).toEqual([{ id: "novelty-new" }]);
    // Etapa 15G.1: createMany sólo recibe (input, status, userId) — no existe
    // ningún cuarto argumento de "efecto horario" que pasar.
    expect(repo.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ employeeIds: ["emp-1"] }),
      "APROBADO",
      rrhhUser.id, expect.anything(),
    );
  });

  it("un rol no-RRHH crea la novedad PENDIENTE y notifica a RH", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.supervision] }));

    const items = await noveltiesService.create(createInput(), supervisionUser);

    expect(items).toEqual([{ id: "novelty-new" }]);
    expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "PENDIENTE", supervisionUser.id, expect.anything());
  });

  // Etapa 15G.1 (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
  // decisión funcional final — Novedades NUNCA crea/modifica TimeEntry, sin
  // importar status, rol de quien crea, ni `timeEntryBehavior` del tipo.
  // Estos tests fijan esa garantía para las 4 combinaciones más sensibles:
  // PENDIENTE/APROBADO × NO_BLOQUEA/BLOQUEA_NUEVA_CARGA — en los 4 casos la
  // llamada a createMany es idéntica en forma (3 argumentos, nunca un 4to
  // "effect").
  it.each([
    { label: "PENDIENTE + timeEntryBehavior=NO_BLOQUEA", user: supervisionUser, status: "PENDIENTE", type: noveltyType({ allowedLoadRoles: [roles.supervision] }) },
    { label: "PENDIENTE + timeEntryBehavior=BLOQUEA_NUEVA_CARGA", user: supervisionUser, status: "PENDIENTE", type: noveltyType({ allowedLoadRoles: [roles.supervision], timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" }) },
    { label: "APROBADO (RRHH) + timeEntryBehavior=NO_BLOQUEA", user: rrhhUser, status: "APROBADO", type: noveltyType() },
    { label: "APROBADO (RRHH) + timeEntryBehavior=BLOQUEA_NUEVA_CARGA", user: rrhhUser, status: "APROBADO", type: noveltyType({ timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" }) },
  ])("$label: createMany se llama sin ningún efecto horario (input, estado, autor y la transacción)", async ({ user, status, type }) => {
    repo.findNoveltyType.mockResolvedValue(type);

    await noveltiesService.create(createInput(), user);

    expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), status, user.id, expect.anything());
    // Etapa 3: el 4to argumento es sólo la transacción (no un efecto horario).
    expect(repo.createMany.mock.calls[0]).toHaveLength(4);
    expect(repo.createMany.mock.calls[0]![3]).toBe(txStub);
  });

  // Caso concreto del usuario: "Llegada tarde" (allowsHours=true,
  // timeEntryBehavior=NO_BLOQUEA en la configuración real) aprobada por
  // RRHH no debe descontar ni tocar TimeEntry — sigue siendo sólo un
  // registro administrativo.
  it("llegada tarde aprobada por RRHH no toca TimeEntry", async () => {
    repo.findNoveltyType.mockResolvedValue(
      noveltyType({ code: "LLT", name: "Llegada tarde", allowsHours: true, allowsDateRange: false }),
    );

    await noveltiesService.create(createInput({ quantityHours: 1 }), rrhhUser);

    expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "APROBADO", rrhhUser.id, expect.anything());
    // Etapa 3: el 4to argumento es sólo la transacción (no un efecto horario).
    expect(repo.createMany.mock.calls[0]).toHaveLength(4);
    expect(repo.createMany.mock.calls[0]![3]).toBe(txStub);
  });

  it("timeEntryBehavior=BLOQUEA_NUEVA_CARGA tampoco dispara ningún efecto horario al crear", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" }));

    await noveltiesService.create(createInput(), rrhhUser);

    expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "APROBADO", rrhhUser.id, expect.anything());
    // Etapa 3: el 4to argumento es sólo la transacción (no un efecto horario).
    expect(repo.createMany.mock.calls[0]).toHaveLength(4);
    expect(repo.createMany.mock.calls[0]![3]).toBe(txStub);
  });

  it("rechaza si algun empleado esta fuera del alcance de quien crea (EMPLOYEE_SCOPE_FORBIDDEN)", async () => {
    repo.countEmployees.mockResolvedValue(0);

    await expect(noveltiesService.create(createInput({ employeeIds: ["emp-1", "emp-2"] }), supervisionUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "EMPLOYEE_SCOPE_FORBIDDEN",
    });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it("rechaza si el tipo de novedad no existe o esta inactivo (NOVELTY_TYPE_NOT_AVAILABLE)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ status: "INACTIVO" }));

    await expect(noveltiesService.create(createInput(), rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_TYPE_NOT_AVAILABLE",
    });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it("rechaza cantidad de horas si el tipo no la permite (NOVELTY_HOURS_NOT_ALLOWED)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false }));

    await expect(noveltiesService.create(createInput({ quantityHours: 4 }), rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_HOURS_NOT_ALLOWED",
    });
  });

  it("rechaza fechaHasta si el tipo no la permite (NOVELTY_TO_DATE_NOT_ALLOWED)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsDateRange: false }));

    await expect(
      noveltiesService.create(createInput({ fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-12") }), rrhhUser),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TO_DATE_NOT_ALLOWED" });
  });

  it("allowsDateRange=true permite toDate", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsDateRange: true }));

    await expect(
      noveltiesService.create(createInput({ fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-12") }), rrhhUser),
    ).resolves.toBeDefined();
  });

  it("exige fechaDesde y fechaHasta cuando el tipo tiene vigencia obligatoria (NOVELTY_VALIDITY_REQUIRED)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ finnegansRequiresValidity: true, allowsDateRange: true }));

    await expect(noveltiesService.create(createInput({ toDate: null }), rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_VALIDITY_REQUIRED",
    });
  });

  it("rechaza si el rol de quien crea no esta habilitado para cargar este tipo de novedad (NOVELTY_LOAD_FORBIDDEN)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.rrhh] }));

    await expect(noveltiesService.create(createInput(), supervisionUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "NOVELTY_LOAD_FORBIDDEN",
    });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  // Etapa 15L.2A (docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md,
  // punto 15): requiresApproval ahora decide de verdad el estado inicial
  // para roles no-RRHH. RRHH sigue siendo autoridad final sin excepción.
  describe("Etapa 15L.2A — requiresApproval con efecto real", () => {
    it("Nivel 2 con requiresApproval=true crea PENDIENTE y notifica a RH", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.supervision], requiresApproval: true }));

      await noveltiesService.create(createInput(), supervisionUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "PENDIENTE", supervisionUser.id, expect.anything());
      const { notifyRrhh } = await import("../workforce-management/workforce.service");
      expect(notifyRrhh).toHaveBeenCalled();
    });

    it("Nivel 2 con requiresApproval=false crea APROBADO directo y NO notifica a RH", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.supervision], requiresApproval: false }));

      await noveltiesService.create(createInput(), supervisionUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "APROBADO", supervisionUser.id, expect.anything());
      const { notifyRrhh } = await import("../workforce-management/workforce.service");
      expect(notifyRrhh).not.toHaveBeenCalled();
    });

    it("Nivel 3 con requiresApproval=false crea APROBADO directo (mismo criterio que Nivel 2)", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.cargaHoraria], requiresApproval: false }));

      await noveltiesService.create(createInput(), cargaUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "APROBADO", cargaUser.id, expect.anything());
    });

    it("Nivel 3 con requiresApproval=true crea PENDIENTE", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.cargaHoraria], requiresApproval: true }));

      await noveltiesService.create(createInput(), cargaUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "PENDIENTE", cargaUser.id, expect.anything());
    });

    it("requiresApproval ausente (undefined) sigue tratandose como true — sin cambio de comportamiento", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.supervision] }));

      await noveltiesService.create(createInput(), supervisionUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "PENDIENTE", supervisionUser.id, expect.anything());
    });

    it("RRHH crea APROBADO sin importar requiresApproval, incluso si el tipo tiene requiresApproval=false", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ requiresApproval: false }));

      await noveltiesService.create(createInput(), rrhhUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "APROBADO", rrhhUser.id, expect.anything());
    });
  });

  // Etapa 15L.2B.1 (corrección puntual, docs/decisions/
  // NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md): assertQuantityCoherence ya
  // NO rechaza quantityHours/quantityDays según finnegansValueUnit -- esa
  // mezcla (capacidad operativa vs. interpretación de exportación) era
  // exactamente el acoplamiento que esta etapa corrige. La única regla que
  // queda es de integridad de datos, independiente de cualquier unidad:
  // no se puede cargar horas Y días a la vez. La capacidad operativa
  // (¿se puede cargar quantityHours?) sigue dependiendo únicamente de
  // allowsHours, vía el guard preexistente NOVELTY_HOURS_NOT_ALLOWED.
  describe("Etapa 15L.2B.1 — quantityHours/quantityDays independientes de finnegansValueUnit", () => {
    it("finnegansValueUnit=HOURS ya no rechaza quantityDays (el gap de Valor 1 ambiguo queda para 15L.2C)", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: true, finnegansValueUnit: "HOURS" }));

      await expect(noveltiesService.create(createInput({ quantityDays: 1 }), rrhhUser)).resolves.toBeDefined();
    });

    it("finnegansValueUnit=DAYS ya no rechaza quantityHours (allowsHours sigue siendo el único gate operativo)", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: true, finnegansValueUnit: "DAYS" }));

      await expect(noveltiesService.create(createInput({ quantityHours: 1 }), rrhhUser)).resolves.toBeDefined();
    });

    it("finnegansValueUnit=UNIT ya no rechaza ninguna cantidad si allowsHours lo permite", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: true, finnegansValueUnit: "UNIT" }));

      await expect(noveltiesService.create(createInput({ quantityHours: 1 }), rrhhUser)).resolves.toBeDefined();
      await expect(noveltiesService.create(createInput({ quantityDays: 1 }), rrhhUser)).resolves.toBeDefined();
    });

    it("allowsHours=false sigue rechazando quantityHours sin importar finnegansValueUnit=HOURS (NOVELTY_HOURS_NOT_ALLOWED, gate preexistente y ajeno a esta corrección)", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false, finnegansValueUnit: "HOURS" }));

      await expect(noveltiesService.create(createInput({ quantityHours: 1 }), rrhhUser)).rejects.toMatchObject({
        statusCode: 400,
        code: "NOVELTY_HOURS_NOT_ALLOWED",
      });
    });

    it("finnegansValueUnit=null no agrega ninguna restricción sobre quantityDays (sin cambios)", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false, finnegansValueUnit: null }));

      await expect(noveltiesService.create(createInput({ quantityDays: 5 }), rrhhUser)).resolves.toBeDefined();
    });

    it("crear sin ninguna cantidad sigue funcionando para cualquier unidad", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ finnegansValueUnit: "UNIT" }));

      await expect(noveltiesService.create(createInput(), rrhhUser)).resolves.toBeDefined();
    });

    it("quantityHours y quantityDays simultaneos siguen rechazándose, sin importar la unidad (NOVELTY_QUANTITY_UNIT_CONFLICT) -- única regla de integridad que queda", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: true, finnegansValueUnit: "HOURS" }));

      await expect(
        noveltiesService.create(createInput({ quantityHours: 1, quantityDays: 1 }), rrhhUser),
      ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_QUANTITY_UNIT_CONFLICT" });
    });
  });

  // Etapa 15L.5 (docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md): el
  // backend pasa a ser la única autoridad de quantityDays -- deja de
  // confiar en lo que mande el cliente. allowsHours sigue siendo la única
  // señal que decide qué campo aplica (sin volver a acoplar
  // finnegansValueUnit).
  describe("Etapa 15L.5 — resolveQuantities: backend es la autoridad de quantityDays", () => {
    it("allowsHours=true: quantityHours pasa tal cual (dato manual), quantityDays siempre null aunque el cliente mande uno", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: true }));

      await noveltiesService.create(createInput({ quantityHours: 3 }), rrhhUser);

      expect(repo.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ quantityHours: 3, quantityDays: null }),
        "APROBADO",
        rrhhUser.id, expect.anything(),
      );
    });

    it("allowsHours=false, sin toDate: quantityDays=1, quantityHours siempre null", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false }));

      await noveltiesService.create(createInput({ fromDate: new Date("2026-07-15"), toDate: null }), rrhhUser);

      expect(repo.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ quantityDays: 1, quantityHours: null }),
        "APROBADO",
        rrhhUser.id, expect.anything(),
      );
    });

    it("toDate igual a fromDate: quantityDays=1", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false }));

      await noveltiesService.create(createInput({ fromDate: new Date("2026-07-15"), toDate: new Date("2026-07-15") }), rrhhUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.objectContaining({ quantityDays: 1 }), "APROBADO", rrhhUser.id, expect.anything());
    });

    it("cross-month 30/07 → 02/08: quantityDays=4 (rango real completo, sin recortar al mes de fromDate)", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false }));

      await noveltiesService.create(createInput({ fromDate: new Date("2026-07-30"), toDate: new Date("2026-08-02") }), rrhhUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.objectContaining({ quantityDays: 4 }), "APROBADO", rrhhUser.id, expect.anything());
    });

    it("cross-year 31/12 → 02/01: quantityDays=3", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false }));

      await noveltiesService.create(createInput({ fromDate: new Date("2026-12-31"), toDate: new Date("2027-01-02") }), rrhhUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.objectContaining({ quantityDays: 3 }), "APROBADO", rrhhUser.id, expect.anything());
    });

    it("el cliente manda un quantityDays incorrecto: el backend lo ignora y persiste el valor canónico", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false }));

      await noveltiesService.create(
        createInput({ fromDate: new Date("2026-07-30"), toDate: new Date("2026-08-02"), quantityDays: 2 }),
        rrhhUser,
      );

      expect(repo.createMany).toHaveBeenCalledWith(expect.objectContaining({ quantityDays: 4 }), "APROBADO", rrhhUser.id, expect.anything());
    });

    it("allowsDateRange=false: quantityDays=1 -- un toDate distinto de fromDate ya se rechaza antes (NOVELTY_TO_DATE_NOT_ALLOWED), nunca llega a calcularse sobre un rango extendido", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false, allowsDateRange: false }));

      await noveltiesService.create(createInput({ fromDate: new Date("2026-07-30"), toDate: null }), rrhhUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.objectContaining({ quantityDays: 1, toDate: null }), "APROBADO", rrhhUser.id, expect.anything());

      await expect(
        noveltiesService.create(createInput({ fromDate: new Date("2026-07-30"), toDate: new Date("2026-08-05") }), rrhhUser),
      ).rejects.toMatchObject({ code: "NOVELTY_TO_DATE_NOT_ALLOWED" });
    });

    it("timezone: la hora-de-día que traiga el Date no altera el resultado (se normaliza a medianoche UTC)", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false }));

      await noveltiesService.create(
        createInput({ fromDate: new Date("2026-07-30T23:59:59.999Z"), toDate: new Date("2026-08-02T00:00:00.001Z") }),
        rrhhUser,
      );

      expect(repo.createMany).toHaveBeenCalledWith(expect.objectContaining({ quantityDays: 4 }), "APROBADO", rrhhUser.id, expect.anything());
    });
  });

  // Motor de cobertura — Etapa 1 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md):
  // en un tipo de cantidad manual la cantidad canónica es quantityMinutes,
  // derivada por el backend de quantityHours. Ningún otro modo la usa todavía
  // y crear una novedad sigue sin escribir horas (15G.1 §2.1).
  describe("Motor de cobertura — quantityMinutes en tipos de cantidad manual", () => {
    const manualType = () => noveltyType({ allowsHours: true, allowsDateRange: false, coverageMode: "MANUAL_MINUTES" });

    it.each([
      [1, 60],
      [1.5, 90],
      [0.25, 15],
      [1.33, 80],
      [24, 1440],
    ])("%s h → %s min, conservando quantityHours", async (hours, minutes) => {
      repo.findNoveltyType.mockResolvedValue(manualType());

      await noveltiesService.create(createInput({ quantityHours: hours, toDate: null }), rrhhUser);

      expect(repo.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ quantityHours: hours, quantityMinutes: minutes, quantityDays: null }),
        "APROBADO",
        rrhhUser.id, expect.anything(),
      );
    });

    it("más de 24 h en un único día se rechaza sin persistir (nunca se recorta)", async () => {
      repo.findNoveltyType.mockResolvedValue(manualType());

      await expect(noveltiesService.create(createInput({ quantityHours: 24.5, toDate: null }), rrhhUser)).rejects.toMatchObject({
        statusCode: 400,
        code: "NOVELTY_MANUAL_QUANTITY_EXCEEDS_DAY",
      });
      expect(repo.createMany).not.toHaveBeenCalled();
    });

    it("sin cantidad cargada se rechaza (etapa 3: el motor necesita la cantidad del día)", async () => {
      repo.findNoveltyType.mockResolvedValue(manualType());

      await expect(noveltiesService.create(createInput({ quantityHours: null, toDate: null }), rrhhUser)).rejects.toMatchObject({
        statusCode: 400,
        code: "NOVELTY_MANUAL_QUANTITY_REQUIRED",
      });
      expect(repo.createMany).not.toHaveBeenCalled();
    });

    it("un tipo que permite horas pero no es de cantidad manual (legado con rango) no deriva minutos", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: true, allowsDateRange: true, coverageMode: "NONE" }));

      await noveltiesService.create(createInput({ quantityHours: 30 }), rrhhUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.objectContaining({ quantityHours: 30, quantityMinutes: null }), "APROBADO", rrhhUser.id, expect.anything());
    });

    it("un tipo sin horas nunca deriva minutos", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsHours: false, coverageMode: "FIXED_MINUTES" }));

      await noveltiesService.create(createInput({ fromDate: new Date("2026-07-15"), toDate: new Date("2026-07-15") }), rrhhUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.objectContaining({ quantityHours: null, quantityMinutes: null, quantityDays: 1 }), "APROBADO", rrhhUser.id, expect.anything());
    });

    it("createMany no recibe ningún efecto horario: sólo input, estado, autor y la transacción (15G.1)", async () => {
      repo.findNoveltyType.mockResolvedValue(manualType());

      await noveltiesService.create(createInput({ quantityHours: 1, toDate: null }), rrhhUser);

      // Etapa 3: el 4to argumento es sólo la transacción (no un efecto horario).
    expect(repo.createMany.mock.calls[0]).toHaveLength(4);
    expect(repo.createMany.mock.calls[0]![3]).toBe(txStub);
    });
  });

  describe("Etapa 15L.5 — createNoveltySchema sigue rechazando toDate < fromDate", () => {
    it("toDate anterior a fromDate: la validación del schema falla (gate real de la API, antes de llegar al service)", () => {
      const result = createNoveltySchema.safeParse({
        employeeIds: ["11111111-1111-1111-1111-111111111111"],
        noveltyTypeId: "22222222-2222-2222-2222-222222222222",
        fromDate: "2026-08-02",
        toDate: "2026-07-30",
      });
      expect(result.success).toBe(false);
    });
  });
});

// Etapa 15G.3 (docs/decisions/NOVELTY_OVERLAP_DUPLICATE_RULES_15G3.md):
// cierra el gap documentado en la auditoria 2026-08-24 (ver commit previo)
// — antes de esta etapa, dos novedades del mismo tipo para el mismo
// empleado podian solaparse libremente. La regla implementada es
// deliberadamente acotada: sólo compara contra el MISMO noveltyTypeId
// (nunca inventa incompatibilidad entre tipos distintos) e ignora
// RECHAZADO. Distingue dos codigos: NOVELTY_DUPLICATE (rango exactamente
// igual) y NOVELTY_OVERLAP (se superponen pero no son iguales) — ambos
// bloquean, pero con mensaje distinto.
describe("noveltiesService.create — Etapa 15G.3 (duplicado/solapamiento del mismo tipo)", () => {
  beforeEach(() => {
    repo.countEmployees.mockResolvedValue(1);
    repo.findNoveltyType.mockResolvedValue(noveltyType());
    repo.createMany.mockResolvedValue([{ id: "novelty-new" }]);
  });

  function conflict(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "novelty-existing",
      fromDate: new Date("2026-08-10"),
      toDate: null,
      employee: { legajo: "100" },
      ...overrides,
    };
  }

  it("1. mismo empleado + mismo tipo + mismo dia + PENDIENTE existente -> bloquea (NOVELTY_DUPLICATE)", async () => {
    repo.findOverlapping.mockResolvedValue([conflict()]);

    await expect(
      noveltiesService.create(createInput({ fromDate: new Date("2026-08-10"), toDate: null }), rrhhUser),
    ).rejects.toMatchObject({ statusCode: 409, code: "NOVELTY_DUPLICATE" });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it("2. mismo empleado + mismo tipo + mismo dia + APROBADO existente -> bloquea (NOVELTY_DUPLICATE)", async () => {
    // El repositorio real ya filtra status != RECHAZADO sin importar cual
    // sea (PENDIENTE/APROBADO/etc.) — desde el service da igual cual de
    // los dos devuelva findOverlapping, lo relevante es que llega.
    repo.findOverlapping.mockResolvedValue([conflict()]);

    await expect(
      noveltiesService.create(createInput({ fromDate: new Date("2026-08-10"), toDate: null }), rrhhUser),
    ).rejects.toMatchObject({ statusCode: 409, code: "NOVELTY_DUPLICATE" });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it("3. mismo empleado + mismo tipo + mismo dia + RECHAZADO existente -> permite (el repo ya lo excluye, findOverlapping no lo devuelve)", async () => {
    repo.findOverlapping.mockResolvedValue([]);

    const items = await noveltiesService.create(createInput({ fromDate: new Date("2026-08-10"), toDate: null }), rrhhUser);

    expect(items).toEqual([{ id: "novelty-new" }]);
    expect(repo.createMany).toHaveBeenCalledTimes(1);
  });

  it("4. mismo tipo + distinto empleado -> permite (findOverlapping no encuentra nada para ese empleado)", async () => {
    repo.findOverlapping.mockResolvedValue([]);

    const items = await noveltiesService.create(createInput({ employeeIds: ["emp-2"] }), rrhhUser);

    expect(items).toEqual([{ id: "novelty-new" }]);
    expect(repo.findOverlapping).toHaveBeenCalledWith(["emp-2"], "type-1", expect.any(Date), null);
  });

  it("5. mismo empleado + distinto tipo -> permite (la regla sólo compara contra el mismo noveltyTypeId, no inventa incompatibilidad cruzada)", async () => {
    repo.findOverlapping.mockResolvedValue([]);

    const items = await noveltiesService.create(createInput({ noveltyTypeId: "type-2" }), rrhhUser);

    expect(items).toEqual([{ id: "novelty-new" }]);
    expect(repo.findOverlapping).toHaveBeenCalledWith(["emp-1"], "type-2", expect.any(Date), null);
  });

  it("6. mismo empleado + mismo tipo + rango identico -> bloquea (NOVELTY_DUPLICATE)", async () => {
    repo.findOverlapping.mockResolvedValue([
      conflict({ fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") }),
    ]);

    await expect(
      noveltiesService.create(createInput({ fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") }), rrhhUser),
    ).rejects.toMatchObject({ statusCode: 409, code: "NOVELTY_DUPLICATE" });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it("7. rangos solapados (no identicos) del mismo tipo -> bloquea (NOVELTY_OVERLAP, distinto de NOVELTY_DUPLICATE)", async () => {
    // Existente: Vacaciones 10-15. Nuevo: Vacaciones 13-20 -> se pisan del
    // 13 al 15, pero el rango no es el mismo.
    repo.findOverlapping.mockResolvedValue([
      conflict({ fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-15") }),
    ]);

    await expect(
      noveltiesService.create(createInput({ fromDate: new Date("2026-08-13"), toDate: new Date("2026-08-20") }), rrhhUser),
    ).rejects.toMatchObject({ statusCode: 409, code: "NOVELTY_OVERLAP" });
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it("8. rangos no solapados del mismo tipo -> permite (findOverlapping no devuelve nada fuera de rango)", async () => {
    repo.findOverlapping.mockResolvedValue([]);

    const items = await noveltiesService.create(
      createInput({ fromDate: new Date("2026-09-01"), toDate: new Date("2026-09-05") }),
      rrhhUser,
    );

    expect(items).toEqual([{ id: "novelty-new" }]);
    expect(repo.createMany).toHaveBeenCalledTimes(1);
  });

  it("9. carga masiva: un solo empleado en conflicto bloquea TODO el lote, sin crear parcialmente al resto en silencio", async () => {
    repo.countEmployees.mockResolvedValue(2);
    repo.findOverlapping.mockResolvedValue([conflict({ employee: { legajo: "200" } })]);

    await expect(
      noveltiesService.create(createInput({ employeeIds: ["emp-1", "emp-2"] }), rrhhUser),
    ).rejects.toMatchObject({ statusCode: 409 });
    // No se llama a createMany en absoluto -- ni para el lote completo, ni
    // para "el resto" sin el empleado en conflicto. Todo o nada.
    expect(repo.createMany).not.toHaveBeenCalled();
  });

  it("10. el mensaje de error identifica el legajo en conflicto, nunca un id/UUID tecnico", async () => {
    repo.findOverlapping.mockResolvedValue([conflict({ employee: { legajo: "100" } })]);

    const error = await noveltiesService.create(createInput(), rrhhUser).catch((caught) => caught);

    expect(error.message).toContain("legajo 100");
    expect(error.message).toContain("Vacaciones");
    expect(error.message.toLowerCase()).not.toMatch(/\buuid\b|emp-1|novelty-existing|type-1/);
  });

  it("con varios legajos en conflicto, el mensaje los lista a todos (sin ids tecnicos)", async () => {
    repo.countEmployees.mockResolvedValue(2);
    repo.findOverlapping.mockResolvedValue([
      conflict({ employee: { legajo: "100" } }),
      conflict({ id: "novelty-existing-2", employee: { legajo: "200" } }),
    ]);

    const error = await noveltiesService.create(createInput({ employeeIds: ["emp-1", "emp-2"] }), rrhhUser).catch((caught) => caught);

    expect(error.message).toContain("100");
    expect(error.message).toContain("200");
  });

  it("no evalua solapamiento contra el empleado que ya esta fuera de alcance (el chequeo de scope corre primero)", async () => {
    repo.countEmployees.mockResolvedValue(0);

    await expect(noveltiesService.create(createInput(), supervisionUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "EMPLOYEE_SCOPE_FORBIDDEN",
    });
    expect(repo.findOverlapping).not.toHaveBeenCalled();
  });
});

describe("createNoveltySchema — fechas invalidas", () => {
  it("rechaza toDate anterior a fromDate", () => {
    const result = createNoveltySchema.safeParse({
      employeeIds: ["11111111-1111-1111-1111-111111111111"],
      noveltyTypeId: "22222222-2222-2222-2222-222222222222",
      fromDate: "2026-08-15",
      toDate: "2026-08-10",
    });
    expect(result.success).toBe(false);
  });

  it("acepta toDate igual o posterior a fromDate", () => {
    const result = createNoveltySchema.safeParse({
      employeeIds: ["11111111-1111-1111-1111-111111111111"],
      noveltyTypeId: "22222222-2222-2222-2222-222222222222",
      fromDate: "2026-08-10",
      toDate: "2026-08-15",
    });
    expect(result.success).toBe(true);
  });
});

// Etapa 8 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §15): la vista previa
// informa, con la misma contabilidad que la grilla, cómo quedará cada día
// frente al trabajo real ya registrado y con qué estado se va a crear.
describe("noveltiesService.previewCoverage — trabajo real y estado inicial", () => {
  const type = (overrides: Record<string, unknown> = {}) => ({
    id: "type-1", code: "TB", name: "Trámite bancario", status: "ACTIVO", allowsDateRange: false, allowsHours: false,
    requiresApproval: true, requiresObservation: false, coverageMode: "FIXED_MINUTES", allowedLoadRoles: [roles.rrhh, roles.supervision, roles.cargaHoraria],
    ...overrides,
  });
  const day = (overrides: Record<string, unknown> = {}) => ({
    dateKey: "2026-11-16", outcome: "COVERED", scheduleReviewReason: null, expectedMinutes: 480, baseMinutes: 240, multiplier: 1,
    reviewStatus: "NOT_REQUIRED", resolution: null, resolvedBaseMinutes: null, resolvedAgainstWorkedMinutes: null, resolvedByUserId: null, resolvedAt: null,
    resolutionNote: null, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE", shiftTemplateId: null, effectiveBaseMinutes: 240, computedMinutes: 240,
    resolutionDropped: false, ...overrides,
  });

  function arrange(typeOverrides: Record<string, unknown>, days: ReturnType<typeof day>[], worked: Record<string, number>) {
    repo.countEmployees.mockResolvedValue(1);
    repo.findNoveltyType.mockResolvedValue(type(typeOverrides));
    (prisma.employee.findMany as Mock).mockResolvedValue([{ id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gómez" }]);
    (computeNoveltyCoverage as Mock).mockResolvedValue(new Map([["employee-1", days]]));
    (loadRealWorkedMinutesByDay as Mock).mockResolvedValue(new Map([["employee-1", new Map(Object.entries(worked))]]));
  }
  const input = (overrides: Record<string, unknown> = {}) =>
    noveltyCoveragePreviewSchema.parse({ employeeIds: ["5b1a8a52-8f1f-4b8f-9d63-2a4b9d1c6e01"], noveltyTypeId: "8d1f5c1e-3c7a-4a8e-9a55-6f0b4b6d2a10", fromDate: "2026-11-16", ...overrides });

  it("trabajo real en un día que un tipo incompatible cubre: quedará para revisión", async () => {
    arrange({}, [day()], { "2026-11-16": 300 });

    const result = await noveltiesService.previewCoverage(input(), cargaUser);

    expect(result.initialStatus).toBe("PENDIENTE");
    expect(result.employees[0]!.days[0]).toMatchObject({ date: "2026-11-16", baseMinutes: 240, workedMinutes: 300, stateWhenApproved: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"] });
    expect(loadRealWorkedMinutesByDay).toHaveBeenCalledWith(prisma, ["5b1a8a52-8f1f-4b8f-9d63-2a4b9d1c6e01"], "2026-11-16", "2026-11-16");
  });

  it("sin trabajo real cuenta; un tipo informativo no suma; RRHH crea aprobada", async () => {
    arrange({}, [day()], {});
    const counted = await noveltiesService.previewCoverage(input(), rrhhUser);
    expect(counted.initialStatus).toBe("APROBADO");
    expect(counted.employees[0]!.days[0]).toMatchObject({ workedMinutes: 0, stateWhenApproved: "COUNTED", reviewReasons: [] });

    arrange({ coverageMode: "MANUAL_MINUTES", requiresApproval: false, allowsHours: true }, [day({ countsTowardTotal: false, realWorkCompatibility: "COMPATIBLE", baseMinutes: 60, effectiveBaseMinutes: 60, computedMinutes: 60 })], { "2026-11-16": 480 });
    const informative = await noveltiesService.previewCoverage(input({ quantityHours: 1 }), cargaUser);
    expect(informative.initialStatus).toBe("APROBADO");
    expect(informative.employees[0]!.days[0]).toMatchObject({ workedMinutes: 480, stateWhenApproved: "INFORMATIVE", reviewReasons: [] });
  });

  it("una novedad sin tiempo e incompatible (Falta sin aviso) con trabajo real queda para revisión", async () => {
    arrange({ coverageMode: "NONE" }, [day({ outcome: "NO_COVERAGE", baseMinutes: 0, effectiveBaseMinutes: 0, computedMinutes: 0, countsTowardTotal: false, expectedMinutes: null })], { "2026-11-16": 480 });

    const result = await noveltiesService.previewCoverage(input(), rrhhUser);

    expect(result.employees[0]!.days[0]).toMatchObject({ stateWhenApproved: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"] });
  });
});

// Etapa 8 (NOVELTY_COVERAGE_ENGINE.md §15.1): requiresDocumentation lo
// garantiza el backend. El archivo se sube antes de la transacción y se
// compensa si el alta no se completa: nunca queda una novedad sin documento.
describe("noveltiesService — documentación obligatoria", () => {
  const storage = storageService as unknown as { uploadManagedObject: Mock; persistManagedUploadWithArchive: Mock; compensateManagedUpload: Mock };
  const document = { fileName: "certificado.pdf", fileMimeType: "application/pdf", fileSizeBytes: 4, fileBase64: "JVBERg==", notes: "Certificado" };
  const category = { id: "cat-nov", code: "DOC-NOV", name: "Respaldo de novedad", kind: "NOVEDAD", uploadRoles: [roles.rrhh, "Nivel 2 - Supervisión / Gestión"] };
  const prepared = (employeeId: string) => ({ uploaded: { storageKey: `key-${employeeId}` }, input: { employeeId } });
  const withDocument = (overrides: Record<string, unknown> = {}) => ({ ...createInput(overrides), document }) as Parameters<typeof noveltiesService.createWithDocument>[0];

  beforeEach(() => {
    repo.countEmployees.mockImplementation(async (ids: string[]) => ids.length);
    repo.findNoveltyType.mockResolvedValue(noveltyType({ requiresDocumentation: true, allowedLoadRoles: [roles.supervision] }));
    repo.createMany.mockImplementation(async (input: { employeeIds: string[] }) => input.employeeIds.map((employeeId) => ({ id: `nov-${employeeId}`, employeeId })));
    repo.findOverlapping.mockResolvedValue([]);
    repo.findNoveltyDocumentCategory.mockResolvedValue(category);
    repo.findEmployeeIdentities.mockImplementation(async (ids: string[]) => ids.map((id) => ({ id, legajo: id, firstName: "Ana", lastName: "Gómez" })));
    repo.createDocumentsWithin.mockImplementation(async (_tx: unknown, rows: Array<{ employeeId: string; noveltyId: string }>) => rows.map((row, index) => ({ id: `doc-${index}`, ...row })));
    storage.uploadManagedObject.mockImplementation(async (input: { employeeId: string }) => prepared(input.employeeId));
    storage.persistManagedUploadWithArchive.mockImplementation(async (item: { input: { employeeId: string } }) => ({ id: `file-${item.input.employeeId}`, storageKey: `key-${item.input.employeeId}` }));
    storage.compensateManagedUpload.mockResolvedValue(undefined);
  });

  it("un tipo sin documentación obligatoria se crea igual que siempre, sin tocar el storage", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType());
    await noveltiesService.create(createInput(), rrhhUser);
    expect(repo.createMany).toHaveBeenCalledTimes(1);
    expect(storage.uploadManagedObject).not.toHaveBeenCalled();
  });

  it("una llamada directa al alta sin documento se rechaza y no crea nada", async () => {
    await expect(noveltiesService.create(createInput(), rrhhUser)).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_DOCUMENTATION_REQUIRED" });
    expect(repo.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("con documento: sube una copia por legajo y crea novedad, archivo y documento en la misma transacción", async () => {
    await noveltiesService.createWithDocument(withDocument({ employeeIds: ["emp-1", "emp-2"] }), rrhhUser, { userId: "user-rrhh" } as never);

    expect(storage.uploadManagedObject).toHaveBeenCalledTimes(2);
    expect(storage.uploadManagedObject).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "emp-1", module: "LEGAJOS", entityType: "EMPLOYEE_DOCUMENT", mimeType: "application/pdf", visibility: "RRHH_ONLY" }));
    expect(storage.persistManagedUploadWithArchive).toHaveBeenCalledWith(prepared("emp-1"), txStub);
    expect(repo.createDocumentsWithin).toHaveBeenCalledWith(txStub, [
      expect.objectContaining({ employeeId: "emp-1", noveltyId: "nov-emp-1", categoryId: "cat-nov", storageFileId: "file-emp-1", storageKey: "key-emp-1", status: "VIGENTE", notes: "Certificado", uploadedByUserId: "user-rrhh" }),
      expect.objectContaining({ employeeId: "emp-2", noveltyId: "nov-emp-2", storageFileId: "file-emp-2" }),
    ]);
    expect(storage.compensateManagedUpload).not.toHaveBeenCalled();
  });

  it("si falla el storage a mitad de camino, borra lo subido y no crea ninguna novedad", async () => {
    storage.uploadManagedObject.mockImplementationOnce(async (input: { employeeId: string }) => prepared(input.employeeId)).mockRejectedValueOnce(new Error("Drive caído"));

    await expect(noveltiesService.createWithDocument(withDocument({ employeeIds: ["emp-1", "emp-2"] }), rrhhUser)).rejects.toMatchObject({ statusCode: 502, code: "NOVELTY_DOCUMENT_UPLOAD_FAILED" });
    expect(storage.compensateManagedUpload).toHaveBeenCalledWith(prepared("emp-1"));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("un archivo inválido se explica tal cual (no se disfraza de falla del storage)", async () => {
    storage.uploadManagedObject.mockRejectedValueOnce(new AppError("Formato de archivo no permitido.", 400, "STORAGE_FILE_MIME_BLOCKED"));
    await expect(noveltiesService.createWithDocument(withDocument(), rrhhUser)).rejects.toMatchObject({ code: "STORAGE_FILE_MIME_BLOCKED" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("si la transacción falla (p. ej. período cerrado) después de subir, se borra el archivo subido", async () => {
    vi.mocked(persistNoveltyCoverageWithin).mockRejectedValueOnce(new AppError("El período ya fue enviado a cierre.", 409, "PERIOD_CLOSED"));
    repo.findNoveltyType.mockResolvedValue(noveltyType({ requiresDocumentation: true, allowedLoadRoles: [roles.supervision] }));

    await expect(noveltiesService.createWithDocument(withDocument(), supervisionUser)).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    expect(storage.compensateManagedUpload).toHaveBeenCalledWith(prepared("emp-1"));
  });

  it("si falla al vincular el documento, la transacción revierte la novedad y se borra el archivo", async () => {
    repo.createDocumentsWithin.mockRejectedValueOnce(new Error("FK"));
    await expect(noveltiesService.createWithDocument(withDocument(), rrhhUser)).rejects.toThrow("FK");
    expect(storage.compensateManagedUpload).toHaveBeenCalledWith(prepared("emp-1"));
  });

  it("permisos: el rol de carga del tipo y el permiso de la categoría se validan antes de tocar el storage", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ requiresDocumentation: true, allowedLoadRoles: [roles.rrhh] }));
    await expect(noveltiesService.createWithDocument(withDocument(), cargaUser)).rejects.toMatchObject({ statusCode: 403, code: "NOVELTY_LOAD_FORBIDDEN" });

    repo.findNoveltyType.mockResolvedValue(noveltyType({ requiresDocumentation: true, allowedLoadRoles: ["Nivel 3 - Administrativo de Carga Horaria"] }));
    await expect(noveltiesService.createWithDocument(withDocument(), cargaUser)).rejects.toMatchObject({ statusCode: 403, code: "DOCUMENT_UPLOAD_FORBIDDEN" });

    repo.findNoveltyDocumentCategory.mockResolvedValueOnce(null);
    await expect(noveltiesService.createWithDocument(withDocument(), rrhhUser)).rejects.toMatchObject({ statusCode: 409, code: "NOVELTY_DOCUMENT_CATEGORY_MISSING" });
    expect(storage.uploadManagedObject).not.toHaveBeenCalled();
  });
});

// Decisión de negocio (ADR §15.1): con documento, hasta 25 personas por alta;
// sin documento sigue el máximo general (250).
describe("noveltiesService — tamaño del lote con documento", () => {
  const storage = storageService as unknown as { uploadManagedObject: Mock; persistManagedUploadWithArchive: Mock };
  const document = { fileName: "certificado.pdf", fileMimeType: "application/pdf", fileSizeBytes: 4, fileBase64: "JVBERg==" };
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `emp-${index + 1}`);

  beforeEach(() => {
    repo.countEmployees.mockImplementation(async (list: string[]) => list.length);
    repo.findOverlapping.mockResolvedValue([]);
    repo.createMany.mockImplementation(async (input: { employeeIds: string[] }) => input.employeeIds.map((employeeId) => ({ id: `nov-${employeeId}`, employeeId })));
    repo.findNoveltyDocumentCategory.mockResolvedValue({ id: "cat", code: "DOC-NOV", name: "Respaldo", kind: "NOVEDAD", uploadRoles: [roles.rrhh] });
    repo.findEmployeeIdentities.mockImplementation(async (list: string[]) => list.map((id) => ({ id, legajo: id, firstName: "A", lastName: "B" })));
    repo.createDocumentsWithin.mockResolvedValue([]);
    storage.uploadManagedObject.mockImplementation(async (input: { employeeId: string }) => ({ uploaded: { storageKey: input.employeeId }, input }));
    storage.persistManagedUploadWithArchive.mockImplementation(async (item: { input: { employeeId: string } }) => ({ id: `file-${item.input.employeeId}`, storageKey: item.input.employeeId }));
  });

  it("25 personas con documento: permitido", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ requiresDocumentation: true }));
    await noveltiesService.createWithDocument({ ...createInput({ employeeIds: ids(25) }), document } as never, rrhhUser);
    expect(storage.uploadManagedObject).toHaveBeenCalledTimes(25);
  });

  it("26 personas con documento: se rechaza antes de leer o subir nada", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ requiresDocumentation: true }));
    await expect(noveltiesService.createWithDocument({ ...createInput({ employeeIds: ids(26) }), document } as never, rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_DOCUMENT_TOO_MANY_EMPLOYEES",
      message: "Con documentación podés cargar la novedad para hasta 25 personas por vez. Dividí la carga en grupos más pequeños.",
    });
    expect(storage.uploadManagedObject).not.toHaveBeenCalled();
    expect(repo.countEmployees).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("sin documento: 250 personas siguen permitidas", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType());
    await noveltiesService.create(createInput({ employeeIds: ids(250) }), rrhhUser);
    expect(repo.createMany).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: ids(250) }), "APROBADO", rrhhUser.id, expect.anything());
    expect(storage.uploadManagedObject).not.toHaveBeenCalled();
  });
});
