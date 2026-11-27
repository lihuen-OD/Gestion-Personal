/**
 * R8.3 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §26): autorización de las
 * escrituras de turnos para Nivel 2/3. Se apoya en el alcance por grupo de
 * `shiftGroupAccess.ts` (R8.2) y en el alcance de legajos
 * (`employeeAccessWhere`).
 *
 * Reglas:
 * - R-3 Planificación (plantilla, rotación, equipo, versión, grilla): el
 *   grupo tiene que ser administrable. Un recurso de otro grupo identificado
 *   en la ruta responde 404 (igual que inexistente); un grupo indicado en el
 *   body responde `403 SHIFT_GROUP_FORBIDDEN`. Una plantilla sin grupo es sólo
 *   de Nivel 1.
 * - R-4 Personas (fijos, membresías, reemplazo de horario): además, todos los
 *   legajos afectados tienen que estar en el alcance; si falta uno, `403
 *   EMPLOYEE_SCOPE_FORBIDDEN` antes de escribir nada (todo o nada).
 * - R-5/R-6 Efectos laterales y errores: lo que tocaría o mostraría
 *   planificación de otro grupo se rechaza o se informa sin detalle ajeno
 *   (`redactShiftWriteError`). Nivel 1 conserva los mensajes completos.
 *
 * Nivel 1 nunca paga consultas extra: todas las verificaciones cortan antes.
 */
import type { Express, Request } from "express";
import { AppError } from "../../shared/errors/AppError";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { canAccessShiftGroup, requestShiftGroupScope, type ShiftGroupScope } from "./shiftGroupAccess";
import type { ReadinessIssue } from "./shiftRotationReadiness";
import { rotationViewerFor, visibleIssues, type RotationViewer } from "./shiftRotationVisibility";
import { errorScopeOf, type ErrorScopeRefs } from "./shiftErrorScope";

export type ShiftActor = { readonly user: Express.AuthUser; readonly scope: ShiftGroupScope };

/** Actor de la request: usuario autenticado + su alcance por grupo (resuelto una vez por request). */
export async function requestShiftActor(req: Request): Promise<ShiftActor> {
  return { user: req.user!, scope: await requestShiftGroupScope(req) };
}

export function isGlobalActor(actor: ShiftActor): boolean {
  return actor.scope.all;
}

export function canManageShiftGroup(actor: ShiftActor, shiftGroupId: string | null | undefined): boolean {
  return canAccessShiftGroup(actor.scope, shiftGroupId);
}

/** Grupo indicado en el body (alta, cambio de grupo): `403 SHIFT_GROUP_FORBIDDEN`. */
export function assertShiftGroupWritable(actor: ShiftActor, shiftGroupId: string | null | undefined): void {
  if (canManageShiftGroup(actor, shiftGroupId)) return;
  throw new AppError("No administrás ese grupo de turnos.", 403, "SHIFT_GROUP_FORBIDDEN");
}

type EmployeeDb = Pick<PrismaTransactionClient, "employee">;

/** Cuántos de `employeeIds` quedan fuera del alcance de legajos (0 para Nivel 1). */
export async function employeesOutsideScope(actor: ShiftActor, employeeIds: readonly string[], db: EmployeeDb = prisma): Promise<number> {
  if (isGlobalActor(actor)) return 0;
  const ids = [...new Set(employeeIds)];
  if (!ids.length) return 0;
  const visible = await db.employee.count({ where: { AND: [{ id: { in: ids } }, employeeAccessWhere(actor.user)] } });
  return ids.length - visible;
}

/** R-4: todos los legajos afectados en el alcance, o `403` sin escribir nada. */
export async function assertEmployeesWritable(actor: ShiftActor, employeeIds: readonly string[], db: EmployeeDb = prisma): Promise<void> {
  const outside = await employeesOutsideScope(actor, employeeIds, db);
  if (outside > 0) throw new AppError("Uno o más legajos están fuera de tu alcance", 403, "EMPLOYEE_SCOPE_FORBIDDEN");
}

/** Visor de lectura equivalente al actor (respuestas de escritura con personas y avisos). */
export function rotationViewerForActor(actor: ShiftActor, employeeIds: readonly string[]): Promise<RotationViewer> {
  return rotationViewerFor(actor.user, actor.scope, employeeIds);
}

