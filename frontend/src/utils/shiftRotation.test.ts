import { describe, expect, it } from "vitest";
import type { ShiftRotationIssue, ShiftRotationVersionSummary } from "../services/api/shiftRotationApiService";
import {
  canDeleteRotation,
  groupRotationIssues,
  humanizeRotationMessage,
  rotationCycleLabel,
  rotationGroupOptions,
  rotationHealth,
  rotationIssueCopy,
  rotationState,
  rotationVersionStatus,
  validateRotationForm,
} from "./shiftRotation";

const TECHNICAL = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b[0-9a-f]{8}-[0-9a-f]{4}-/;

function version(effectiveFrom: string, effectiveTo: string | null, inEffectToday: boolean, cycleLengthWeeks = 2): ShiftRotationVersionSummary {
  return { id: `v-${effectiveFrom}`, effectiveFrom, effectiveTo, cycleLengthWeeks, anchorWeekStart: "2026-11-30", locked: false, inEffectToday, dayCount: 14, updatedAt: "2026-11-24T00:00:00Z" };
}

describe("estado y salud", () => {
  it("Finalizada es derivada y tiene prioridad sobre ACTIVO", () => {
    expect(rotationState({ status: "ACTIVO", finalized: true }).label).toBe("Finalizada");
    expect(rotationState({ status: "ACTIVO", finalized: false }).label).toBe("Activa");
    expect(rotationState({ status: "INACTIVO", finalized: false }).label).toBe("Inactiva");
  });

  it("traduce la salud a un texto para RRHH", () => {
    expect(rotationHealth("OK")).toEqual({ label: "Sin observaciones", tone: "success" });
    expect(rotationHealth("WARNING").tone).toBe("warning");
    expect(rotationHealth("ERROR")).toEqual({ label: "Requiere correcciones", tone: "danger" });
  });
});

describe("diagnóstico", () => {
  const CODES = ["GRID_INVALID", "GRID_INCOMPLETE", "TEMPLATE_OTHER_GROUP", "MEMBERSHIP_WITHOUT_VERSION", "CREW_WITHOUT_GRID", "CREW_INACTIVE_WITH_MEMBERS", "FIXED_ASSIGNMENT_OVERLAP", "SIN_TURNO_OVERLAP", "EMPLOYEE_INACTIVE"];

  it.each(CODES)("%s tiene título y explicación sin términos técnicos", (code) => {
    const copy = rotationIssueCopy(code);
    expect(copy.title).not.toBe("Observación de la configuración");
    expect(`${copy.title} ${copy.explanation}`).not.toMatch(TECHNICAL);
  });

  it("un código desconocido usa un título genérico, nunca el código", () => {
    expect(rotationIssueCopy("NEW_BACKEND_CODE").title).toBe("Observación de la configuración");
  });

  it("limpia los mensajes reales del backend sin reescribir su contenido", () => {
    expect(humanizeRotationMessage("Pérez, Ana · Legajo 19 tiene régimen SIN_TURNO desde el 01/12/2026, incompatible con una rotación."))
      .toBe("Pérez, Ana · Legajo 19 tiene régimen «Sin turno obligatorio» desde el 01/12/2026, incompatible con una rotación.");
    expect(humanizeRotationMessage("versión desde el 01/12/2026: La semana ancla 2026-12-02 no empieza un lunes."))
      .toBe("Versión desde el 01/12/2026: La semana ancla 02/12/2026 no empieza un lunes.");
    expect(humanizeRotationMessage("Sólo se finaliza una rotación ACTIVA. Una rotación inactiva nunca rigió."))
      .toBe("Sólo se finaliza una rotación activa. Una rotación inactiva nunca rigió.");
    expect(humanizeRotationMessage("Registro 3f1c2a4b-1111-4222-8333-123456789abc no encontrado")).toBe("Registro no encontrado");
  });

  it("agrupa por código, errores primero y sin mensajes repetidos", () => {
    const issues: ShiftRotationIssue[] = [
      { code: "EMPLOYEE_INACTIVE", severity: "WARNING", message: "Gómez, Luis · Legajo 21 está inactivo y conserva una membresía vigente o futura." },
      { code: "FIXED_ASSIGNMENT_OVERLAP", severity: "ERROR", message: "Pérez, Ana · Legajo 19 tiene el turno fijo P-01 desde el 01/12/2026, superpuesto con su membresía." },
      { code: "FIXED_ASSIGNMENT_OVERLAP", severity: "ERROR", message: "Ruiz, Eva · Legajo 20 tiene el turno fijo P-01 desde el 01/12/2026, superpuesto con su membresía." },
      { code: "FIXED_ASSIGNMENT_OVERLAP", severity: "ERROR", message: "Ruiz, Eva · Legajo 20 tiene el turno fijo P-01 desde el 01/12/2026, superpuesto con su membresía." },
    ];
    const groups = groupRotationIssues(issues);
    expect(groups.map((group) => group.code)).toEqual(["FIXED_ASSIGNMENT_OVERLAP", "EMPLOYEE_INACTIVE"]);
    expect(groups[0]!.messages).toHaveLength(2);
    expect(groups[0]!.title).toBe("Turno fijo superpuesto");
  });

  it("separa un mismo código según su severidad (GRID_INCOMPLETE puede ser error o advertencia)", () => {
    const groups = groupRotationIssues([
      { code: "GRID_INCOMPLETE", severity: "WARNING", message: "a" },
      { code: "GRID_INCOMPLETE", severity: "ERROR", message: "b" },
    ]);
    expect(groups.map((group) => group.severity)).toEqual(["ERROR", "WARNING"]);
  });
});

