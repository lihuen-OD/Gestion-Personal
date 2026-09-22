import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { resolveWorkObligationCandidates } from "../shifts/workObligation.service";
import { checkMissingExpectedEntries } from "./missingEntry.service";

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

// Turno 08:00, tolerancia 10 minutos — mismo fixture conceptual que "Demo
// Administrativo" (Carlos Demo, legajo 000001) del diagnóstico 15M.18.
function candidate(employeeId: string, overrides: Partial<{ startTime: string; entryToleranceAfterMinutes: number; scheduledStartAt: Date }> = {}) {
  return {
    employeeId,
    template: { id: "t1", code: "TURNO-MANANA", startTime: overrides.startTime ?? "08:00", entryToleranceAfterMinutes: overrides.entryToleranceAfterMinutes ?? 10 },
    scheduledStartAt: overrides.scheduledStartAt ?? new Date("2026-09-18T11:00:00.000Z"), // 08:00 ART
  };
}

function employeeRow(id: string) {
  return { id, legajo: "000001", firstName: "Carlos", lastName: "Demo", assignments: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [] });
  mockedPrisma.attendancePunch.findMany.mockResolvedValue([]);
  mockedPrisma.workShift.findMany.mockResolvedValue([]);
  mockedPrisma.timeEntry.findMany.mockResolvedValue([]);
  mockedPrisma.novelty.findMany.mockResolvedValue([]);
  mockedPrisma.employee.findMany.mockResolvedValue([]);
  mockedPrisma.attendanceInactivityIncident.createMany.mockResolvedValue({ count: 0 });
  mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([]);
  mockedPrisma.attendanceInactivityIncident.updateMany.mockResolvedValue({ count: 0 });
  mockedPrisma.user.findMany.mockResolvedValue([]);
  const tx = { systemNotification: { createMany: vi.fn() }, attendanceInactivityIncident: { update: vi.fn() } };
  mockedPrisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
});

