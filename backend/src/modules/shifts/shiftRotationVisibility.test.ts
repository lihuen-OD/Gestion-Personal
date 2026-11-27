import { describe, expect, it, vi } from "vitest";
import type { ReadinessIssue } from "./shiftRotationReadiness";
import { toPublicIssues } from "./shiftRotationReadiness";
import { canSeeEmployee, UNRESTRICTED_ROTATION_VIEWER, visibleIssues, type RotationViewer } from "./shiftRotationVisibility";

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));

const scoped: RotationViewer = { scope: { all: false, groupIds: new Set(["g-planta"]) }, visibleEmployeeIds: new Set(["e-visible"]) };

const issues: ReadinessIssue[] = [
  { code: "EMPLOYEE_INACTIVE", severity: "WARNING", employeeId: "e-hidden", message: "Pérez, Ana · Legajo 77 está inactivo y conserva una membresía vigente o futura." },
  { code: "FIXED_ASSIGNMENT_OVERLAP", severity: "ERROR", employeeId: "e-visible", relatedShiftGroupId: "g-taller", message: "Gómez, Luis · Legajo 10 tiene el turno fijo TALLER-01 desde 01/12/2026, superpuesto con su membresía." },
  { code: "FIXED_ASSIGNMENT_OVERLAP", severity: "ERROR", employeeId: "e-visible", relatedShiftGroupId: "g-planta", message: "Gómez, Luis · Legajo 10 tiene el turno fijo PLANTA-01 desde 01/12/2026, superpuesto con su membresía." },
  { code: "FIXED_ASSIGNMENT_OVERLAP", severity: "ERROR", employeeId: "e-visible", relatedShiftGroupId: null, message: "Gómez, Luis · Legajo 10 tiene el turno fijo SIN-GRUPO desde 01/12/2026, superpuesto con su membresía." },
  { code: "GRID_INCOMPLETE", severity: "WARNING", versionId: "v1", message: "Versión: falta el lunes del equipo A." },
];

describe("visibleIssues (R8)", () => {
  it("Nivel 1 ve todo, sin el dato interno", () => {
    const result = visibleIssues(issues, UNRESTRICTED_ROTATION_VIEWER);
    expect(result.map((issue) => issue.message)).toEqual(issues.map((issue) => issue.message));
    expect(result.every((issue) => !("relatedShiftGroupId" in issue))).toBe(true);
  });

  it("persona fuera del alcance: mismo código y severidad, sin nombre, legajo ni id", () => {
    const [hidden] = visibleIssues(issues, scoped);
    expect(hidden).toEqual({ code: "EMPLOYEE_INACTIVE", severity: "WARNING", message: "Una persona fuera de tu alcance está inactiva y conserva una membresía vigente o futura." });
  });

  it("turno fijo de otro grupo o sin grupo: sin código ajeno; el del propio grupo se conserva", () => {
    const [, foreign, own, ungrouped] = visibleIssues(issues, scoped);
    expect(foreign!.message).not.toContain("TALLER");
    expect(foreign!.employeeId).toBe("e-visible");
    expect(own!.message).toContain("PLANTA-01");
    expect(ungrouped!.message).not.toContain("SIN-GRUPO");
    for (const issue of [foreign, own, ungrouped]) expect(issue).not.toHaveProperty("relatedShiftGroupId");
  });

  it("avisos sin persona se conservan", () => {
    expect(visibleIssues(issues, scoped)[4]).toEqual(issues[4]);
  });

  it("toPublicIssues sólo quita el dato interno (errores de escritura)", () => {
    expect(toPublicIssues(issues)[1]).toEqual({ code: "FIXED_ASSIGNMENT_OVERLAP", severity: "ERROR", employeeId: "e-visible", message: issues[1]!.message });
  });

  it("canSeeEmployee: Nivel 1 ve a todos; alcance parcial sólo a los suyos", () => {
    expect(canSeeEmployee(UNRESTRICTED_ROTATION_VIEWER, "cualquiera")).toBe(true);
    expect(canSeeEmployee(scoped, "e-visible")).toBe(true);
    expect(canSeeEmployee(scoped, "e-hidden")).toBe(false);
  });
});
