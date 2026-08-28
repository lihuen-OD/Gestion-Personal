import { describe, expect, it } from "vitest";
import { mapTimeEntryFromApi } from "./timeEntryApiService";

// Etapa 11B: la Bandeja de revisión (HoursPage.tsx, vista "Por registro")
// perdía appliedMultiplier al mapear la respuesta cruda del backend al tipo
// TimeEntry del frontend — el backend ya lo devolvía (escalar de TimeEntry,
// sin select restrictivo en el listado plano), pero mapTimeEntryFromApi
// nunca lo leía. Estos tests cubren el mapeo nuevo, sin tocar `isSpecial`
// (Conceptos Horarios, dominio distinto — ver 8A/11A).
describe("mapTimeEntryFromApi — Horas Especiales en la Bandeja de revisión (Etapa 11B)", () => {
  const base = {
    id: "entry-1",
    employeeId: "employee-1",
    hourConceptId: "concept-normal",
    date: "2026-08-27",
    hours: "8",
    status: "EN_REVISION" as const,
  };

  it("appliedMultiplier=1 (o ausente): no agrega ningún campo de Hora Especial", () => {
    const entry = mapTimeEntryFromApi({ ...base, appliedMultiplier: 1 });
    expect(entry.specialHourMultiplier).toBeUndefined();
    expect(entry.specialHourLiquidableHours).toBeUndefined();
    expect(entry.specialHourRuleNames).toBeUndefined();

    const entryWithoutField = mapTimeEntryFromApi({ ...base });
    expect(entryWithoutField.specialHourMultiplier).toBeUndefined();
  });

  it("appliedMultiplier > 1 con timeSegment (fichador): mapea multiplicador, liquidable y regla(s)", () => {
    const entry = mapTimeEntryFromApi({
      ...base,
      appliedMultiplier: 2,
      timeSegment: { specialHourRuleApplications: [{ wasConflicting: false, doubleHourRule: { name: "Feriado" } }] },
    });

    expect(entry.specialHourMultiplier).toBe(2);
    expect(entry.specialHourLiquidableHours).toBe(16); // 8 real x2
    expect(entry.specialHourRuleNames).toEqual(["Feriado"]);
    expect(entry.specialHourConflict).toBe(false);
  });

  it("appliedMultiplier > 1 sin timeSegment (carga manual): mapea multiplicador/liquidable, sin nombre de regla", () => {
    const entry = mapTimeEntryFromApi({ ...base, appliedMultiplier: 2, timeSegment: null });

    expect(entry.specialHourMultiplier).toBe(2);
    expect(entry.specialHourLiquidableHours).toBe(16);
    expect(entry.specialHourRuleNames).toEqual([]);
  });

  it("conflicto de prioridad (empate): specialHourConflict=true", () => {
    const entry = mapTimeEntryFromApi({
      ...base,
      appliedMultiplier: 2.5,
      timeSegment: {
        specialHourRuleApplications: [
          { wasConflicting: true, doubleHourRule: { name: "Domingo Odwyer" } },
          { wasConflicting: true, doubleHourRule: { name: "Domingo Pañol" } },
        ],
      },
    });

    expect(entry.specialHourConflict).toBe(true);
    expect(entry.specialHourRuleNames).toEqual(["Domingo Odwyer", "Domingo Pañol"]);
  });

  it("isSpecial (Conceptos Horarios) no se toca ni se confunde con specialHourMultiplier (Horas Especiales)", () => {
    const entry = mapTimeEntryFromApi({
      ...base,
      appliedMultiplier: 2,
      hourConcept: { id: "concept-normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", status: "ACTIVO" },
    });

    expect(entry.isSpecial).toBe(false); // kind === "NORMAL" -> Concepto Horario base, no especial
    expect(entry.specialHourMultiplier).toBe(2); // Hora Especial sigue aplicando igual, dominio independiente
  });
});
