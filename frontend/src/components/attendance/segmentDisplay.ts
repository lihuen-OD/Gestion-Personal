import type { AttendanceSegment, AttendanceSegmentSpecialRuleApplication, SegmentConceptStatus } from "../../services/api/attendanceApiService";
import { formatCompactDurationMinutes } from "../../utils/hours";

export const segmentConceptStatusLabels: Record<SegmentConceptStatus, string> = {
  SUGERIDO: "Sugerido por sistema",
  MANUAL: "Manual",
  SIN_CONCEPTO_COMPATIBLE: "Sin concepto adicional",
  CONCEPTO_NO_HABILITADO: "Concepto no habilitado",
};

export function segmentConceptStatusLabel(status: SegmentConceptStatus) {
  return segmentConceptStatusLabels[status] || status;
}

// SIN_CONCEPTO_COMPATIBLE es metadata histórica del fallback a Hora normal:
// no expresa una anomalía. CONCEPTO_NO_HABILITADO conserva su warning para
// datos defensivos/históricos.
export const segmentConceptStatusTones: Record<SegmentConceptStatus, "success" | "warning" | "neutral"> = {
  SUGERIDO: "success",
  MANUAL: "neutral",
  SIN_CONCEPTO_COMPATIBLE: "neutral",
  CONCEPTO_NO_HABILITADO: "warning",
};

export function segmentConceptStatusTone(status: SegmentConceptStatus) {
  return segmentConceptStatusTones[status] || "neutral";
}

export const segmentConceptStatusMessages: Record<SegmentConceptStatus, string> = {
  SUGERIDO: "Clasificado automáticamente según reglas horarias configuradas.",
  MANUAL: "Clasificación manual.",
  SIN_CONCEPTO_COMPATIBLE: "Hora normal sin concepto adicional aplicado.",
  CONCEPTO_NO_HABILITADO: "El sistema detectó un concepto posible, pero el empleado no lo tiene habilitado. Requiere revisión.",
};

export function segmentConceptStatusMessage(status: SegmentConceptStatus) {
  return segmentConceptStatusMessages[status] || "";
}

export type SegmentReviewState = "REQUIRES_REVIEW" | "OK" | "UNKNOWN";

// UNKNOWN cuando el endpoint de origen todavía no trae conceptStatus (ver
// AttendanceSegment en attendanceApiService.ts) — nunca se asume "OK" ni
// "requiere revisión" a partir de un dato que no llegó.
export function getSegmentReviewState(conceptStatus: SegmentConceptStatus | undefined): SegmentReviewState {
  if (!conceptStatus) return "UNKNOWN";
  if (conceptStatus === "CONCEPTO_NO_HABILITADO") return "REQUIRES_REVIEW";
  return "OK";
}

// 1 -> "Normal" (no se aplicó ninguna regla especial), N -> "xN".
export function formatMultiplier(value: number | string | undefined | null): string {
  if (value === undefined || value === null) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  if (numeric === 1) return "Normal";
  // String(numeric) ya da la representación mínima (1.5, no 1.50) — Number()
  // arriba ya colapsó cualquier "1.50" del backend a 1.5 antes de esto.
  return `x${numeric}`;
}

// 90 -> "1h 30m". Formato compacto para una tabla densa de segmentos —
// deliberadamente distinto de formatDuration() (AttendancePage.tsx, "1 h 30
// min") que se usa en las columnas de Ingreso/Salida de esa misma pantalla;
// no se tocó esa función existente para no alterar su formato en otro lado.
export function formatMinutesDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "-";
  return formatCompactDurationMinutes(minutes);
}

// hourConceptRuleId presente -> una HourConceptRule disparó la clasificación
// (ver módulo de Reglas horarias, Etapa 8C). null/undefined -> no se aplicó
// una regla adicional (puede ser manual o fallback normal). Nunca se muestra
// el id crudo, que no es accionable para RRHH.
export function describeHourConceptRule(hourConceptRuleId: string | null | undefined): string {
  return hourConceptRuleId ? "Regla horaria aplicada" : "Sin regla adicional aplicada";
}

// Desde la Etapa 8F, specialHourRuleApplications sí llega (select unificado
// en el backend) — si está presente y no vacío, se muestra CUÁL regla se
// aplicó y su multiplicador, en vez del mensaje genérico "detalle no
// disponible". applications ausente/vacío con isSpecial=true igual puede
// pasar (ej. datos viejos ya cerrados antes de esta etapa) — ahí se cae al
// mensaje anterior, nunca se inventa una regla.
export function describeSpecialRuleApplication(isSpecial: boolean, applications?: AttendanceSegmentSpecialRuleApplication[]): string {
  if (applications?.length) {
    return applications.map((application) => `${application.doubleHourRule.name} (${formatMultiplier(application.multiplierApplied)})`).join(", ");
  }
  return isSpecial ? "Sí — detalle de la regla no disponible en esta vista (requiere extender la API)" : "Sin reglas especiales";
}

// El backend ya devuelve los tramos ordenados (orderBy fromDateTime asc en
// ambos endpoints de asistencia), pero el panel no depende de eso: se
// reordena siempre acá para no romper si algún día cambia el orden del lado
// del servidor.
export function sortSegmentsByStart(segments: AttendanceSegment[]): AttendanceSegment[] {
  return [...segments].sort((a, b) => new Date(a.fromDateTime).getTime() - new Date(b.fromDateTime).getTime());
}
