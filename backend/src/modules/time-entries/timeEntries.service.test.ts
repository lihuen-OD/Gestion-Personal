import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { timeEntriesRepository } from "./timeEntries.repository";
import { timeEntriesService, clockAttemptHash } from "./timeEntries.service";
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
};

const repo = timeEntriesRepository as unknown as RepoMock;
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