describe("checkMissingExpectedEntries — Etapa 15M.19B", () => {
  it("sin candidatos con obligación real: no hace nada", async () => {
    const result = await checkMissingExpectedEntries(new Date("2026-09-18T12:00:00.000Z"));

    expect(result).toEqual({ candidates: 0, due: 0, created: 0, resolved: 0 });
    expect(mockedPrisma.attendancePunch.findMany).not.toHaveBeenCalled();
  });

  it("antes de que venza la tolerancia (08:05, turno 08:00 + 10 min): NO genera falta de ingreso", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [candidate("employee-1")] });

    // 08:05 ART = 11:05 UTC — todavía dentro de tolerancia (deadline 08:10 ART).
    const result = await checkMissingExpectedEntries(new Date("2026-09-18T11:05:00.000Z"));

    expect(result.due).toBe(0);
    expect(mockedPrisma.attendanceInactivityIncident.createMany).not.toHaveBeenCalled();
  });

  it("tolerancia vencida (08:11) y sin fichada: genera UNA falta de ingreso", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [candidate("employee-1")] });
    mockedPrisma.employee.findMany.mockResolvedValue([employeeRow("employee-1")]);
    mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: "employee-1", employee: employeeRow("employee-1") }]);

    // 08:11 ART = 11:11 UTC.
    const result = await checkMissingExpectedEntries(new Date("2026-09-18T11:11:00.000Z"));

    expect(result.due).toBe(1);
    expect(result.created).toBe(1);
    expect(mockedPrisma.attendanceInactivityIncident.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ employeeId: "employee-1" })], skipDuplicates: true }),
    );
  });

  it("fichada dentro de tolerancia (antes del deadline): no genera falta de ingreso, sin importar en qué tick se evalúe", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [candidate("employee-1")] });
    // Ingreso real a las 08:03 ART (11:03 UTC) -- misma ocurrencia de turno que la obligación (08:00 ART).
    mockedPrisma.attendancePunch.findMany.mockResolvedValue([{ employeeId: "employee-1", timestamp: new Date("2026-09-18T11:03:00.000Z") }]);

    const result = await checkMissingExpectedEntries(new Date("2026-09-18T11:11:00.000Z"));

    expect(result.created).toBe(0);
  });

  it("tolerancia vencida pero YA fichó (evidencia via attendancePunch): NO genera falta de ingreso", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [candidate("employee-1")] });
    mockedPrisma.attendancePunch.findMany.mockResolvedValue([{ employeeId: "employee-1", timestamp: new Date("2026-09-18T11:03:00.000Z") }]);

    const result = await checkMissingExpectedEntries(new Date("2026-09-18T11:30:00.000Z"));

    expect(result.created).toBe(0);
    expect(mockedPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it("novedad vigente exime: NO genera falta de ingreso", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [candidate("employee-1")] });
    mockedPrisma.novelty.findMany.mockResolvedValue([
      { employeeId: "employee-1", fromDate: new Date("2026-09-18T00:00:00.000Z"), toDate: null, noveltyType: { allowsDateRange: true } },
    ]);

    const result = await checkMissingExpectedEntries(new Date("2026-09-18T11:30:00.000Z"));

    expect(result.created).toBe(0);
  });

  it("SIN_TURNO / TURNO_FLEXIBLE sin obligación / weekday-excluido: nunca llegan acá (workObligation ya los filtró) — candidates=0 se respeta tal cual", async () => {
    mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [] });

    const result = await checkMissingExpectedEntries(new Date("2026-09-18T11:30:00.000Z"));

    expect(result).toEqual({ candidates: 0, due: 0, created: 0, resolved: 0 });
  });

  describe("idempotencia — segundo tick sin duplicar", () => {
    it("segundo tick tras ya haber creado el incidente: createMany vuelve a intentarse (protegido por skipDuplicates, no-op real en DB) pero notifiedAt ya no está null, así que cero notificaciones nuevas", async () => {
      mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [candidate("employee-1")] });
      mockedPrisma.employee.findMany.mockResolvedValue([employeeRow("employee-1")]);
      // Segundo tick: el incidente ya fue notificado en el tick anterior -> no aparece en la query notifiedAt:null.
      mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([]);

      await checkMissingExpectedEntries(new Date("2026-09-18T11:12:00.000Z"));

      expect(mockedPrisma.attendanceInactivityIncident.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
      expect(mockedPrisma.$transaction).not.toHaveBeenCalled(); // cero notificaciones nuevas: pendingNotification vino vacío
    });
  });

  describe("lifecycle — Etapa 15M.19B §16 (falta de ingreso vs. INGRESO_TARDE)", () => {
    it("empleado ficha después de haber sido detectado: el incidente PENDIENTE de hoy se resuelve automáticamente", async () => {
      mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [candidate("employee-1")] });
      // Ya no está "due" en el sentido de generar uno nuevo, pero puede seguir habiendo un PENDIENTE de un tick anterior.
      mockedPrisma.attendancePunch.findMany.mockResolvedValue([{ employeeId: "employee-1", timestamp: new Date("2026-09-18T11:03:00.000Z") }]);
      mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: "employee-1" }]);

      const result = await checkMissingExpectedEntries(new Date("2026-09-18T11:20:00.000Z"));

      expect(mockedPrisma.attendanceInactivityIncident.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["incident-1"] } },
        data: expect.objectContaining({ status: "RESUELTA", reviewNote: expect.stringContaining("automáticamente") }),
      });
      expect(result.resolved).toBe(1);
    });

    it("sin incidente PENDIENTE para hoy: no llama updateMany (nada que resolver)", async () => {
      mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [candidate("employee-1")] });
      mockedPrisma.attendancePunch.findMany.mockResolvedValue([{ employeeId: "employee-1", timestamp: new Date("2026-09-18T11:03:00.000Z") }]);
      mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([]);

      const result = await checkMissingExpectedEntries(new Date("2026-09-18T11:20:00.000Z"));

      expect(mockedPrisma.attendanceInactivityIncident.updateMany).not.toHaveBeenCalled();
      expect(result.resolved).toBe(0);
    });

    it("incidente PENDIENTE pero el empleado TODAVÍA no fichó: no se resuelve", async () => {
      mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [candidate("employee-1")] });
      mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: "employee-1" }]);
      // Sin evidencia: attendancePunch/workShift/timeEntry vacíos (default del beforeEach).

      const result = await checkMissingExpectedEntries(new Date("2026-09-18T11:20:00.000Z"));

      expect(mockedPrisma.attendanceInactivityIncident.updateMany).not.toHaveBeenCalled();
      expect(result.resolved).toBe(0);
    });
  });

  describe("reinicio del proceso — Etapa 15M.18 §19 / criterio de éxito", () => {
    it("backend caído 08:00-08:30 (sin ticks en el medio) y vuelve a las 08:31: detecta la falta de ingreso en el primer tick posterior, sin depender de haber estado vivo a las 08:11", async () => {
      mockedObligation.mockResolvedValue({ isHoliday: false, candidates: [candidate("employee-1")] });
      mockedPrisma.employee.findMany.mockResolvedValue([employeeRow("employee-1")]);
      mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: "employee-1", employee: employeeRow("employee-1") }]);

      const result = await checkMissingExpectedEntries(new Date("2026-09-18T11:31:00.000Z")); // 08:31 ART

      expect(result.created).toBe(1);
    });
  });

  describe("cross-midnight — Etapa 15M.18 §34", () => {
    it("turno 22:00 con tolerancia 10 min: evaluado a las 22:11 del mismo día operativo, sin fichada, genera una sola falta de ingreso", async () => {
      // 2026-09-18 22:00 ART = 2026-09-19 01:00 UTC.
      mockedObligation.mockResolvedValue({
        isHoliday: false,
        candidates: [candidate("employee-1", { startTime: "22:00", scheduledStartAt: new Date("2026-09-19T01:00:00.000Z") })],
      });
      mockedPrisma.employee.findMany.mockResolvedValue([employeeRow("employee-1")]);
      mockedPrisma.attendanceInactivityIncident.findMany.mockResolvedValue([{ id: "incident-1", employeeId: "employee-1", employee: employeeRow("employee-1") }]);

      // 22:11 ART = 01:11 UTC del día siguiente, todavía calendario-Argentina 18/09 (medianoche ART = 03:00 UTC).
      const result = await checkMissingExpectedEntries(new Date("2026-09-19T01:11:00.000Z"));

      expect(result.created).toBe(1);
      expect(mockedPrisma.attendanceInactivityIncident.createMany).toHaveBeenCalledTimes(1);
    });
  });
});
