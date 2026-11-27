import type { HolidayWorkExpectedSchedule } from "../services/api/holidayWorkAssignmentApiService";
import { previewLabels } from "./shiftRotationPreview";

/**
 * Turno REAL de un candidato el día del feriado (WORKED_TIME_ACCOUNTING_MODEL.md
 * §20): misma tabla que valida el backend al guardar. Sin plantilla en la
 * convocatoria, rige este turno; si no hay ninguno resoluble, la plantilla es
 * obligatoria.
 */
export function scheduleRequiresTemplate(schedule: HolidayWorkExpectedSchedule | null | undefined): boolean {
  return !schedule || schedule.kind === "ROTATION_REST" || schedule.kind === "ROTATION_MISSING" || schedule.kind === "ROTATION_CONFLICT" || schedule.kind === "NONE";
}

const blocksLabel = (schedule: HolidayWorkExpectedSchedule) => schedule.blocks.map((block) => `${block.code} ${block.startTime}–${block.endTime}`).join(" + ");

export function expectedScheduleLabel(schedule: HolidayWorkExpectedSchedule | null | undefined): string {
  if (!schedule) return "Sin datos";
  switch (schedule.kind) {
    case "FIXED":
      return `Turno fijo: ${blocksLabel(schedule)}`;
    case "ROTATION_SHIFTS":
      return `Rotación: ${blocksLabel(schedule)}`;
    case "ROTATION_REST":
      return "Descanso de su rotación";
    case "ROTATION_MISSING":
      return `Rotación sin turno ese día${schedule.planReason ? ` (${previewLabels.planIssue(schedule.planReason)?.replace(/\.$/, "")})` : ""}`;
    case "ROTATION_CONFLICT":
      return `Conflicto en su rotación${schedule.planReason ? `: ${previewLabels.planIssue(schedule.planReason)?.replace(/\.$/, "")}` : ""}`;
    case "NONE":
      return "Sin turno ese día";
  }
}
