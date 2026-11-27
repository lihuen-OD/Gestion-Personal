/**
 * Ciclo de vida de una rotación (R4.8E): activar, desactivar y finalizar.
 * Las acciones se ofrecen sólo con los campos que calcula el backend
 * (`status`, `hasRuled`, `finalized`, `health`); el backend vuelve a validar
 * todo y es la autoridad. Acá no hay reglas propias de activación ni de
 * finalización: sólo se decide qué botón mostrar y cómo explicar un rechazo.
 */
import { ApiError } from "../services/api/apiClient";
import type { FinalizePreview, ShiftRotation } from "../services/api/shiftRotationApiService";
import { formatCalendarDate } from "./date";
import { describeMemberError } from "./shiftRotationMembers";
import { humanizeRotationMessage, rotationIssueCopy } from "./shiftRotation";

export function lifecycleActions(rotation: Pick<ShiftRotation, "status" | "hasRuled" | "finalized">) {
  return {
    /** Una rotación inactiva se puede intentar activar (el backend exige diagnóstico sin errores y altas desde mañana). */
    activate: rotation.status === "INACTIVO",
    /** Sólo si nunca rigió: si ya rigió, desactivarla cambiaría días pasados. */
    deactivate: rotation.status === "ACTIVO" && !rotation.hasRuled,
    /** Una activa se finaliza con un último día; una ya finalizada queda como historial. */
    finalize: rotation.status === "ACTIVO" && !rotation.finalized,
  };
}

/** El diagnóstico del backend ya informa errores: activar sería rechazado. */
export function activationBlocked(rotation: Pick<ShiftRotation, "health">) {
  return rotation.health === "ERROR";
}

export type LifecycleError = { code: string; message: string; details: string[] };

type ErrorBody = { error?: { details?: { issues?: Array<{ code: string; message: string }>; members?: Array<{ employee: string; effectiveFrom: string }>; preview?: FinalizePreview } } };

/** Rechazo de activar/desactivar/finalizar: mensaje de dominio limpio y detalle legible (problemas, altas retroactivas, superposiciones). */
export function describeLifecycleError(error: unknown, fallback: string): LifecycleError {
  const base = describeMemberError(error, fallback);
  if (!(error instanceof ApiError)) return { code: base.code, message: base.message, details: base.details };
  const details = ((error.payload ?? {}) as ErrorBody).error?.details ?? {};
  const lines: string[] = [];
  if (error.code === "ROTATION_NOT_READY") {
    for (const issue of details.issues ?? []) lines.push(`${rotationIssueCopy(issue.code).title}: ${humanizeRotationMessage(issue.message)}`);
  } else {
    lines.push(...base.details);
  }
  for (const member of details.members ?? []) lines.push(`${member.employee}: desde el ${formatCalendarDate(member.effectiveFrom)}`);
  return { code: error.code, message: base.message, details: [...new Set(lines)] };
}

/** `ROTATION_FINALIZE_STALE` trae la vista previa recalculada: la confirmación anterior deja de valer. */
export function stalePreviewOf(error: unknown): FinalizePreview | null {
  if (!(error instanceof ApiError) || error.code !== "ROTATION_FINALIZE_STALE") return null;
  return ((error.payload ?? {}) as ErrorBody).error?.details?.preview ?? null;
}

/** Huella de lo que cambia, para avisar si la vista previa nueva difiere de la que se estaba por confirmar. */
export function finalizeImpactSignature(preview: FinalizePreview) {
  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort().join(",");
  return [preview.lastDay, ids(preview.closeMembers), ids(preview.cancelMembers), ids(preview.closeVersions), ids(preview.deleteVersions), preview.withoutFixedShiftAfter.length, preview.transitionOverlaps.length].join("|");
}

export function finalizeHasChanges(preview: FinalizePreview) {
  return preview.closeMembers.length + preview.cancelMembers.length + preview.closeVersions.length + preview.deleteVersions.length > 0;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function finalizeResultText(applied: FinalizePreview) {
  const parts = [
    plural(applied.closeMembers.length, "pertenencia cerrada", "pertenencias cerradas"),
    plural(applied.cancelMembers.length, "alta futura cancelada", "altas futuras canceladas"),
    plural(applied.deleteVersions.length, "versión futura cancelada", "versiones futuras canceladas"),
  ];
  return `Rotación finalizada con último día ${formatCalendarDate(applied.lastDay)}: ${parts.join(", ")}.`;
}
