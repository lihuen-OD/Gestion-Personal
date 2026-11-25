import { describe, expect, it } from "vitest";
import { groupHolidayWorkAssignmentUpdates, planHolidayWorkAssignmentChanges, requestedHolidayWorkAssignmentFields } from "./holidayWorkAssignmentChanges";

const existing = (employeeId: string, fields: Partial<ReturnType<typeof requestedHolidayWorkAssignmentFields>> = {}) => ({
  id: `hwa-${employeeId}`,
  employeeId,
  status: "ACTIVA" as const,
  shiftTemplateId: null,
  expectedStartTime: null,
  expectedEndTime: null,
  notes: null,
  ...fields,
});

describe("planHolidayWorkAssignmentChanges", () => {
  it("clasifica altas, cambios reales, sin cambios y cancelaciones inexistentes, en el orden del pedido", () => {
    const plan = planHolidayWorkAssignmentChanges(
      [
        { employeeId: "new", status: "ACTIVA" },
        { employeeId: "same", status: "ACTIVA", notes: "Viene" },
        { employeeId: "edited", status: "ACTIVA", expectedStartTime: "09:00" },
        { employeeId: "ghost", status: "CANCELADA" },
        { employeeId: "cancel", status: "CANCELADA" },
      ],
      [existing("same", { notes: "Viene" }), existing("edited", { expectedStartTime: "08:00" }), existing("cancel")],
    );

    expect(plan.map((change) => [change.employeeId, change.kind])).toEqual([["new", "CREATE"], ["same", "UNCHANGED"], ["edited", "UPDATE"], ["ghost", "SKIP"], ["cancel", "UPDATE"]]);
  });

  it("compara todos los campos editables (turno, horario desde/hasta, notas y estado)", () => {
    const base = existing("e", { shiftTemplateId: "t1", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "x" });
    const same = { employeeId: "e", status: "ACTIVA" as const, shiftTemplateId: "t1", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "x" };
    expect(planHolidayWorkAssignmentChanges([same], [base])[0]!.kind).toBe("UNCHANGED");
    for (const patch of [{ shiftTemplateId: "t2" }, { expectedStartTime: "08:30" }, { expectedEndTime: "15:00" }, { notes: "y" }, { status: "CANCELADA" as const }]) {
      expect(planHolidayWorkAssignmentChanges([{ ...same, ...patch }], [base])[0]!.kind).toBe("UPDATE");
    }
  });

  it("un campo omitido equivale a null, igual que lo escribe el guardado", () => {
    expect(requestedHolidayWorkAssignmentFields({ employeeId: "e", status: "CANCELADA" })).toEqual({ status: "CANCELADA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: null });
    expect(planHolidayWorkAssignmentChanges([{ employeeId: "e", status: "ACTIVA" }], [existing("e")])[0]!.kind).toBe("UNCHANGED");
    expect(planHolidayWorkAssignmentChanges([{ employeeId: "e", status: "ACTIVA" }], [existing("e", { notes: "x" })])[0]!.kind).toBe("UPDATE");
  });

  it("agrupa en un solo update las filas que terminan con los mismos campos", () => {
    const plan = planHolidayWorkAssignmentChanges(
      [{ employeeId: "a", status: "CANCELADA" }, { employeeId: "b", status: "CANCELADA" }, { employeeId: "c", status: "ACTIVA", notes: "nuevo" }],
      [existing("a"), existing("b", { notes: "x" }), existing("c")],
    );

    expect(groupHolidayWorkAssignmentUpdates(plan)).toEqual([
      { fields: { status: "CANCELADA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: null }, ids: ["hwa-a", "hwa-b"] },
      { fields: { status: "ACTIVA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: "nuevo" }, ids: ["hwa-c"] },
    ]);
  });
});
