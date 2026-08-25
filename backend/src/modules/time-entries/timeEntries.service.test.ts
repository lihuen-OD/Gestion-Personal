import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { prisma } from "../../shared/prisma/client";
import { timeEntriesRepository } from "./timeEntries.repository";
import { timeEntriesService, clockAttemptHash, resolveShiftConcept } from "./timeEntries.service";
import { flagOpenShiftOverflowForReview } from "../shifts/workShiftEvaluationRunner";
import { resolveActiveWorkRegime } from "../work-regimes/workRegimes.service";

vi.mock("./timeEntries.repository", () => ({
  timeEntriesRepository: {
    findEmployeeByDniForClock: vi.fn(),
    findEmployeeByIdForClock: vi.fn(),
    findOpenWorkShift: vi.fn(),
    createOpenWorkShift: vi.fn(),
    rolloverExpiredOpenWorkShift: vi.fn(),
    createObservedPunch: vi.fn(),
    closeOpenWorkShift: vi.fn(),
    findDefaultHourConcept: vi.fn(),
    findBlockingNovelty: vi.fn(),
    findClockValidationContext: vi.fn(),
    createClockPunchAttempt: vi.fn(),
    findClockPunchAttempt: vi.fn(),
    completeClockPunchAttempt: vi.fn(),
    failClockPunchAttempt: vi.fn(),
    findMany: vi.fn(),
    findPeriodEmployees: vi.fn(),
    findEmployeeForShift: vi.fn(),
    findOverlappingWorkShift: vi.fn(),
    createFromWorkShift: vi.fn(),
    findForExport: vi.fn(),
    findBreakdownHoursForExport: vi.fn(),
    countEmployeeInScope: vi.fn(),
    findHourConceptById: vi.fn(),
    findEnabledHourConcept: vi.fn(),
    findDuplicate: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    returnForCorrection: vi.fn(),
  },
}));

// update()/approve() leen prisma.monthlyTimeClosure directo (no hay
// repositorio intermedio para esa única consulta) — se mockea sólo ese
// método; el resto de este archivo sigue sin pegarle a una base real porque
// todo lo demás pasa por timeEntriesRepository (mockeado arriba) o por
// resolveActiveWorkRegime (mockeado abajo).
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    monthlyTimeClosure: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("../workforce-management/workforce.service", () => ({
  notifyUsers: vi.fn().mockResolvedValue(undefined),
  attendanceRecipients: vi.fn().mockResolvedValue([]),
  notifyRrhh: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../shifts/workShiftEvaluationRunner", () => ({
  evaluateShiftEntry: vi.fn().mockResolvedValue(undefined),
  evaluateShiftExit: vi.fn().mockResolvedValue(undefined),
  notifyClassificationAlerts: vi.fn().mockResolvedValue(undefined),
  flagOpenShiftOverflowForReview: vi.fn().mockResolvedValue(undefined),
}));

