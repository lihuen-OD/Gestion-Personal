import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { noveltiesRepository } from "./novelties.repository";
import { noveltiesService } from "./novelties.service";
import { createNoveltySchema } from "./novelties.schemas";
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
  },
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
// TimeEntry, sea cual sea su status o los campos de su NoveltyType
// (setsWorkedHoursToZero/blocksTimeEntry/timeImpact incluidos). approve()
// sólo cambia status + auditoría, siempre con la misma firma de 2
// argumentos — no existe ningún "effect" horario que armar ni pasar.
describe("noveltiesService.approve", () => {
  it("aprueba una novedad PENDIENTE cambiando sólo status/auditoría, sin ningún efecto horario", async () => {
    repo.findById.mockResolvedValue(novelty());
    repo.approve.mockResolvedValue(novelty({ status: "APROBADO" }));

    const result = await noveltiesService.approve("novelty-1", rrhhUser);

    expect(result.status).toBe("APROBADO");
    expect(repo.approve).toHaveBeenCalledWith("novelty-1", rrhhUser.id);
  });

  it("aprobar un tipo con setsWorkedHoursToZero=true tampoco dispara ningún efecto horario (llamada idéntica)", async () => {
    repo.findById.mockResolvedValue(
      novelty({ noveltyType: { code: "LLT", name: "Llegada tarde", approvalRoles: [], setsWorkedHoursToZero: true } }),
    );
    repo.approve.mockResolvedValue(novelty({ status: "APROBADO", noveltyType: { code: "LLT", name: "Llegada tarde" } }));

    await noveltiesService.approve("novelty-1", rrhhUser);

    expect(repo.approve).toHaveBeenCalledWith("novelty-1", rrhhUser.id);
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
    expect(repo.reject).toHaveBeenCalledWith("novelty-1");
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
// TimeEntry — estos tests fijan que un tipo con setsWorkedHoursToZero ya NO
// bloquea el borrado por ese motivo, y que los otros dos guards (documentos
// relacionados, aprobada+exportable a Finnegans) siguen intactos.
describe("noveltiesService.remove", () => {
  it("borra una novedad sin documentos ni impacto exportable", async () => {
    repo.findById.mockResolvedValue(novelty({ documents: [], status: "PENDIENTE" }));
    repo.remove.mockResolvedValue(undefined);

    const result = await noveltiesService.remove("novelty-1", rrhhUser);

    expect(result).toEqual({ id: "novelty-1" });
    expect(repo.remove).toHaveBeenCalledWith("novelty-1");
  });

  it("Regla ajustada: un tipo con setsWorkedHoursToZero=true YA NO bloquea el borrado (ya no genera TimeEntry)", async () => {
    repo.findById.mockResolvedValue(
      novelty({
        documents: [],
        status: "PENDIENTE",
        noveltyType: { code: "LLT", name: "Llegada tarde", setsWorkedHoursToZero: true, exportsToFinnegans: false },
      }),
    );
    repo.remove.mockResolvedValue(undefined);

    const result = await noveltiesService.remove("novelty-1", rrhhUser);

    expect(result).toEqual({ id: "novelty-1" });
    expect(repo.remove).toHaveBeenCalledWith("novelty-1");
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
        noveltyType: { code: "VAC", name: "Vacaciones", setsWorkedHoursToZero: false, exportsToFinnegans: true },
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
        noveltyType: { code: "VAC", name: "Vacaciones", setsWorkedHoursToZero: false, exportsToFinnegans: true },
      }),
    );
    repo.remove.mockResolvedValue(undefined);

    const result = await noveltiesService.remove("novelty-1", rrhhUser);

    expect(result).toEqual({ id: "novelty-1" });
    expect(repo.remove).toHaveBeenCalledWith("novelty-1");
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
    allowsDateTo: true,
    hasValidity: false,
    setsWorkedHoursToZero: false,
    blocksTimeEntry: false,
    timeImpact: "NO_AFECTA_HORAS",
    // Etapa 15L.2C: campos nuevos, con el mismo valor que su par legacy de
    // arriba -- mismo estado que un NoveltyType real post-backfill de
    // 15L.2A (docs/decisions/NOVELTY_TYPE_CONSUMER_MIGRATION_15L2C.md).
    allowsDateRange: true,
    finnegansRequiresValidity: false,
    timeEntryBehavior: "NO_BLOQUEA",
    allowedLoadRoles: [] as string[],
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
      rrhhUser.id,
    );
  });

  it("un rol no-RRHH crea la novedad PENDIENTE y notifica a RH", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.supervision] }));

    const items = await noveltiesService.create(createInput(), supervisionUser);

    expect(items).toEqual([{ id: "novelty-new" }]);
    expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "PENDIENTE", supervisionUser.id);
  });

  // Etapa 15G.1 (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
  // decisión funcional final — Novedades NUNCA crea/modifica TimeEntry, sin
  // importar status, rol de quien crea, ni los campos horarios del tipo
  // (setsWorkedHoursToZero/blocksTimeEntry/timeImpact). Estos tests fijan
  // esa garantía para las 4 combinaciones más sensibles: PENDIENTE/APROBADO
  // × setsWorkedHoursToZero true/false — en los 4 casos la llamada a
  // createMany es idéntica en forma (3 argumentos, nunca un 4to "effect").
  it.each([
    { label: "PENDIENTE + setsWorkedHoursToZero=false", user: supervisionUser, status: "PENDIENTE", type: noveltyType({ allowedLoadRoles: [roles.supervision] }) },
    { label: "PENDIENTE + setsWorkedHoursToZero=true", user: supervisionUser, status: "PENDIENTE", type: noveltyType({ allowedLoadRoles: [roles.supervision], setsWorkedHoursToZero: true }) },
    { label: "APROBADO (RRHH) + setsWorkedHoursToZero=false", user: rrhhUser, status: "APROBADO", type: noveltyType() },
    { label: "APROBADO (RRHH) + setsWorkedHoursToZero=true", user: rrhhUser, status: "APROBADO", type: noveltyType({ setsWorkedHoursToZero: true }) },
  ])("$label: createMany se llama sin ningún efecto horario (3 argumentos exactos)", async ({ user, status, type }) => {
    repo.findNoveltyType.mockResolvedValue(type);

    await noveltiesService.create(createInput(), user);

    expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), status, user.id);
    expect(repo.createMany.mock.calls[0]).toHaveLength(3);
  });

  // Caso concreto del usuario: "Llegada tarde" (timeImpact=REGISTRA_HORAS_NO_TRABAJADAS)
  // aprobada por RRHH no debe descontar ni tocar TimeEntry — sigue siendo
  // sólo un registro administrativo.
  it("llegada tarde (timeImpact=REGISTRA_HORAS_NO_TRABAJADAS) aprobada por RRHH no toca TimeEntry", async () => {
    repo.findNoveltyType.mockResolvedValue(
      noveltyType({ code: "LLT", name: "Llegada tarde", allowsHours: true, allowsDateTo: false, timeImpact: "REGISTRA_HORAS_NO_TRABAJADAS" }),
    );

    await noveltiesService.create(createInput({ quantityHours: 1 }), rrhhUser);

    expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "APROBADO", rrhhUser.id);
    expect(repo.createMany.mock.calls[0]).toHaveLength(3);
  });

  it("timeImpact=BLOQUEA_CARGA_DIA tampoco dispara ningún efecto horario al crear", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ timeImpact: "BLOQUEA_CARGA_DIA", blocksTimeEntry: true }));

    await noveltiesService.create(createInput(), rrhhUser);

    expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "APROBADO", rrhhUser.id);
    expect(repo.createMany.mock.calls[0]).toHaveLength(3);
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
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsDateTo: false, allowsDateRange: false }));

    await expect(
      noveltiesService.create(createInput({ fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-12") }), rrhhUser),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TO_DATE_NOT_ALLOWED" });
  });

  // Etapa 15L.2C (docs/decisions/NOVELTY_TYPE_CONSUMER_MIGRATION_15L2C.md):
  // allowsDateRange es la única fuente productiva -- allowsDateTo (legacy)
  // ya no se lee, aunque siga existiendo y sincronizado 1:1 en el modelo.
  it("allowsDateRange=false bloquea toDate aunque allowsDateTo (legacy) diga lo contrario", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsDateTo: true, allowsDateRange: false }));

    await expect(
      noveltiesService.create(createInput({ fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-12") }), rrhhUser),
    ).rejects.toMatchObject({ statusCode: 400, code: "NOVELTY_TO_DATE_NOT_ALLOWED" });
  });

  it("allowsDateRange=true permite toDate aunque allowsDateTo (legacy) diga lo contrario", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ allowsDateTo: false, allowsDateRange: true }));

    await expect(
      noveltiesService.create(createInput({ fromDate: new Date("2026-08-10"), toDate: new Date("2026-08-12") }), rrhhUser),
    ).resolves.toBeDefined();
  });

  it("exige fechaDesde y fechaHasta cuando el tipo tiene vigencia obligatoria (NOVELTY_VALIDITY_REQUIRED)", async () => {
    repo.findNoveltyType.mockResolvedValue(noveltyType({ hasValidity: true, allowsDateTo: true, finnegansRequiresValidity: true, allowsDateRange: true }));

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

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "PENDIENTE", supervisionUser.id);
      const { notifyRrhh } = await import("../workforce-management/workforce.service");
      expect(notifyRrhh).toHaveBeenCalled();
    });

    it("Nivel 2 con requiresApproval=false crea APROBADO directo y NO notifica a RH", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.supervision], requiresApproval: false }));

      await noveltiesService.create(createInput(), supervisionUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "APROBADO", supervisionUser.id);
      const { notifyRrhh } = await import("../workforce-management/workforce.service");
      expect(notifyRrhh).not.toHaveBeenCalled();
    });

    it("Nivel 3 con requiresApproval=false crea APROBADO directo (mismo criterio que Nivel 2)", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.cargaHoraria], requiresApproval: false }));

      await noveltiesService.create(createInput(), cargaUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "APROBADO", cargaUser.id);
    });

    it("Nivel 3 con requiresApproval=true crea PENDIENTE", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.cargaHoraria], requiresApproval: true }));

      await noveltiesService.create(createInput(), cargaUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "PENDIENTE", cargaUser.id);
    });

    it("requiresApproval ausente (undefined) sigue tratandose como true — sin cambio de comportamiento", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ allowedLoadRoles: [roles.supervision] }));

      await noveltiesService.create(createInput(), supervisionUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "PENDIENTE", supervisionUser.id);
    });

    it("RRHH crea APROBADO sin importar requiresApproval, incluso si el tipo tiene requiresApproval=false", async () => {
      repo.findNoveltyType.mockResolvedValue(noveltyType({ requiresApproval: false }));

      await noveltiesService.create(createInput(), rrhhUser);

      expect(repo.createMany).toHaveBeenCalledWith(expect.anything(), "APROBADO", rrhhUser.id);
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
