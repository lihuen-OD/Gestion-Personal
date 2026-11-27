import { describe, expect, it, vi } from "vitest";
import { resolveConvocationSchedules, type ConvocationSchedule } from "../holidayConvocationSchedule";
import { formatHolidayConvocationDiagnostic, runHolidayConvocationDiagnostic } from "./holidayConvocationDiagnostic";

vi.mock("../holidayConvocationSchedule", async (importOriginal) => ({ ...(await importOriginal<typeof import("../holidayConvocationSchedule")>()), resolveConvocationSchedules: vi.fn() }));

/** §20 F2.4: clasificación de convocatorias ACTIVAS existentes (sólo lectura). */
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const HOLIDAY = "2026-12-08";
const OTHER = "2026-12-09";
const template = (id: string, overrides: Record<string, unknown> = {}) => ({ id, code: id.toUpperCase(), startTime: "07:00", endTime: "17:00", crossesMidnight: false, status: "ACTIVO", ...overrides });
const row = (employeeId: string, date: string, overrides: Record<string, unknown> = {}) => ({
  employeeId, date: day(date), expectedStartTime: null, expectedEndTime: null, shiftTemplate: null,
  employee: { legajo: employeeId.replace("emp-", ""), firstName: "Ana", lastName: `Apellido ${employeeId}` }, ...overrides,
});
const schedule = (kind: ConvocationSchedule["kind"], codes: string[] = []): ConvocationSchedule => ({ kind, planReason: null, blocks: codes.map((code) => ({ templateId: code.toLowerCase(), code, name: null, startTime: "07:00", endTime: "17:00" })) });

describe("runHolidayConvocationDiagnostic", () => {
  it("clasifica sin horario, plantilla inválida, horario libre, plantilla distinta del turno y fecha que ya no es feriado; las correctas no aparecen", async () => {
    const reader = {
      doubleHourRule: { findMany: vi.fn().mockResolvedValue([{ id: "r", recurrenceType: "FECHA", fromDate: day(HOLIDAY), toDate: day(HOLIDAY), weekdays: [], dates: [{ date: day(HOLIDAY), isActive: true }] }]) },
      holidayWorkAssignment: {
        findMany: vi.fn().mockResolvedValue([
          row("emp-1", HOLIDAY),
          row("emp-2", HOLIDAY, { shiftTemplate: template("old", { status: "INACTIVO" }) }),
          row("emp-3", HOLIDAY, { expectedStartTime: "08:00", expectedEndTime: "12:00" }),
          row("emp-4", HOLIDAY, { shiftTemplate: template("t0717") }),
          row("emp-5", HOLIDAY),
          row("emp-6", OTHER),
        ]),
      },
    };
    vi.mocked(resolveConvocationSchedules).mockResolvedValue(new Map([
      ["emp-1", schedule("ROTATION_REST")],
      ["emp-2", schedule("FIXED", ["OF"])],
      ["emp-3", schedule("FIXED", ["OF"])],
      ["emp-4", schedule("ROTATION_SHIFTS", ["T1703"])],
      ["emp-5", schedule("ROTATION_SHIFTS", ["T0715"])],
    ]));

    const report = await runHolidayConvocationDiagnostic(reader as never, { from: HOLIDAY, to: OTHER });

    expect(report.findings.map((finding) => [finding.employee, finding.issue])).toEqual([
      ["Apellido emp-1, Ana · Legajo 1", "SIN_HORARIO"],
      ["Apellido emp-2, Ana · Legajo 2", "PLANTILLA_INVALIDA"],
      ["Apellido emp-2, Ana · Legajo 2", "PLANTILLA_DISTINTA_DEL_TURNO"],
      ["Apellido emp-3, Ana · Legajo 3", "HORARIO_LIBRE"],
      ["Apellido emp-4, Ana · Legajo 4", "PLANTILLA_DISTINTA_DEL_TURNO"],
      ["Apellido emp-6, Ana · Legajo 6", "FECHA_NO_FERIADO"],
    ]);
    expect(report.summary).toEqual({ SIN_HORARIO: 1, PLANTILLA_INVALIDA: 1, HORARIO_LIBRE: 1, PLANTILLA_DISTINTA_DEL_TURNO: 2, FECHA_NO_FERIADO: 1 });
    expect(report.convocations).toBe(6);
    expect(reader.holidayWorkAssignment.findMany.mock.calls[0]![0].where).toMatchObject({ status: "ACTIVA" });
    const text = formatHolidayConvocationDiagnostic(report);
    expect(text).toContain("08/12/2026 · Apellido emp-1, Ana · Legajo 1 · SIN_HORARIO");
    expect(text).not.toMatch(/emp-\d+\b(?!,)/);
  });

  it("sin convocatorias: informa sin hallazgos", async () => {
    vi.clearAllMocks();
    const reader = { doubleHourRule: { findMany: vi.fn().mockResolvedValue([]) }, holidayWorkAssignment: { findMany: vi.fn().mockResolvedValue([]) } };
    const report = await runHolidayConvocationDiagnostic(reader as never, { from: HOLIDAY, to: HOLIDAY });
    expect(formatHolidayConvocationDiagnostic(report)).toContain("Sin hallazgos.");
    expect(resolveConvocationSchedules).not.toHaveBeenCalled();
  });
});