// Por defecto sin régimen vigente: comportamiento igual que antes de esta
// etapa (ver política de rollover por régimen). Este archivo no mockea
// prisma directo — si no se mockeara este módulo, resolveActiveWorkRegime
// pegaría contra la base real.
vi.mock("../work-regimes/workRegimes.service", () => ({
  resolveActiveWorkRegime: vi.fn().mockResolvedValue(null),
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

// Sin reglas activas ni conceptos habilitados: ejercita a proposito el modo
// de compatibilidad hacia atras de la clasificacion (etapa de Turnos V1) en
// vez de pegarle a una base real — este archivo no mockea prisma directo.
vi.mock("../hour-concepts/hourConcepts.repository", () => ({
  hourConceptsRepository: {
    findActiveRules: vi.fn().mockResolvedValue([]),
    findEnabledConceptIds: vi.fn().mockResolvedValue(new Set()),
  },
}));

type RepoMock = {
  findEmployeeByDniForClock: Mock;
  findEmployeeByIdForClock: Mock;
  findOpenWorkShift: Mock;
  createOpenWorkShift: Mock;
  rolloverExpiredOpenWorkShift: Mock;
  createObservedPunch: Mock;
  closeOpenWorkShift: Mock;
  findDefaultHourConcept: Mock;
  findBlockingNovelty: Mock;
  findClockValidationContext: Mock;
  createClockPunchAttempt: Mock;
  findClockPunchAttempt: Mock;
  completeClockPunchAttempt: Mock;
  failClockPunchAttempt: Mock;
  findMany: Mock;
  findPeriodEmployees: Mock;
  findEmployeeForShift: Mock;
  findOverlappingWorkShift: Mock;
  createFromWorkShift: Mock;
  findForExport: Mock;
  findBreakdownHoursForExport: Mock;
  countEmployeeInScope: Mock;
  findHourConceptById: Mock;
  findEnabledHourConcept: Mock;
  findDuplicate: Mock;
  create: Mock;
  findById: Mock;
  update: Mock;
  approve: Mock;
  reject: Mock;
  returnForCorrection: Mock;
};

const repo = timeEntriesRepository as unknown as RepoMock;
const mockedMonthlyClosureFindUnique = prisma.monthlyTimeClosure.findUnique as unknown as Mock;
const mockedResolveActiveWorkRegime = resolveActiveWorkRegime as unknown as Mock;
const mockedFlagOpenShiftOverflowForReview = flagOpenShiftOverflowForReview as unknown as Mock;

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("mock prisma error", { code, clientVersion: "0.0.0" });
}

const activeEmployee = {
  id: "employee-1",
  legajo: "100",
  dni: "30000000",
  cuil: "20300000001",
  firstName: "Ana",
  lastName: "Gomez",
  status: "ACTIVO",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("timeEntriesService DTO operativo Nivel 3", () => {
  const cargaUser = { id: "user-carga", role: "NIVEL_3_CARGA_HORARIA" } as Express.AuthUser;
  const operationalEmployee = {
    id: "employee-1",
    legajo: "100",
    firstName: "Ana",
    lastName: "Gomez",
    status: "ACTIVO",
    dni: "30000000",
    cuil: "20300000001",
    sector: { name: "Administración" },
    costCenter: { name: "Central" },
    position: { name: "Administrativa" },
  };

  it("GET lógico de time entries no devuelve DNI/CUIL", async () => {
    repo.findMany.mockResolvedValue([[{ id: "entry-1", employee: operationalEmployee }], 1]);

    const result = await timeEntriesService.list({ page: 1, take: 25 } as never, cargaUser);

    expect(result.items[0]?.employee).toMatchObject({ legajo: "100", firstName: "Ana", lastName: "Gomez" });
    expect(result.items[0]?.employee).not.toHaveProperty("dni");
    expect(result.items[0]?.employee).not.toHaveProperty("cuil");
  });

  it("period-employees mantiene estructura operativa sin DNI/CUIL", async () => {
    repo.findPeriodEmployees.mockResolvedValue({
      items: [{ employee: operationalEmployee, summary: { total: 8 } }],
      total: 1,
    });

    const result = await timeEntriesService.periodEmployees({ period: "2026-08", page: 1, take: 25 } as never, cargaUser);

    expect(result.items[0]?.employee).toMatchObject({
      legajo: "100",
      sector: { name: "Administración" },
      costCenter: { name: "Central" },
      position: { name: "Administrativa" },
    });
    expect(result.items[0]?.employee).not.toHaveProperty("dni");
    expect(result.items[0]?.employee).not.toHaveProperty("cuil");
  });
});

describe("create — carga manual de la grilla: Hora normal es universal (bug fichador/grilla)", () => {
  const rrhhUser = { id: "user-rrhh", role: "NIVEL_1_RRHH" } as Express.AuthUser;
  const normalConcept = {
    id: "hour-concept-normal",
    code: "HC-NORMAL",
    name: "Hora normal",
    status: "ACTIVO",
    systemRole: "NORMAL_BASE",
  };
  const overtimeConcept = {
    id: "hour-concept-overtime",
    code: "HC-EXTRA",
    name: "Hora extra",
    status: "ACTIVO",
    systemRole: null,
  };
  const createInput = { employeeId: "employee-1", hourConceptId: normalConcept.id, date: new Date("2026-08-10T00:00:00Z"), hours: 8 };
  const createdEntry = { id: "entry-1", hours: 8, employee: { legajo: "100" } };

  beforeEach(() => {
    repo.countEmployeeInScope.mockResolvedValue(1);
    repo.findBlockingNovelty.mockResolvedValue(null);
    repo.findDuplicate.mockResolvedValue(null);
    repo.create.mockResolvedValue(createdEntry);
  });

  it("un empleado sin ningún EmployeeHourConcept asignado puede cargar Hora normal manualmente", async () => {
    repo.findHourConceptById.mockResolvedValue(normalConcept);

    const result = await timeEntriesService.create(createInput, rrhhUser);

    expect(result).toBe(createdEntry);
    expect(repo.create).toHaveBeenCalledWith(createInput, rrhhUser.id, rrhhUser.id);
  });

  it("cargar Hora normal no consulta ni requiere EmployeeHourConcept", async () => {
    repo.findHourConceptById.mockResolvedValue(normalConcept);

    await timeEntriesService.create(createInput, rrhhUser);

    expect(repo.findEnabledHourConcept).not.toHaveBeenCalled();
  });

  it("cargar Hora normal crea el TimeEntry correspondiente", async () => {
    repo.findHourConceptById.mockResolvedValue(normalConcept);

    await timeEntriesService.create(createInput, rrhhUser);

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ hourConceptId: normalConcept.id, hours: 8 }), rrhhUser.id, rrhhUser.id);
  });

  it("cargar Hora normal no crea ningún HourConceptBreakdown", async () => {
    repo.findHourConceptById.mockResolvedValue(normalConcept);

    await timeEntriesService.create(createInput, rrhhUser);

    // El repositorio de time-entries no expone ninguna operación de breakdown:
    // sólo se invoca timeEntriesRepository.create (TimeEntry), nada más.
    const calledMethods = Object.entries(repo)
      .filter(([, mock]) => (mock as Mock).mock.calls.length > 0)
      .map(([name]) => name);
    expect(calledMethods).not.toContain("createManualHourConceptBreakdown");
    expect(calledMethods.sort()).toEqual(["countEmployeeInScope", "create", "findBlockingNovelty", "findDuplicate", "findHourConceptById"]);
  });

  it("un concepto adicional NO habilitado para el legajo sigue rechazado", async () => {
    repo.findHourConceptById.mockResolvedValue(overtimeConcept);
    repo.findEnabledHourConcept.mockResolvedValue(null);

    await expect(
      timeEntriesService.create({ ...createInput, hourConceptId: overtimeConcept.id }, rrhhUser),
    ).rejects.toMatchObject({ code: "HOUR_CONCEPT_NOT_ENABLED", statusCode: 400 });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("un concepto adicional habilitado para el legajo sigue funcionando", async () => {
    repo.findHourConceptById.mockResolvedValue(overtimeConcept);
    repo.findEnabledHourConcept.mockResolvedValue({ hourConcept: overtimeConcept });

    const result = await timeEntriesService.create({ ...createInput, hourConceptId: overtimeConcept.id }, rrhhUser);

    expect(result).toBe(createdEntry);
    expect(repo.findEnabledHourConcept).toHaveBeenCalledWith(createInput.employeeId, overtimeConcept.id);
  });

  it("Hora normal se identifica por systemRole=NORMAL_BASE, no por el nombre visible del concepto", async () => {
    // Mismo systemRole, nombre distinto al literal "Hora normal": igual debe
    // saltear la validación de EmployeeHourConcept.
    repo.findHourConceptById.mockResolvedValue({ ...normalConcept, name: "Jornada base" });

    await timeEntriesService.create(createInput, rrhhUser);

    expect(repo.findEnabledHourConcept).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it("el error 'tipo de hora no habilitado' no aplica a Hora normal aunque el empleado no tenga conceptos adicionales", async () => {
    repo.findHourConceptById.mockResolvedValue(normalConcept);
    repo.findEnabledHourConcept.mockResolvedValue(null);

    await expect(timeEntriesService.create(createInput, rrhhUser)).resolves.toBe(createdEntry);
  });
});

describe("create — flujo de aprobación por rol (Etapa 6L.3)", () => {
  const nivel2User = { id: "user-n2", role: "NIVEL_2_SUPERVISION" } as Express.AuthUser;
  const nivel3User = { id: "user-n3", role: "NIVEL_3_CARGA_HORARIA" } as Express.AuthUser;
  const normalConcept = { id: "hour-concept-normal", code: "HC-NORMAL", name: "Hora normal", status: "ACTIVO", systemRole: "NORMAL_BASE" };
  const createInput = { employeeId: "employee-1", hourConceptId: normalConcept.id, date: new Date("2026-08-10T00:00:00Z"), hours: 8 };
  const createdEntry = { id: "entry-1", hours: 8, employee: { legajo: "100" } };

  beforeEach(() => {
    repo.countEmployeeInScope.mockResolvedValue(1);
    repo.findHourConceptById.mockResolvedValue(normalConcept);
    repo.findBlockingNovelty.mockResolvedValue(null);
    repo.findDuplicate.mockResolvedValue(null);
    repo.create.mockResolvedValue(createdEntry);
  });

  it("RRHH crea Hora normal y queda aprobada/aplicada directamente: pasa su propio id como autoApprovedByUserId", async () => {
    const rrhhUser = { id: "user-rrhh", role: "NIVEL_1_RRHH" } as Express.AuthUser;

    await timeEntriesService.create(createInput, rrhhUser);

    expect(repo.create).toHaveBeenCalledWith(createInput, rrhhUser.id, rrhhUser.id);
  });

  it("Nivel 2 crea Hora normal y queda pendiente/en revisión: no se pasa autoApprovedByUserId", async () => {
    await timeEntriesService.create(createInput, nivel2User);

    expect(repo.create).toHaveBeenCalledWith(createInput, nivel2User.id, null);
  });

  it("Nivel 3 crea Hora normal y queda pendiente/en revisión: no se pasa autoApprovedByUserId", async () => {
    await timeEntriesService.create(createInput, nivel3User);

    expect(repo.create).toHaveBeenCalledWith(createInput, nivel3User.id, null);
  });
});

describe("update — flujo de aprobación por rol (Etapa 6L.3)", () => {
  const rrhhUser = { id: "user-rrhh", role: "NIVEL_1_RRHH" } as Express.AuthUser;
  const nivel3User = { id: "user-n3", role: "NIVEL_3_CARGA_HORARIA" } as Express.AuthUser;
  const existingEntry = {
    id: "entry-1",
    employeeId: "employee-1",
    hourConceptId: "hour-concept-normal",
    date: new Date("2026-08-10T00:00:00Z"),
    period: "2026-08",
    status: "BORRADOR",
    createdByUserId: "user-n3",
    employee: { legajo: "100" },
  };
  const updatedEntry = { id: "entry-1", hours: 6, employee: { legajo: "100" } };

  beforeEach(() => {
    repo.findById.mockResolvedValue(existingEntry);
    repo.findHourConceptById.mockResolvedValue({ id: "hour-concept-normal", status: "ACTIVO", systemRole: "NORMAL_BASE" });
    repo.findBlockingNovelty.mockResolvedValue(null);
    repo.findDuplicate.mockResolvedValue(null);
    repo.update.mockResolvedValue(updatedEntry);
    mockedMonthlyClosureFindUnique.mockResolvedValue(null);
  });

  it("RRHH actualiza Hora normal y no queda en revisión: pasa su propio id como autoApprovedByUserId", async () => {
    const result = await timeEntriesService.update("entry-1", { hours: 6 }, rrhhUser);

    expect(result).toBe(updatedEntry);
    expect(repo.update).toHaveBeenCalledWith("entry-1", existingEntry, { hours: 6 }, rrhhUser.id);
  });

  it("Nivel 3 actualiza Hora normal y el status queda intacto (sin autoaprobación)", async () => {
    await timeEntriesService.update("entry-1", { hours: 6 }, nivel3User);

    expect(repo.update).toHaveBeenCalledWith("entry-1", existingEntry, { hours: 6 }, null);
  });

  it("un período cerrado sigue bloqueando la edición de Nivel 2/3 aunque RRHH edite libre (no se rompe el bloqueo de cierre)", async () => {
    mockedMonthlyClosureFindUnique.mockResolvedValue({ status: "APROBADO" });

    await expect(timeEntriesService.update("entry-1", { hours: 6 }, nivel3User)).rejects.toMatchObject({
      code: "PERIOD_CLOSED_REQUIRES_CORRECTION",
    });
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe("approve/reject/return — la aprobación final es exclusiva de RRHH (Etapa 6L.3, ajuste)", () => {
  const rrhhUser = { id: "user-rrhh", role: "NIVEL_1_RRHH" } as Express.AuthUser;
  const supervisionUser = { id: "user-sup", role: "NIVEL_2_SUPERVISION" } as Express.AuthUser;
  const nivel3User = { id: "user-n3", role: "NIVEL_3_CARGA_HORARIA" } as Express.AuthUser;
  const ownEntryInReview = { id: "entry-1", status: "EN_REVISION", createdByUserId: "user-sup", employee: { legajo: "100" } };
  const nivel2EntryInReview = { id: "entry-2", status: "EN_REVISION", createdByUserId: "user-sup", employee: { legajo: "101" } };
  const nivel3EntryInReview = { id: "entry-3", status: "EN_REVISION", createdByUserId: "user-n3", employee: { legajo: "102" } };

  it("RRHH aprueba una carga de Nivel 2", async () => {
    repo.findById.mockResolvedValue(nivel2EntryInReview);
    repo.approve.mockResolvedValue({ id: "entry-2", status: "APROBADO", employee: { legajo: "101" } });

    await expect(timeEntriesService.approve("entry-2", rrhhUser)).resolves.toMatchObject({ status: "APROBADO" });
    expect(repo.approve).toHaveBeenCalledWith("entry-2", rrhhUser.id);
  });

  it("RRHH aprueba una carga de Nivel 3", async () => {
    repo.findById.mockResolvedValue(nivel3EntryInReview);
    repo.approve.mockResolvedValue({ id: "entry-3", status: "APROBADO", employee: { legajo: "102" } });

    await expect(timeEntriesService.approve("entry-3", rrhhUser)).resolves.toMatchObject({ status: "APROBADO" });
    expect(repo.approve).toHaveBeenCalledWith("entry-3", rrhhUser.id);
  });

  it("Nivel 2 no puede aprobar una carga propia", async () => {
    repo.findById.mockResolvedValue(ownEntryInReview);

    await expect(timeEntriesService.approve("entry-1", supervisionUser)).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(repo.approve).not.toHaveBeenCalled();
  });

  it("Nivel 2 no puede aprobar una carga ajena (ni siquiera de Nivel 3): el rol se valida antes de buscar la carga", async () => {
    repo.findById.mockResolvedValue(nivel3EntryInReview);

    await expect(timeEntriesService.approve("entry-3", supervisionUser)).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(repo.approve).not.toHaveBeenCalled();
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("Nivel 3 no puede aprobar ninguna carga (ni propia ni ajena)", async () => {
    repo.findById.mockResolvedValue(nivel2EntryInReview);

    await expect(timeEntriesService.approve("entry-2", nivel3User)).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(repo.approve).not.toHaveBeenCalled();
  });

  it("RRHH sigue pudiendo rechazar una carga de Nivel 2/3", async () => {
    repo.findById.mockResolvedValue(nivel2EntryInReview);
    repo.reject.mockResolvedValue({ id: "entry-2", status: "RECHAZADO", employee: { legajo: "101" } });

    await expect(timeEntriesService.reject("entry-2", { reason: "Datos incorrectos" }, rrhhUser)).resolves.toMatchObject({ status: "RECHAZADO" });
  });

  it("RRHH sigue pudiendo devolver una carga de Nivel 2/3", async () => {
    repo.findById.mockResolvedValue(nivel2EntryInReview);
    repo.returnForCorrection.mockResolvedValue({ id: "entry-2", status: "DEVUELTO", employee: { legajo: "101" } });

    await expect(timeEntriesService.returnForCorrection("entry-2", { reason: "Falta observación" }, rrhhUser)).resolves.toMatchObject({ status: "DEVUELTO" });
  });

  it("Nivel 2 no puede rechazar ni devolver cargas ajenas", async () => {
    repo.findById.mockResolvedValue(nivel3EntryInReview);

    await expect(timeEntriesService.reject("entry-3", { reason: "x" }, supervisionUser)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(timeEntriesService.returnForCorrection("entry-3", { reason: "x" }, supervisionUser)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.reject).not.toHaveBeenCalled();
    expect(repo.returnForCorrection).not.toHaveBeenCalled();
  });
});

describe("clockInByEmployee", () => {
  it("crea un turno abierto cuando el empleado no tiene ninguno (camino feliz)", async () => {
    repo.findEmployeeByIdForClock.mockResolvedValue(activeEmployee);
    repo.findOpenWorkShift.mockResolvedValue(null);
    repo.createOpenWorkShift.mockResolvedValue({ id: "shift-1", startAt: new Date() });

    const result = await timeEntriesService.clockInByEmployee({ employeeId: activeEmployee.id });

    expect(result.workShift.id).toBe("shift-1");
    expect(repo.createOpenWorkShift).toHaveBeenCalledTimes(1);
  });

  it("registra una fichada observada y responde 409 si ya hay un turno abierto reciente", async () => {
    repo.findEmployeeByIdForClock.mockResolvedValue(activeEmployee);
    repo.findOpenWorkShift.mockResolvedValue({ id: "shift-open", startAt: new Date() });

    await expect(timeEntriesService.clockInByEmployee({ employeeId: activeEmployee.id })).rejects.toMatchObject({
      statusCode: 409,
      code: "CLOCK_ALREADY_OPEN",
    });
    expect(repo.createObservedPunch).toHaveBeenCalledTimes(1);
    expect(repo.createOpenWorkShift).not.toHaveBeenCalled();
  });

  it("mapea una violacion de unicidad concurrente (P2002) a un 409 prolijo en vez de un 500 (regresion Bloque 1)", async () => {
    repo.findEmployeeByIdForClock.mockResolvedValue(activeEmployee);
    repo.findOpenWorkShift.mockResolvedValue(null);
    repo.createOpenWorkShift.mockRejectedValue(prismaKnownError("P2002"));

    await expect(timeEntriesService.clockInByEmployee({ employeeId: activeEmployee.id })).rejects.toMatchObject({
      statusCode: 409,
      code: "CLOCK_ALREADY_OPEN",
    });
  });

  it("no mapea otros errores de Prisma distintos de P2002 (deben seguir propagandose sin transformarse en AppError)", async () => {
    repo.findEmployeeByIdForClock.mockResolvedValue(activeEmployee);
    repo.findOpenWorkShift.mockResolvedValue(null);
    repo.createOpenWorkShift.mockRejectedValue(prismaKnownError("P2003"));

    let caught: unknown;
    try {
      await timeEntriesService.clockInByEmployee({ employeeId: activeEmployee.id });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(caught).not.toBeInstanceOf(AppError);
  });
});

describe("clockInByEmployee — política de rollover por régimen (jornada abierta excedida)", () => {
  const excedidaShift = { id: "shift-excedida", startAt: new Date(Date.now() - 21 * 60 * 60 * 1000) };

  it("Caso A — sin régimen vigente: conserva el rollover automático (comportamiento actual)", async () => {
    repo.findEmployeeByIdForClock.mockResolvedValue(activeEmployee);
    repo.findOpenWorkShift.mockResolvedValue(excedidaShift);
    mockedResolveActiveWorkRegime.mockResolvedValueOnce(null);
    repo.rolloverExpiredOpenWorkShift.mockResolvedValue({ id: "shift-new", startAt: new Date() });

    const result = await timeEntriesService.clockInByEmployee({ employeeId: activeEmployee.id });

    expect(repo.rolloverExpiredOpenWorkShift).toHaveBeenCalledTimes(1);
    expect(repo.createObservedPunch).not.toHaveBeenCalled();
    expect(result.previousOpenShift?.status).toBe("FALTA_SALIDA");
  });

  it("Caso E — régimen ROLLOVER: conserva el rollover automático (comportamiento actual)", async () => {
    repo.findEmployeeByIdForClock.mockResolvedValue(activeEmployee);
    repo.findOpenWorkShift.mockResolvedValue(excedidaShift);
    mockedResolveActiveWorkRegime.mockResolvedValueOnce({ kind: "TURNO_OBLIGATORIO", alertOnOutOfShift: true, openShiftOverflowAction: "ROLLOVER" });
    repo.rolloverExpiredOpenWorkShift.mockResolvedValue({ id: "shift-new", startAt: new Date() });

    const result = await timeEntriesService.clockInByEmployee({ employeeId: activeEmployee.id });

    expect(repo.rolloverExpiredOpenWorkShift).toHaveBeenCalledTimes(1);
    expect(mockedFlagOpenShiftOverflowForReview).not.toHaveBeenCalled();
    expect(result.previousOpenShift?.status).toBe("FALTA_SALIDA");
  });

  it("Caso D — régimen ALERT_ONLY: no hace rollover, no crea una segunda jornada, responde 409 compatible y marca para revisión", async () => {
    repo.findEmployeeByIdForClock.mockResolvedValue(activeEmployee);
    repo.findOpenWorkShift.mockResolvedValue(excedidaShift);
    mockedResolveActiveWorkRegime.mockResolvedValueOnce({ kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false, openShiftOverflowAction: "ALERT_ONLY" });

    await expect(timeEntriesService.clockInByEmployee({ employeeId: activeEmployee.id })).rejects.toMatchObject({
      statusCode: 409,
      code: "CLOCK_ALREADY_OPEN",
    });

    expect(repo.rolloverExpiredOpenWorkShift).not.toHaveBeenCalled();
    expect(repo.createOpenWorkShift).not.toHaveBeenCalled();
    expect(repo.createObservedPunch).toHaveBeenCalledTimes(1);
    expect(mockedFlagOpenShiftOverflowForReview).toHaveBeenCalledTimes(1);
    expect(mockedFlagOpenShiftOverflowForReview).toHaveBeenCalledWith(activeEmployee.id, excedidaShift.id, expect.any(Number), expect.any(Date));
  });

  it("Caso G — idempotencia: dos intentos de ingreso seguidos bajo ALERT_ONLY nunca hacen rollover ni crean una segunda jornada", async () => {
    repo.findEmployeeByIdForClock.mockResolvedValue(activeEmployee);
    repo.findOpenWorkShift.mockResolvedValue(excedidaShift);
    mockedResolveActiveWorkRegime.mockResolvedValue({ kind: "TURNO_FLEXIBLE", alertOnOutOfShift: false, openShiftOverflowAction: "ALERT_ONLY" });

    await expect(timeEntriesService.clockInByEmployee({ employeeId: activeEmployee.id })).rejects.toMatchObject({ code: "CLOCK_ALREADY_OPEN" });
    await expect(timeEntriesService.clockInByEmployee({ employeeId: activeEmployee.id })).rejects.toMatchObject({ code: "CLOCK_ALREADY_OPEN" });

    expect(repo.rolloverExpiredOpenWorkShift).not.toHaveBeenCalled();
    expect(repo.createOpenWorkShift).not.toHaveBeenCalled();
    expect(mockedFlagOpenShiftOverflowForReview).toHaveBeenCalledTimes(2); // createShiftAlert (mockeado acá) es quien deduplica por upsert
  });
});

describe("clockOutByEmployee", () => {
  it("registra una fichada observada y responde 409 si no hay turno abierto", async () => {
    repo.findEmployeeByIdForClock.mockResolvedValue(activeEmployee);
    repo.findOpenWorkShift.mockResolvedValue(null);

    await expect(timeEntriesService.clockOutByEmployee({ employeeId: activeEmployee.id })).rejects.toMatchObject({
      statusCode: 409,
      code: "CLOCK_NO_OPEN_SHIFT",
    });
    expect(repo.createObservedPunch).toHaveBeenCalledTimes(1);
  });

  it("cierra el turno abierto (camino feliz)", async () => {
    const startAt = new Date(Date.now() - 60 * 60_000);
    repo.findEmployeeByIdForClock.mockResolvedValue(activeEmployee);
    repo.findOpenWorkShift.mockResolvedValue({ id: "shift-open", startAt });
    repo.findDefaultHourConcept.mockResolvedValue({ hourConcept: { id: "concept-1", name: "Normal", status: "ACTIVO" } });
    repo.findBlockingNovelty.mockResolvedValue(null);
    repo.closeOpenWorkShift.mockResolvedValue({
      workShift: { id: "shift-open", startAt, endAt: new Date(), totalMinutes: 60 },
      entries: [],
      timeSegments: [],
    });

    const result = await timeEntriesService.clockOutByEmployee({ employeeId: activeEmployee.id });

    expect(result.workShift.id).toBe("shift-open");
    expect(repo.closeOpenWorkShift).toHaveBeenCalledTimes(1);
  });

  it("mapea un cierre concurrente (WORK_SHIFT_ALREADY_CLOSED) a un 409 prolijo (regresion Bloque 1)", async () => {
    const startAt = new Date(Date.now() - 60 * 60_000);
    repo.findEmployeeByIdForClock.mockResolvedValue(activeEmployee);
    repo.findOpenWorkShift.mockResolvedValue({ id: "shift-open", startAt });
    repo.findDefaultHourConcept.mockResolvedValue({ hourConcept: { id: "concept-1", name: "Normal", status: "ACTIVO" } });
    repo.findBlockingNovelty.mockResolvedValue(null);
    repo.closeOpenWorkShift.mockRejectedValue(new Error("WORK_SHIFT_ALREADY_CLOSED"));

    await expect(timeEntriesService.clockOutByEmployee({ employeeId: activeEmployee.id })).rejects.toMatchObject({
      statusCode: 409,
      code: "CLOCK_ALREADY_CLOSED",
    });
  });
});

describe("resolveShiftConcept — Etapa 6K (fichador resuelve Normal canónico, sin conceptos adicionales)", () => {
  const normalConcept = { id: "concept-normal", name: "Hora normal", status: "ACTIVO", systemRole: "NORMAL_BASE" };
  const serenoConcept = { id: "concept-sereno", name: "Sereno", status: "ACTIVO", systemRole: null };

  it("sin hourConceptId, resuelve el concepto que devuelva findDefaultHourConcept (ya filtra por systemRole NORMAL_BASE en el repositorio)", async () => {
    repo.findDefaultHourConcept.mockResolvedValue({ hourConcept: normalConcept });

    const result = await resolveShiftConcept(activeEmployee.id);

    expect(result).toEqual(normalConcept);
    expect(repo.findDefaultHourConcept).toHaveBeenCalledWith(activeEmployee.id, undefined);
  });

  it("con hourConceptId apuntando a Normal y restrictToNormalBase, lo acepta (mismo resultado que no mandar nada)", async () => {
    repo.findDefaultHourConcept.mockResolvedValue({ hourConcept: normalConcept });

    const result = await resolveShiftConcept(activeEmployee.id, normalConcept.id, { restrictToNormalBase: true });

    expect(result).toEqual(normalConcept);
  });

  it("con hourConceptId apuntando a un concepto adicional (Sereno) y restrictToNormalBase, lo rechaza explícitamente — no permite fichar como Sereno/Colectivo/Guardia", async () => {
    repo.findDefaultHourConcept.mockResolvedValue({ hourConcept: serenoConcept });

    await expect(resolveShiftConcept(activeEmployee.id, serenoConcept.id, { restrictToNormalBase: true })).rejects.toMatchObject({
      statusCode: 409,
      code: "CLOCK_HOUR_CONCEPT_NOT_ALLOWED",
    });
  });

  it("con hourConceptId apuntando a un concepto adicional pero SIN restrictToNormalBase (alta manual de RRHH), lo sigue permitiendo", async () => {
    repo.findDefaultHourConcept.mockResolvedValue({ hourConcept: serenoConcept });

    const result = await resolveShiftConcept(activeEmployee.id, serenoConcept.id);

    expect(result).toEqual(serenoConcept);
  });

  it("si el concepto no está habilitado para el empleado, sigue respondiendo WORK_SHIFT_HOUR_CONCEPT_NOT_ENABLED (comportamiento previo intacto)", async () => {
    repo.findDefaultHourConcept.mockResolvedValue(null);

    await expect(resolveShiftConcept(activeEmployee.id, "concept-inexistente", { restrictToNormalBase: true })).rejects.toMatchObject({
      statusCode: 400,
      code: "WORK_SHIFT_HOUR_CONCEPT_NOT_ENABLED",
    });
  });
});

describe("createWorkShift — alta manual RRHH ya no crea TimeEntry especiales (Etapa 6L)", () => {
  const adminUser = { id: "user-rrhh", role: "NIVEL_1_RRHH" } as Express.AuthUser;
  const normalConcept = { id: "concept-normal", name: "Hora normal", status: "ACTIVO", systemRole: "NORMAL_BASE" };
  const guardiaConcept = { id: "concept-guardia", name: "Guardia", status: "ACTIVO", systemRole: null };

  it("aunque RRHH asocie explícitamente un concepto adicional (Guardia) al alta manual, el TimeEntry generado usa Hora normal canónica, no el concepto elegido", async () => {
    repo.findEmployeeForShift.mockResolvedValue(activeEmployee);
    repo.findOverlappingWorkShift.mockResolvedValue(null);
    repo.findBlockingNovelty.mockResolvedValue(null);
    // findDefaultHourConcept se llama dos veces: una con el id explícito (Guardia,
    // para el clasificador legacy) y otra sin id (Normal, para el TimeEntry real).
    repo.findDefaultHourConcept.mockImplementation(async (_employeeId: string, hourConceptId?: string) =>
      hourConceptId ? { hourConcept: guardiaConcept } : { hourConcept: normalConcept },
    );
    repo.createFromWorkShift.mockResolvedValue({
      workShift: { id: "shift-1" },
      entries: [{ id: "entry-1", hourConceptId: normalConcept.id }],
      timeSegments: [],
    });

    const input = {
      employeeId: activeEmployee.id,
      hourConceptId: guardiaConcept.id,
      startAt: new Date("2026-08-24T13:00:00.000Z"),
      endAt: new Date("2026-08-24T17:00:00.000Z"),
      source: "ADMIN",
      confirm: true as const,
    } as unknown as Parameters<typeof timeEntriesService.createWorkShift>[0];

    await timeEntriesService.createWorkShift(input, adminUser);

    expect(repo.findDefaultHourConcept).toHaveBeenCalledWith(activeEmployee.id, guardiaConcept.id);
    expect(repo.findDefaultHourConcept).toHaveBeenCalledWith(activeEmployee.id, undefined);
    expect(repo.createFromWorkShift).toHaveBeenCalledTimes(1);
    const persistedInput = repo.createFromWorkShift.mock.calls[0]![0] as { normalHourConceptId: string; normalHourConceptName: string };
    expect(persistedInput.normalHourConceptId).toBe(normalConcept.id);
    expect(persistedInput.normalHourConceptName).toBe(normalConcept.name);
  });
});

function clockPhotoPunchInput() {
  return {
    requestId: "11111111-1111-1111-1111-111111111111",
    employeeId: activeEmployee.id,
    punchType: "IN" as const,
    hourConceptId: "concept-1",
    photo: "data:image/jpeg;base64,AAAA",
    faceValidationStatus: "VALID" as const,
  };
}

describe("clockPhotoPunchIdempotent", () => {
  it("responde con la respuesta ya guardada si el intento esta COMPLETED, sin re-ejecutar la fichada", async () => {
    const input = clockPhotoPunchInput();
    repo.findClockValidationContext.mockResolvedValue({ ...activeEmployee, workShifts: [], hourConcepts: [] });
    const requestHash = clockAttemptHash(input);
    repo.createClockPunchAttempt.mockRejectedValue(prismaKnownError("P2002"));
    repo.findClockPunchAttempt.mockResolvedValue({
      requestId: input.requestId,
      employeeId: input.employeeId,
      punchType: "INGRESO",
      requestHash,
      status: "COMPLETED",
      response: { workShift: { id: "shift-stored" } },
    });

    const result = await timeEntriesService.clockPhotoPunchIdempotent(input);

    expect(result).toEqual({ workShift: { id: "shift-stored" } });
    expect(repo.createOpenWorkShift).not.toHaveBeenCalled();
  });

  it("re-lanza el error guardado si el intento esta FAILED", async () => {
    const input = clockPhotoPunchInput();
    repo.findClockValidationContext.mockResolvedValue({ ...activeEmployee, workShifts: [], hourConcepts: [] });
    const requestHash = clockAttemptHash(input);
    repo.createClockPunchAttempt.mockRejectedValue(prismaKnownError("P2002"));
    repo.findClockPunchAttempt.mockResolvedValue({
      requestId: input.requestId,
      employeeId: input.employeeId,
      punchType: "INGRESO",
      requestHash,
      status: "FAILED",
      response: null,
      errorCode: "CLOCK_PHOTO_STORAGE_FAILED",
      errorMessage: "No se pudo guardar la evidencia.",
      httpStatus: 503,
    });

    await expect(timeEntriesService.clockPhotoPunchIdempotent(input)).rejects.toMatchObject({
      statusCode: 503,
      code: "CLOCK_PHOTO_STORAGE_FAILED",
    });
  });

  it("responde 409 si el intento todavia esta PROCESSING", async () => {
    const input = clockPhotoPunchInput();
    repo.findClockValidationContext.mockResolvedValue({ ...activeEmployee, workShifts: [], hourConcepts: [] });
    const requestHash = clockAttemptHash(input);
    repo.createClockPunchAttempt.mockRejectedValue(prismaKnownError("P2002"));
    repo.findClockPunchAttempt.mockResolvedValue({
      requestId: input.requestId,
      employeeId: input.employeeId,
      punchType: "INGRESO",
      requestHash,
      status: "PROCESSING",
      response: null,
    });

    await expect(timeEntriesService.clockPhotoPunchIdempotent(input)).rejects.toMatchObject({
      statusCode: 409,
      code: "CLOCK_ATTEMPT_PROCESSING",
    });
  });

  it("responde 409 CLOCK_IDEMPOTENCY_KEY_REUSED si el mismo requestId se usa con un payload distinto", async () => {
    const input = clockPhotoPunchInput();
    repo.findClockValidationContext.mockResolvedValue({ ...activeEmployee, workShifts: [], hourConcepts: [] });
    repo.createClockPunchAttempt.mockRejectedValue(prismaKnownError("P2002"));
    repo.findClockPunchAttempt.mockResolvedValue({
      requestId: input.requestId,
      employeeId: input.employeeId,
      punchType: "INGRESO",
      requestHash: "un-hash-completamente-distinto",
      status: "COMPLETED",
      response: { workShift: { id: "shift-otro" } },
    });

    await expect(timeEntriesService.clockPhotoPunchIdempotent(input)).rejects.toMatchObject({
      statusCode: 409,
      code: "CLOCK_IDEMPOTENCY_KEY_REUSED",
    });
  });
});

describe("exportByPerson — 'Horas trabajadas totales' = Normal, 'Horas especiales' desde HourConceptBreakdown (Etapa 6M)", () => {
  const rrhhUser = { id: "user-1", role: "NIVEL_1_RRHH" } as Express.AuthUser;

  function exportEntry(overrides: Partial<{ employeeId: string; hours: string; status: string; systemRole: string | null }> = {}) {
    return {
      employeeId: overrides.employeeId ?? "employee-1",
      hours: { toString: () => overrides.hours ?? "8" },
      status: overrides.status ?? "APROBADO",
      hourConcept: { systemRole: overrides.systemRole ?? "NORMAL_BASE" },
      employee: {
        cuil: "20-1-1",
        lastName: "Perez",
        firstName: "Juan",
        legajo: "0001",
        costCenter: { code: "CC1" },
        companies: [{ isPrimary: true, company: { name: "Empresa 1" } }],
      },
    };
  }

  it("'Horas trabajadas totales' usa sólo Normal — un TimeEntry legacy no-Normal no lo infla", async () => {
    repo.findForExport.mockResolvedValue([
      exportEntry({ hours: "8", systemRole: "NORMAL_BASE" }),
      // Entrada especial legacy previa a la Etapa 6L: no debe sumar al total.
      exportEntry({ hours: "2", systemRole: "COLECTIVO" }),
    ]);
    repo.findBreakdownHoursForExport.mockResolvedValue([]);

    const result = await timeEntriesService.exportByPerson({ period: "2026-08", includeInReview: false }, rrhhUser);

    expect(result.rows).toEqual([
      expect.objectContaining({
        "Horas normales": "8",
        "Horas especiales": "0",
        "Horas trabajadas totales": "8",
      }),
    ]);
  });

  it("'Horas especiales' sale de findBreakdownHoursForExport, no del TimeEntry, y no se suma al total", async () => {
    repo.findForExport.mockResolvedValue([exportEntry({ hours: "8", systemRole: "NORMAL_BASE" })]);
    repo.findBreakdownHoursForExport.mockResolvedValue([{ employeeId: "employee-1", minutes: 120 }]);

    const result = await timeEntriesService.exportByPerson({ period: "2026-08", includeInReview: false }, rrhhUser);

    expect(repo.findBreakdownHoursForExport).toHaveBeenCalledWith(["employee-1"], "2026-08");
    expect(result.rows).toEqual([
      expect.objectContaining({
        "Horas normales": "8",
        "Horas especiales": "2",
        "Horas trabajadas totales": "8",
      }),
    ]);
  });
});
