import { describe, expect, it } from "vitest";
import { ApiError } from "../services/api/apiClient";
import type { ShiftRotationMember } from "../services/api/shiftRotationApiService";
import { canCancelMembership, closeRange, describeMemberError, fixedAssignmentText, membershipState, moveRange, sortMembers } from "./shiftRotationMembers";

const TODAY = "2026-11-24";
const member = (overrides: Partial<ShiftRotationMember>): ShiftRotationMember => ({
  id: "m", crewId: "a", crew: "A - Equipo A", employeeId: "e", legajo: "19", employee: "Pérez, Ana · Legajo 19", employeeStatus: "ACTIVO", effectiveFrom: "2026-11-02", effectiveTo: null, ...overrides,
});

describe("estado de una membresía", () => {
  it("distingue vigente, futura y finalizada (una futura nunca es vigente)", () => {
    expect(membershipState(member({ effectiveFrom: "2026-11-02" }), TODAY).label).toBe("Vigente");
    expect(membershipState(member({ effectiveFrom: TODAY }), TODAY).label).toBe("Vigente");
    expect(membershipState(member({ effectiveFrom: "2026-11-25" }), TODAY).label).toBe("Futura");
    expect(membershipState(member({ effectiveTo: "2026-11-23" }), TODAY).label).toBe("Finalizada");
    expect(membershipState(member({ effectiveTo: TODAY }), TODAY).label).toBe("Vigente");
  });

  it("ordena por persona y, dentro de cada una, por período", () => {
    const rows = sortMembers([
      member({ id: "3", employee: "Ruiz, Eva · Legajo 20", legajo: "20" }),
      member({ id: "2", employee: "Pérez, Ana · Legajo 19", effectiveFrom: "2026-12-01" }),
      member({ id: "1", employee: "Pérez, Ana · Legajo 19", effectiveFrom: "2026-11-02", effectiveTo: "2026-11-30" }),
      member({ id: "4", employee: "Álvarez, Juan · Legajo 7", legajo: "7" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["4", "1", "2", "3"]);
  });
});

describe("fechas que acepta el backend", () => {
  it("baja: desde hoy, no antes del inicio y antes del fin actual", () => {
    expect(closeRange(member({}), TODAY)).toEqual({ min: TODAY, max: null });
    expect(closeRange(member({ effectiveFrom: "2026-12-10" }), TODAY)).toEqual({ min: "2026-12-10", max: null });
    expect(closeRange(member({ effectiveTo: "2026-12-31" }), TODAY)).toEqual({ min: TODAY, max: "2026-12-30" });
    expect(closeRange(member({ effectiveTo: TODAY }), TODAY)).toBeNull();
  });

  it("cambio de equipo: desde mañana, después del inicio y sin pasar el fin", () => {
    expect(moveRange(member({}), TODAY)).toEqual({ min: "2026-11-25", max: null });
    expect(moveRange(member({ effectiveFrom: "2026-11-30" }), TODAY)).toEqual({ min: "2026-12-01", max: null });
    expect(moveRange(member({ effectiveTo: "2026-11-24" }), TODAY)).toBeNull();
  });

  it("cancelar: sólo un alta que no rigió", () => {
    expect(canCancelMembership(member({ effectiveFrom: "2026-11-25" }), "ACTIVO", TODAY)).toBe(true);
    expect(canCancelMembership(member({ effectiveFrom: TODAY }), "ACTIVO", TODAY)).toBe(false);
    expect(canCancelMembership(member({ effectiveFrom: "2026-11-02" }), "INACTIVO", TODAY)).toBe(true);
  });
});

describe("rechazos del backend", () => {
  const error = (code: string, message: string, details?: unknown) => new ApiError("No pudimos completar la operación. Intentá nuevamente.", code, 409, { error: { code, message, details } });

  it("régimen sin turno: usa el mensaje del backend limpio (el cliente lo habría reemplazado por uno genérico)", () => {
    const result = describeMemberError(error("ROTATION_SIN_TURNO_OVERLAP", "Tienen régimen SIN_TURNO en esas fechas, incompatible con una rotación: Pérez, Ana · Legajo 19."), "x");
    expect(result.message).toBe("Tienen régimen «Sin turno obligatorio» en esas fechas, incompatible con una rotación: Pérez, Ana · Legajo 19.");
  });

  it("superposición con otra rotación y persona inactiva se muestran tal como las explica el backend", () => {
    expect(describeMemberError(error("ROTATION_MEMBERSHIP_OVERLAP", "Ya tienen una membresía de rotación en esas fechas: Pérez, Ana · Legajo 19 (rotación OFI-AB - Oficina, equipo A - Mañana, desde el 01/12/2026)."), "x").message).toMatch(/^Ya tienen una membresía de rotación/);
    expect(describeMemberError(error("ROTATION_EMPLOYEE_INACTIVE", "No se puede dar de alta a personas inactivas: Gómez, Luis · Legajo 21."), "x").message).toBe("No se puede dar de alta a personas inactivas: Gómez, Luis · Legajo 21.");
  });

  it("turnos fijos superpuestos: texto propio (no nombra el parámetro técnico) y lista de turnos", () => {
    const result = describeMemberError(error("ROTATION_FIXED_ASSIGNMENT_OVERLAP", "Tienen turnos fijos superpuestos con el alta: … repetí el alta con closeFixedAssignments.", { assignments: [{ employeeId: "e", employee: "Pérez, Ana · Legajo 19", template: "P-01", effectiveFrom: "2026-10-01", effectiveTo: null }] }), "x");
    expect(result.message).not.toMatch(/closeFixedAssignments/);
    expect(result.fixedAssignments).toHaveLength(1);
    expect(fixedAssignmentText(result.fixedAssignments[0]!)).toBe("Pérez, Ana · Legajo 19: turno fijo P-01 desde el 01/10/2026");
  });

  it("superposición en la transición: nombra persona y turnos", () => {
    const result = describeMemberError(error("ROTATION_TRANSITION_OVERLAP", "El primer turno de la rotación del 01/12/2026 se superpone con el turno del día anterior.", { overlaps: [{ employee: "Pérez, Ana · Legajo 19", outgoing: "P-1907 19:00–07:00 del 2026-11-30", incoming: "P-0719 07:00–19:00 del 2026-12-01" }] }), "x");
    expect(result.details).toEqual(["Pérez, Ana · Legajo 19: P-1907 19:00–07:00 del 30/11/2026 se superpone con P-0719 07:00–19:00 del 01/12/2026."]);
  });

  it("un mensaje con términos técnicos o un error inesperado cae en un texto claro", () => {
    expect(describeMemberError(error("X", "Invalid payload {foo}"), "No pudimos dar de baja a la persona.").message).toBe("No pudimos completar la operación. Intentá nuevamente.");
    expect(describeMemberError(new Error("socket"), "No pudimos dar de baja a la persona.").message).toBe("No pudimos dar de baja a la persona.");
  });
});
