/**
 * R8 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §26): qué ve de una rotación
 * administrable quien no es Nivel 1.
 *
 * - Grupo: sólo rotaciones de grupos administrables (`shiftGroupAccess.ts`);
 *   una ajena responde como inexistente.
 * - Personas: dentro de una rotación propia, sólo los miembros del alcance de
 *   legajos (`employeeAccessWhere`). El resto no se lista ni se nombra; se
 *   informa cuántos quedan ocultos.
 * - Avisos de configuración: los que nombran a una persona oculta, o a un
 *   turno fijo de un grupo no administrable, se devuelven con un texto
 *   genérico (mismo código y severidad, sin nombre, legajo ni código ajeno).
 *
 * Nivel 1 no pasa por ningún filtro. Ningún dato de este módulo se cachea.
 */
import type { Express } from "express";
import { prisma } from "../../shared/prisma/client";
import { roles } from "../../shared/security/roles";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { canAccessShiftGroup, type ShiftGroupScope } from "./shiftGroupAccess";
import { toPublicIssue, type ReadinessIssue, type ReadinessIssueCode } from "./shiftRotationReadiness";

export type RotationViewer = {
  readonly scope: ShiftGroupScope;
  /** `null` = todos los legajos (Nivel 1). */
  readonly visibleEmployeeIds: ReadonlySet<string> | null;
};

/** Visor sin filtros: sólo para Nivel 1 o para caminos internos ya autorizados. */
export const UNRESTRICTED_ROTATION_VIEWER: RotationViewer = Object.freeze({ scope: Object.freeze({ all: true as const }), visibleEmployeeIds: null });

/**
 * Resuelve qué legajos de `employeeIds` puede ver `user` (una query; ninguna
 * para Nivel 1 o sin legajos).
 */
export async function rotationViewerFor(user: Express.AuthUser, scope: ShiftGroupScope, employeeIds: readonly string[]): Promise<RotationViewer> {
  if (user.role === roles.rrhh) return { scope, visibleEmployeeIds: null };
  const ids = [...new Set(employeeIds)];
  if (!ids.length) return { scope, visibleEmployeeIds: new Set() };
  const rows = await prisma.employee.findMany({ where: { AND: [{ id: { in: ids } }, employeeAccessWhere(user)] }, select: { id: true } });
  return { scope, visibleEmployeeIds: new Set(rows.map((row) => row.id)) };
}

export function canSeeEmployee(viewer: RotationViewer, employeeId: string): boolean {
  return viewer.visibleEmployeeIds === null || viewer.visibleEmployeeIds.has(employeeId);
}

const HIDDEN_PERSON_MESSAGES: Record<ReadinessIssueCode, string> = {
  GRID_INVALID: "Una persona fuera de tu alcance tiene un problema de grilla.",
  GRID_INCOMPLETE: "Una persona fuera de tu alcance tiene un problema de grilla.",
  TEMPLATE_OTHER_GROUP: "Una persona fuera de tu alcance tiene un turno de otro grupo.",
  MEMBERSHIP_WITHOUT_VERSION: "Una persona fuera de tu alcance no tiene una versión de la rotación que rija toda su membresía.",
  CREW_WITHOUT_GRID: "Una persona fuera de tu alcance pertenece a un equipo sin grilla en una versión vigente.",
  CREW_INACTIVE_WITH_MEMBERS: "Una persona fuera de tu alcance pertenece a un equipo inactivo.",
  FIXED_ASSIGNMENT_OVERLAP: "Una persona fuera de tu alcance tiene un turno fijo superpuesto con su membresía.",
  SIN_TURNO_OVERLAP: "Una persona fuera de tu alcance tiene un régimen SIN_TURNO incompatible con la rotación.",
  EMPLOYEE_INACTIVE: "Una persona fuera de tu alcance está inactiva y conserva una membresía vigente o futura.",
};

/** Avisos tal como los ve `viewer`: sin personas ocultas ni turnos fijos ajenos. */
export function visibleIssues(issues: readonly ReadinessIssue[], viewer: RotationViewer): ReadinessIssue[] {
  return issues.map((issue) => {
    const publicIssue = toPublicIssue(issue);
    if (issue.employeeId !== undefined && !canSeeEmployee(viewer, issue.employeeId)) {
      const { employeeId: _hidden, ...rest } = publicIssue;
      return { ...rest, message: HIDDEN_PERSON_MESSAGES[issue.code] };
    }
    if (issue.code === "FIXED_ASSIGNMENT_OVERLAP" && issue.relatedShiftGroupId !== undefined && !canAccessShiftGroup(viewer.scope, issue.relatedShiftGroupId)) {
      return { ...publicIssue, message: "Esta persona tiene un turno fijo de otro grupo superpuesto con su membresía. Consultá con RRHH." };
    }
    return publicIssue;
  });
}
