import { describe, expect, it } from "vitest";
import { expectedScheduleLabel, scheduleRequiresTemplate } from "./holidayConvocationSchedule";

const block = { templateId: "t", code: "PLANTA-07-17", name: null, startTime: "07:00", endTime: "17:00" };

describe("turno real del feriado (§20)", () => {
  it.each([
    [{ kind: "FIXED", blocks: [block], planReason: null }, "Turno fijo: PLANTA-07-17 07:00–17:00", false],
    [{ kind: "ROTATION_SHIFTS", blocks: [block, { ...block, code: "PLANTA-19-07", startTime: "19:00", endTime: "07:00" }], planReason: null }, "Rotación: PLANTA-07-17 07:00–17:00 + PLANTA-19-07 19:00–07:00", false],
    [{ kind: "ROTATION_REST", blocks: [], planReason: null }, "Descanso de su rotación", true],
    [{ kind: "ROTATION_MISSING", blocks: [], planReason: "NO_DAY_ROW" }, "Rotación sin turno ese día (El día no está configurado en la grilla)", true],
    [{ kind: "ROTATION_CONFLICT", blocks: [], planReason: "MULTIPLE_VERSIONS" }, "Conflicto en su rotación: Más de una versión de la grilla rige ese día", true],
    [{ kind: "NONE", blocks: [], planReason: null }, "Sin turno ese día", true],
  ] as const)("%o → %s", (schedule, label, requires) => {
    expect(expectedScheduleLabel(schedule as never)).toBe(label);
    expect(scheduleRequiresTemplate(schedule as never)).toBe(requires);
  });

  it("sin datos: exige plantilla (nunca supone un turno)", () => {
    expect(expectedScheduleLabel(null)).toBe("Sin datos");
    expect(scheduleRequiresTemplate(undefined)).toBe(true);
  });
});