describe("versiones y ciclo", () => {
  it("describe la versión vigente, la próxima o la ausencia de grilla", () => {
    expect(rotationVersionStatus([version("2026-11-01", null, true)], "2026-11-24")).toEqual({ label: "Desde el 01/11/2026", detail: null });
    expect(rotationVersionStatus([version("2026-11-01", "2026-12-31", true)], "2026-11-24").detail).toBe("Hasta el 31/12/2026");
    expect(rotationVersionStatus([version("2026-12-01", null, false)], "2026-11-24")).toEqual({ label: "Sin versión vigente", detail: "Próxima desde el 01/12/2026" });
    expect(rotationVersionStatus([], "2026-11-24")).toEqual({ label: "Sin versión vigente", detail: null });
  });

  it("nombra las semanas del ciclo con letras", () => {
    expect(rotationCycleLabel(1)).toBe("1 semana");
    expect(rotationCycleLabel(2)).toBe("2 semanas (A y B)");
    expect(rotationCycleLabel(4)).toBe("4 semanas (A, B, C y D)");
  });
});

describe("formulario", () => {
  it("valida formato y longitudes del contrato", () => {
    expect(validateRotationForm({ code: " ", name: "A", shiftGroupId: "", observation: "" })).toEqual({
      code: "Ingresá un código.",
      name: "Ingresá un nombre de al menos 2 caracteres.",
      shiftGroupId: "Elegí el grupo de la rotación.",
    });
    expect(validateRotationForm({ code: "X".repeat(31), name: "N".repeat(81), shiftGroupId: "g", observation: "o".repeat(501) })).toEqual({
      code: "El código no puede superar los 30 caracteres.",
      name: "El nombre no puede superar los 80 caracteres.",
      observation: "La observación no puede superar los 500 caracteres.",
    });
    expect(validateRotationForm({ code: "PL-4X4", name: "Planta 4x4", shiftGroupId: "g", observation: "" })).toEqual({});
  });

  it("ofrece grupos activos y conserva el actual aunque esté inactivo", () => {
    const groups = [
      { id: "g2", code: "PLANTA", name: "Planta", sortOrder: 20, status: "ACTIVO" as const, templateCount: 2, createdAt: "", updatedAt: "" },
      { id: "g1", code: "OFICINA", name: "Oficina", sortOrder: 10, status: "ACTIVO" as const, templateCount: 2, createdAt: "", updatedAt: "" },
      { id: "g3", code: "GRANJA", name: "Granja", sortOrder: 30, status: "INACTIVO" as const, templateCount: 0, createdAt: "", updatedAt: "" },
    ];
    expect(rotationGroupOptions(groups, null).map((option) => option.label)).toEqual(["Oficina", "Planta"]);
    expect(rotationGroupOptions(groups, { id: "g3", code: "GRANJA", name: "Granja", status: "INACTIVO" }).map((option) => option.label)).toEqual(["Oficina", "Planta", "Granja (inactivo)"]);
  });

  it("sólo se puede eliminar una rotación inactiva que nunca tuvo personas", () => {
    const crew = (everHadMembers: boolean) => ({ id: "c", code: "A", name: "Equipo A", sortOrder: 0, status: "ACTIVO" as const, openMemberCount: 0, everHadMembers });
    expect(canDeleteRotation({ status: "INACTIVO", crews: [crew(false)] })).toBe(true);
    expect(canDeleteRotation({ status: "INACTIVO", crews: [crew(true)] })).toBe(false);
    expect(canDeleteRotation({ status: "ACTIVO", crews: [] })).toBe(false);
  });
});
