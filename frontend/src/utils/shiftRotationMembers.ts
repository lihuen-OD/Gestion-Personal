/**
 * Membresías de una rotación (R4.8C): estado de cada período, orden de la
 * tabla, acciones que el backend admitiría y lectura de sus rechazos. Las
 * reglas viven en `shiftRotationMembership.service.ts`; acá sólo se usan para
 * no ofrecer una acción que va a ser rechazada y para proponer fechas válidas.
 */
import { ApiError, getUserErrorMessage } from "../services/api/apiClient";
import type { ShiftRotationMember, ShiftRotationStatus } from "../services/api/shiftRotationApiService";
import { compareSortValues } from "./sort";
import { formatCalendarDate } from "./date";
import { humanizeRotationMessage } from "./shiftRotation";
import { addDaysKey } from "./shiftRotationDraft";

type BadgeTone = "success" | "warning" | "danger" | "neutral" | "info";

/** Máximo de personas por alta (contrato `employeeIds.max(50)`). */
export const MAX_MEMBERS_PER_ADD = 50;

export type MembershipTimeline = "CURRENT" | "FUTURE" | "ENDED";

export function membershipTimeline(member: Pick<ShiftRotationMember, "effectiveFrom" | "effectiveTo">, todayKey: string): MembershipTimeline {
  if (member.effectiveFrom > todayKey) return "FUTURE";
  if (member.effectiveTo !== null && member.effectiveTo < todayKey) return "ENDED";
  return "CURRENT";
}

const TIMELINE: Record<MembershipTimeline, { label: string; tone: BadgeTone }> = {
  CURRENT: { label: "Vigente", tone: "success" },
  FUTURE: { label: "Futura", tone: "info" },
  ENDED: { label: "Finalizada", tone: "neutral" },
};

export function membershipState(member: Pick<ShiftRotationMember, "effectiveFrom" | "effectiveTo">, todayKey: string) {
  return TIMELINE[membershipTimeline(member, todayKey)];
}

/** Por persona (apellido, nombre, legajo) y, para cada una, sus períodos en orden cronológico. */
export function sortMembers(members: ShiftRotationMember[]) {
  return [...members].sort((left, right) =>
    compareSortValues(left.employee, right.employee, "asc")
    || compareSortValues(left.legajo, right.legajo, "asc")
    || left.effectiveFrom.localeCompare(right.effectiveFrom));
}

export function memberMatchesSearch(member: Pick<ShiftRotationMember, "employee" | "legajo">, term: string) {
  const normalized = term.trim().toLowerCase();
  return !normalized || `${member.employee} ${member.legajo}`.toLowerCase().includes(normalized);
}

const maxKey = (...keys: string[]) => keys.sort().at(-1)!;

/**
 * Baja (`close`): último día desde hoy, no antes del inicio y antes del fin
 * actual. `null` si no hay ninguna fecha posible.
 */
export function closeRange(member: Pick<ShiftRotationMember, "effectiveFrom" | "effectiveTo">, todayKey: string): { min: string; max: string | null } | null {
  const min = maxKey(todayKey, member.effectiveFrom);
  const max = member.effectiveTo === null ? null : addDaysKey(member.effectiveTo, -1);
  return max !== null && max < min ? null : { min, max };
}

/**
 * Cambio de equipo (`move`): desde mañana, después del inicio y sin pasar el
 * fin actual. `null` si no es posible (p. ej. un alta futura: se cancela).
 */
export function moveRange(member: Pick<ShiftRotationMember, "effectiveFrom" | "effectiveTo">, todayKey: string): { min: string; max: string | null } | null {
  const min = maxKey(addDaysKey(todayKey, 1), addDaysKey(member.effectiveFrom, 1));
  const max = member.effectiveTo;
  return max !== null && max < min ? null : { min, max };
}

/** Cancelar: sólo un alta que nunca rigió (rotación inactiva, o inicio posterior a hoy). */
export function canCancelMembership(member: Pick<ShiftRotationMember, "effectiveFrom">, rotationStatus: ShiftRotationStatus, todayKey: string) {
  return rotationStatus === "INACTIVO" || member.effectiveFrom > todayKey;
}

export function membershipRangeText(member: Pick<ShiftRotationMember, "effectiveFrom" | "effectiveTo">) {
  return member.effectiveTo ? `del ${formatCalendarDate(member.effectiveFrom)} al ${formatCalendarDate(member.effectiveTo)}` : `desde el ${formatCalendarDate(member.effectiveFrom)}`;
}

/** R8: `template` es `null` cuando el turno fijo es de un grupo que quien opera no administra. */
export type FixedAssignmentConflict = { employee: string; template: string | null; effectiveFrom: string; effectiveTo: string | null };

export type MemberActionError = {
  code: string;
  message: string;
  details: string[];
  /** 409 ROTATION_FIXED_ASSIGNMENT_OVERLAP: turnos fijos que la opción explícita cerraría. */
  fixedAssignments: FixedAssignmentConflict[];
};

type ErrorBody = { error?: { message?: string; details?: { assignments?: FixedAssignmentConflict[]; overlaps?: Array<{ employee?: string; outgoing?: string; incoming?: string }>; issues?: Array<{ message: string }> } } };

/**
 * Traduce un rechazo de membresía. El mensaje de dominio se toma del cuerpo
 * de la respuesta y se limpia (`SIN_TURNO`, fechas, estados): el cliente
 * global descarta los mensajes con términos técnicos y dejaría sólo un texto
 * genérico. El conflicto con turnos fijos se explica con su propio texto,
 * porque el del backend nombra un parámetro técnico.
 */
export function describeMemberError(error: unknown, fallback: string): MemberActionError {
  if (!(error instanceof ApiError)) return { code: "", message: fallback, details: [], fixedAssignments: [] };
  const body = (error.payload ?? {}) as ErrorBody;
  const details = body.error?.details ?? {};
  if (error.code === "ROTATION_FIXED_ASSIGNMENT_OVERLAP") {
    return { code: error.code, message: "Algunas personas tienen turnos fijos habilitados en las mismas fechas que el alta.", details: [], fixedAssignments: details.assignments ?? [] };
  }
  const raw = body.error?.message ? humanizeRotationMessage(body.error.message) : "";
  const message = raw && !/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|[{}[\]]|[a-z]+[A-Z][a-zA-Z]+/.test(raw) ? raw : humanizeRotationMessage(getUserErrorMessage(error, fallback));
  const lines: string[] = [];
  for (const overlap of details.overlaps ?? []) {
    if (overlap.employee && overlap.outgoing && overlap.incoming) lines.push(humanizeRotationMessage(`${overlap.employee}: ${overlap.outgoing} se superpone con ${overlap.incoming}.`));
  }
  for (const issue of details.issues ?? []) lines.push(humanizeRotationMessage(issue.message));
  return { code: error.code, message, details: [...new Set(lines)], fixedAssignments: [] };
}

export function fixedAssignmentText(conflict: FixedAssignmentConflict) {
  const range = conflict.effectiveTo ? `del ${formatCalendarDate(conflict.effectiveFrom)} al ${formatCalendarDate(conflict.effectiveTo)}` : `desde el ${formatCalendarDate(conflict.effectiveFrom)}`;
  return `${conflict.employee}: turno fijo ${conflict.template ?? "de otro grupo"} ${range}`;
}