/** R8.7: todo lo que menciona el error está en el alcance del actor (si no hay registro, no se puede comprobar). */
async function refsWithinScope(refs: ErrorScopeRefs | undefined, actor: ShiftActor): Promise<boolean> {
  if (!refs?.shiftGroupIds || !refs.employeeIds) return false;
  if (!refs.shiftGroupIds.every((groupId) => canManageShiftGroup(actor, groupId))) return false;
  return (await employeesOutsideScope(actor, refs.employeeIds)) === 0;
}

const GENERIC_MESSAGES: Record<string, string> = {
  SHIFT_ASSIGNMENT_OVERLAPS_ROTATION: "El turno fijo se superpone con una rotación de la persona. Cerrá primero la membresía o consultá con RRHH.",
  ROTATION_MEMBERSHIP_OVERLAP: "Una o más personas ya tienen una membresía de rotación en esas fechas. Revisá sus altas o consultá con RRHH.",
  ROTATION_ACTIVATION_RETROACTIVE: "No se puede activar: hay membresías que empiezan hoy o antes. Cancelalas y volvé a darlas de alta desde mañana, o consultá con RRHH.",
};

function issuesOf(details: unknown): ReadinessIssue[] | null {
  const issues = (details as { issues?: unknown } | null | undefined)?.issues;
  return Array.isArray(issues) ? (issues as ReadinessIssue[]) : null;
}

/**
 * R-6: versión del error que puede ver un actor sin acceso total. Conserva
 * código y estado HTTP; quita nombres, legajos y códigos de planificación de
 * otros grupos o de personas fuera de su alcance. Nivel 1: sin cambios.
 */
export async function redactShiftWriteError(error: unknown, actor: ShiftActor): Promise<unknown> {
  if (isGlobalActor(actor) || !(error instanceof AppError)) return error;
  const rebuild = (message: string, details?: unknown) => new AppError(message, error.statusCode, error.code, details);
  const refs = errorScopeOf(error);
  switch (error.code) {
    case "SHIFT_ASSIGNMENT_OVERLAPS_ROTATION":
    case "ROTATION_MEMBERSHIP_OVERLAP":
    case "ROTATION_ACTIVATION_RETROACTIVE":
      // R8.7: completo sólo si lo mencionado (planificación y personas) está en su alcance.
      if (await refsWithinScope(refs, actor)) return error;
      return rebuild(GENERIC_MESSAGES[error.code]!);
    case "ROTATION_TRANSITION_OVERLAP":
    case "ROTATION_FINALIZE_STALE":
      // Los rótulos del turno anterior/siguiente pueden ser de otra planificación
      // y no traen su grupo: no se puede comprobar, se quitan los detalles.
      return rebuild(error.message);
    case "ROTATION_CONFIGURATION_CONFLICT":
    case "ROTATION_NOT_READY":
    case "ROTATION_GRID_INVALID": {
      // Con los avisos internos registrados, cada uno se decide con precisión
      // (persona y grupo del turno fijo); sin ellos, el turno fijo va genérico.
      const raw = refs?.issues;
      const issues = raw ?? issuesOf(error.details);
      if (!issues) return error;
      const viewer = await rotationViewerForActor(actor, issues.flatMap((issue) => (issue.employeeId ? [issue.employeeId] : [])));
      const visible = visibleIssues(issues, viewer).map((issue) =>
        !raw && issue.code === "FIXED_ASSIGNMENT_OVERLAP" && issue.employeeId
          ? { ...issue, message: "Esta persona tiene un turno fijo superpuesto con su membresía." }
          : issue,
      );
      return rebuild(error.message, { ...(error.details as object), issues: visible });
    }
    case "ROTATION_ATTENDANCE_HISTORY_CONFLICT": {
      const details = error.details as { total?: number; conflicts?: Array<{ employeeId?: string; employee: string; operationalDate: string }> } | undefined;
      if (!details?.conflicts) return error;
      const viewer = await rotationViewerForActor(actor, details.conflicts.flatMap((row) => (row.employeeId ? [row.employeeId] : [])));
      const conflicts = details.conflicts.map(({ employeeId, ...row }) =>
        employeeId && viewer.visibleEmployeeIds?.has(employeeId) ? row : { ...row, employee: "Persona fuera de tu alcance" },
      );
      return rebuild(error.message, { ...details, conflicts });
    }
    default:
      return error;
  }
}

/** Ejecuta una escritura y, si falla, relanza el error tal como lo puede ver el actor. */
export async function withShiftActorErrors<T>(actor: ShiftActor, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw await redactShiftWriteError(error, actor);
  }
}

/** Actor de Nivel 1 para caminos internos y tests que ya están autorizados. */
export function globalShiftActor(user: Express.AuthUser): ShiftActor {
  return { user, scope: { all: true } };
}
