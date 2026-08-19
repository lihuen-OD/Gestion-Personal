import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { timeEntriesRepository } from "./timeEntries.repository";
import { timeEntriesService, clockAttemptHash } from "./timeEntries.service";

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
};

const repo = timeEntriesRepository as unknown as RepoMock;

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
