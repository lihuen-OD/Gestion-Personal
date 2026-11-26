/**
 * R8.7 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §26): qué grupos de turnos
 * y legajos menciona un error de conflicto, registrado donde se lanza. Permite
 * mostrar a un Nivel 2/3 el mensaje completo cuando TODO lo mencionado está en
 * su alcance (`redactShiftWriteError`); si falta el registro o algo es ajeno,
 * se usa el texto genérico. Nunca se serializa: vive en un `WeakMap` del
 * proceso, atado al objeto error. Módulo puro (sin Prisma).
 */
import type { ReadinessIssue } from "./shiftRotationReadiness";

export type ErrorScopeRefs = {
  /** Grupos de la planificación mencionada (`null` = plantilla sin grupo). */
  shiftGroupIds?: Array<string | null>;
  /** Legajos mencionados (por nombre o legajo) en el mensaje o los detalles. */
  employeeIds?: string[];
  /** Avisos con sus datos internos (`relatedShiftGroupId`), antes de hacerlos públicos. */
  issues?: ReadinessIssue[];
};

const registry = new WeakMap<object, ErrorScopeRefs>();

export function withErrorScope<T extends object>(error: T, refs: ErrorScopeRefs): T {
  registry.set(error, refs);
  return error;
}

export function errorScopeOf(error: object): ErrorScopeRefs | undefined {
  return registry.get(error);
}
