import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { resolveWorkObligationCandidates } from "../shifts/workObligation.service";
import { checkMissingExpectedEntries } from "./missingEntry.service";
import { detectAttendanceInactivity } from "./attendanceInactivity.service";

/**
 * Etapa 15M.19D (docs/decisions/NOTIFICATIONS_END_TO_END_ACCEPTANCE_15M19D.md
 * §21): 15M.19B probó `missingEntry.service.ts` y `attendanceInactivity.service.ts`
 * cada uno por separado, con Prisma mockeado de forma independiente. Este
 * archivo prueba la interacción REAL entre ambos: el chequeo intradía
 * detecta y notifica una falta de ingreso; al día siguiente, el catch-up
 * diario (15M.19A) vuelve a evaluar esa misma fecha ya elapsada. Ambos
 * escriben la MISMA fila de `AttendanceInactivityIncident` — la propiedad a
 * demostrar es que la segunda pasada NO genera una segunda
 * `SystemNotification` para la misma ausencia, sin importar cuál de los dos
 * llegó primero.
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { findMany: vi.fn() },
    attendancePunch: { findMany: vi.fn() },
    workShift: { findMany: vi.fn() },
    timeEntry: { findMany: vi.fn() },
    novelty: { findMany: vi.fn() },
    attendanceInactivityIncident: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../shifts/workObligation.service", () => ({
  resolveWorkObligationCandidates: vi.fn(),
}));

const mockedPrisma = prisma as unknown as {
  employee: { findMany: Mock };
  attendancePunch: { findMany: Mock };
  workShift: { findMany: Mock };
  timeEntry: { findMany: Mock };
  novelty: { findMany: Mock };
  attendanceInactivityIncident: { createMany: Mock; findMany: Mock; updateMany: Mock };
  user: { findMany: Mock };
  $transaction: Mock;
};
const mockedObligation = resolveWorkObligationCandidates as unknown as Mock;

function employeeRow() {
  return { id: "employee-1", legajo: "000001", firstName: "Carlos", lastName: "Demo", assignments: [] };
}

// Turno 08:00 + 10 min de tolerancia, empleado nunca ficha en todo el día.
const obligationCandidate = {
  employeeId: "employee-1",
  template: { id: "t1", code: "TURNO-MANANA", startTime: "08:00", entryToleranceAfterMinutes: 10 },
  scheduledStartAt: new Date("2026-09-18T11:00:00.000Z"), // 08:00 ART
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [obligationCandidate] });
  // Sin evidencia de actividad en absoluto, en ningún momento del día.
  mockedPrisma.attendancePunch.findMany.mockResolvedValue([]);
  mockedPrisma.workShift.findMany.mockResolvedValue([]);
  mockedPrisma.timeEntry.findMany.mockResolvedValue([]);
  mockedPrisma.novelty.findMany.mockResolvedValue([]);
  mockedPrisma.employee.findMany.mockResolvedValue([employeeRow()]);
  mockedPrisma.attendanceInactivityIncident.createMany.mockResolvedValue({ count: 1 });
  mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([]);
  mockedPrisma.attendanceInactivityIncident.updateMany.mockResolvedValue({ count: 0 });
  mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-rrhh" }]);
  const tx = { systemNotification: { createMany: vi.fn() }, attendanceInactivityIncident: { update: vi.fn() } };
  mockedPrisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
});

describe("interacción real: falta de ingreso intradía → catch-up diario del día siguiente, misma ausencia", () => {
  it("el chequeo intradía notifica una vez; el catch-up diario del día siguiente NO vuelve a notificar la misma ausencia", async () => {
    // 08:11 ART del 18/09 -- tolerancia vencida, sin fichada.
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValueOnce([
      { id: "incident-1", employeeId: "employee-1", employee: employeeRow() },
    ]);
    const intraday = await checkMissingExpectedEntries(new Date("2026-09-18T11:11:00.000Z"));
    expect(intraday.created).toBe(1);
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1); // una notificación real

    // Día siguiente: el catch-up diario (15M.19A) evalúa "ayer" (18/09) como
    // día completo -- el empleado nunca fichó en absoluto ese día. El
    // incidente ya existe (creado arriba) y ya tiene notifiedAt seteado --
    // la query de "pendientes de notificar" ya no lo devuelve.
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValueOnce([]);
    const daily = await detectAttendanceInactivity("2026-09-18");

    // createMany se vuelve a intentar (skipDuplicates protege en DB real),
    // pero CERO notificaciones nuevas: $transaction sigue en 1 en total.
    expect(daily.detected).toBe(1);
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.attendanceInactivityIncident.createMany).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.attendanceInactivityIncident.createMany.mock.calls[1]![0]).toMatchObject({ skipDuplicates: true });
  });

  it("orden inverso -- si por algún motivo el catch-up diario corriera antes de que el intradía llegara a notificar, tampoco duplica (mismo notifiedAt gate)", async () => {
    // El catch-up diario corre primero.
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValueOnce([
      { id: "incident-1", employeeId: "employee-1", employee: employeeRow() },
    ]);
    const daily = await detectAttendanceInactivity("2026-09-18");
    expect(daily.notified).toBeGreaterThan(0);
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);

    // El chequeo intradía (de un tick atrasado, por ejemplo tras un restart)
    // corre después, sobre la misma fecha/empleado -- ya notificado.
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValueOnce([]);
    await checkMissingExpectedEntries(new Date("2026-09-18T11:11:00.000Z"));

    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
