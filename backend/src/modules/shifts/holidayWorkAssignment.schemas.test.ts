import { describe, expect, it } from "vitest";
import { holidayDatesQuerySchema, holidayWorkAssignmentsByDateQuerySchema, holidayWorkCandidatesQuerySchema, saveHolidayWorkAssignmentsSchema } from "./holidayWorkAssignment.schemas";

describe("holidayDatesQuerySchema — Etapa 12D", () => {
  it("acepta un rango válido", () => {
    expect(holidayDatesQuerySchema.safeParse({ from: "2026-08-01", to: "2026-08-31" }).success).toBe(true);
  });

  it("rechaza 'to' anterior a 'from'", () => {
    expect(holidayDatesQuerySchema.safeParse({ from: "2026-08-31", to: "2026-08-01" }).success).toBe(false);
  });

  it("rechaza un rango de más de 400 días — mismo tope que calendarRangeQuerySchema", () => {
    expect(holidayDatesQuerySchema.safeParse({ from: "2026-01-01", to: "2027-06-01" }).success).toBe(false);
  });
});

describe("holidayWorkAssignmentsByDateQuerySchema — Etapa 12D", () => {
  it("acepta una fecha válida", () => {
    expect(holidayWorkAssignmentsByDateQuerySchema.safeParse({ date: "2026-08-27" }).success).toBe(true);
  });

  it("rechaza sin fecha", () => {
    expect(holidayWorkAssignmentsByDateQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe("holidayWorkCandidatesQuerySchema — Etapa 12D", () => {
  it("sin parámetros: aplica defaults de paginación (page=1, take=100)", () => {
    const result = holidayWorkCandidatesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ page: 1, take: 100 });
  });

  it("acepta sectorId/shiftTemplateId/withoutShift/search combinados", () => {
    const result = holidayWorkCandidatesQuerySchema.safeParse({ sectorId: "11111111-1111-1111-1111-111111111111", withoutShift: "true", search: "Pedro" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.withoutShift).toBe(true);
  });

  it("rechaza take por encima del máximo seguro (500)", () => {
    expect(holidayWorkCandidatesQuerySchema.safeParse({ take: 5000 }).success).toBe(false);
  });
});

describe("saveHolidayWorkAssignmentsSchema — Etapa 12D", () => {
  const employeeId = "11111111-1111-1111-1111-111111111111";

  it("acepta un item mínimo (sin turno, sin horario, sin notas) — empleado sin turno habitual", () => {
    const result = saveHolidayWorkAssignmentsSchema.safeParse({ date: "2026-08-27", assignments: [{ employeeId }] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assignments[0]!.status).toBe("ACTIVA");
  });

  it("acepta un item completo con turno/horario/notas", () => {
    const result = saveHolidayWorkAssignmentsSchema.safeParse({
      date: "2026-08-27",
      assignments: [{ employeeId, shiftTemplateId: "22222222-2222-2222-2222-222222222222", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "Convocado por feriado" }],
    });
    expect(result.success).toBe(true);
  });

  it("acepta status CANCELADA explícito", () => {
    expect(saveHolidayWorkAssignmentsSchema.safeParse({ date: "2026-08-27", assignments: [{ employeeId, status: "CANCELADA" }] }).success).toBe(true);
  });

  it("rechaza un status fuera del enum", () => {
    expect(saveHolidayWorkAssignmentsSchema.safeParse({ date: "2026-08-27", assignments: [{ employeeId, status: "PENDIENTE" }] }).success).toBe(false);
  });

  it("rechaza un horario con formato inválido", () => {
    expect(saveHolidayWorkAssignmentsSchema.safeParse({ date: "2026-08-27", assignments: [{ employeeId, expectedStartTime: "8am" }] }).success).toBe(false);
  });

  it("rechaza un array de assignments vacío", () => {
    expect(saveHolidayWorkAssignmentsSchema.safeParse({ date: "2026-08-27", assignments: [] }).success).toBe(false);
  });

  it("rechaza sin fecha", () => {
    expect(saveHolidayWorkAssignmentsSchema.safeParse({ assignments: [{ employeeId }] }).success).toBe(false);
  });
});
