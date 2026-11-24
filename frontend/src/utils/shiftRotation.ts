/**
 * Presentación de rotaciones de turnos para RRHH (R4.8). Lógica pura: no
 * decide reglas de negocio (salud, bloqueos y diagnóstico los calcula el
 * backend), sólo traduce lo que devuelve la API a textos comprensibles.
 */
import type { ShiftRotation, ShiftRotationHealth, ShiftRotationIssue, ShiftRotationVersionSummary } from "../services/api/shiftRotationApiService";
import { workRegimeKindLabel } from "../components/work-regimes/workRegimeLabels";
import type { WorkRegimeKind } from "../types/workRegime.types";
import { formatCalendarDate } from "./date";
import type { ShiftGroup } from "../services/api/shiftGroupApiService";
import { sortShiftGroups } from "./shiftGroups";

type BadgeTone = "success" | "warning" | "danger" | "neutral" | "info";

export type RotationStateKey = "ACTIVE" | "INACTIVE" | "FINALIZED";

/** Estado visible: "Finalizada" es derivado (ACTIVA que ya no tiene versión ni personas desde hoy). */
export function rotationState(rotation: Pick<ShiftRotation, "status" | "finalized">): { key: RotationStateKey; label: string; tone: BadgeTone } {
  if (rotation.finalized) return { key: "FINALIZED", label: "Finalizada", tone: "neutral" };
  if (rotation.status === "ACTIVO") return { key: "ACTIVE", label: "Activa", tone: "success" };
  return { key: "INACTIVE", label: "Inactiva", tone: "neutral" };
}

export const ROTATION_STATE_OPTIONS: Array<{ value: RotationStateKey; label: string }> = [
  { value: "ACTIVE", label: "Activa" },
  { value: "INACTIVE", label: "Inactiva" },
  { value: "FINALIZED", label: "Finalizada" },
];

const HEALTH: Record<ShiftRotationHealth, { label: string; tone: BadgeTone }> = {
  OK: { label: "Sin observaciones", tone: "success" },
  WARNING: { label: "Con advertencias", tone: "warning" },
  ERROR: { label: "Requiere correcciones", tone: "danger" },
};

export function rotationHealth(health: ShiftRotationHealth) {
  return HEALTH[health] ?? HEALTH.WARNING;
}

/**
 * Título y explicación por código de diagnóstico. El mensaje del backend
 * (con nombres, equipos y fechas) se conserva como detalle de cada caso.
 */
const ISSUE_COPY: Record<string, { title: string; explanation: string }> = {
  GRID_INVALID: { title: "Grilla con datos inválidos", explanation: "Una versión tiene días o bloques mal configurados. Hay que corregir la grilla de esa versión." },
  GRID_INCOMPLETE: { title: "Días del ciclo sin configurar", explanation: "Cada día del ciclo debe indicar si el equipo trabaja (con su turno) o descansa." },
  TEMPLATE_OTHER_GROUP: { title: "Turno de otro grupo", explanation: "La grilla usa un turno que no pertenece al grupo de la rotación." },
  MEMBERSHIP_WITHOUT_VERSION: { title: "Personas sin grilla vigente", explanation: "Hay personas asignadas en fechas que ninguna versión de la rotación cubre." },
  CREW_WITHOUT_GRID: { title: "Equipo sin grilla", explanation: "Un equipo con personas asignadas no tiene días configurados en la versión que rige." },
  CREW_INACTIVE_WITH_MEMBERS: { title: "Equipo inactivo con personas", explanation: "Un equipo inactivo conserva personas asignadas. Hay que reactivarlo o reasignarlas." },
  FIXED_ASSIGNMENT_OVERLAP: { title: "Turno fijo superpuesto", explanation: "Una persona tiene un turno fijo habilitado en las mismas fechas que su rotación." },
  SIN_TURNO_OVERLAP: { title: "Régimen sin turno superpuesto", explanation: "Una persona tiene un régimen laboral que no admite turnos en las mismas fechas que su rotación." },
  EMPLOYEE_INACTIVE: { title: "Persona inactiva con asignación", explanation: "Una persona inactiva conserva una asignación vigente o futura en la rotación." },
};

const FALLBACK_ISSUE = { title: "Observación de la configuración", explanation: "Revisá el detalle indicado." };

export function rotationIssueCopy(code: string) {
  return ISSUE_COPY[code] ?? FALLBACK_ISSUE;
}

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const DATE_KEY_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

/**
 * Limpia un mensaje de dominio del backend antes de mostrarlo: fechas
 * AAAA-MM-DD → DD/MM/AAAA, estados y regímenes en mayúsculas → su nombre
 * visible, sin identificadores. No reescribe el contenido (los mensajes de
 * dominio ya son claros); sólo quita los restos técnicos.
 */
export function humanizeRotationMessage(message: string): string {
  return message
    .replace(UUID_PATTERN, "")
    .replace(DATE_KEY_PATTERN, (match) => formatCalendarDate(match))
    .replace(/\b(SIN_TURNO|TURNO_OBLIGATORIO|TURNO_FLEXIBLE)\b/g, (kind) => `«${workRegimeKindLabel(kind as WorkRegimeKind)}»`)
    .replace(/\b(ACTIVA|ACTIVO|INACTIVA|INACTIVO)\b/g, (word) => word.toLowerCase())
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .replace(/^\p{Ll}/u, (first) => first.toUpperCase());
}

export type RotationIssueGroup = {
  code: string;
  severity: "ERROR" | "WARNING";
  title: string;
  explanation: string;
  messages: string[];
};

/** Agrupa por código: errores primero, después advertencias; mensajes repetidos una sola vez. */
export function groupRotationIssues(issues: ShiftRotationIssue[]): RotationIssueGroup[] {
  const groups = new Map<string, RotationIssueGroup>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}`;
    let group = groups.get(key);
    if (!group) {
      group = { code: issue.code, severity: issue.severity, ...rotationIssueCopy(issue.code), messages: [] };
      groups.set(key, group);
    }
    const text = humanizeRotationMessage(issue.message);
    if (text && !group.messages.includes(text)) group.messages.push(text);
  }
  return [...groups.values()].sort((left, right) => (left.severity === right.severity ? 0 : left.severity === "ERROR" ? -1 : 1));
}

/** Versión que rige hoy o, si no hay, la próxima futura (la lista viene ordenada por fecha). */
export function rotationVersionStatus(versions: ShiftRotationVersionSummary[], todayKey: string): { label: string; detail: string | null } {
  const current = versions.find((version) => version.inEffectToday);
  if (current) return { label: `Desde el ${formatCalendarDate(current.effectiveFrom)}`, detail: current.effectiveTo ? `Hasta el ${formatCalendarDate(current.effectiveTo)}` : null };
  const next = versions.find((version) => version.effectiveFrom > todayKey);
  if (next) return { label: "Sin versión vigente", detail: `Próxima desde el ${formatCalendarDate(next.effectiveFrom)}` };
  return { label: "Sin versión vigente", detail: null };
}

export function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Misma normalización que el backend para códigos y nombres. */
export function normalizeRotationText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export type RotationFormValue = { code: string; name: string; shiftGroupId: string; observation: string };
export type RotationFormErrors = Partial<Record<keyof RotationFormValue, string>>;

/** Formato y longitudes del contrato (las reglas de negocio las valida el backend). */
export function validateRotationForm(value: RotationFormValue): RotationFormErrors {
  const errors: RotationFormErrors = {};
  const code = normalizeRotationText(value.code);
  const name = normalizeRotationText(value.name);
  if (!code) errors.code = "Ingresá un código.";
  else if (code.length > 30) errors.code = "El código no puede superar los 30 caracteres.";
  if (name.length < 2) errors.name = "Ingresá un nombre de al menos 2 caracteres.";
  else if (name.length > 80) errors.name = "El nombre no puede superar los 80 caracteres.";
  if (!value.shiftGroupId) errors.shiftGroupId = "Elegí el grupo de la rotación.";
  if (value.observation.trim().length > 500) errors.observation = "La observación no puede superar los 500 caracteres.";
  return errors;
}

export function rotationMatchesSearch(rotation: Pick<ShiftRotation, "code" | "name" | "shiftGroup">, term: string) {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return true;
  return `${rotation.code} ${rotation.name} ${rotation.shiftGroup?.name ?? ""}`.toLowerCase().includes(normalized);
}

/**
 * Grupos elegibles: sólo activos (como en el formulario de turnos). El grupo
 * actual de la rotación se conserva aunque esté inactivo, pero nunca se ofrece
 * un inactivo como destino nuevo. Una rotación siempre tiene grupo.
 */
export function rotationGroupOptions(groups: readonly ShiftGroup[] | null, current: ShiftRotation["shiftGroup"] | null): Array<{ value: string; label: string }> {
  const active = sortShiftGroups((groups ?? []).filter((group) => group.status === "ACTIVO"));
  const options = active.map((group) => ({ value: group.id, label: group.name }));
  if (current && !active.some((group) => group.id === current.id)) {
    options.push({ value: current.id, label: current.status === "ACTIVO" ? current.name : `${current.name} (inactivo)` });
  }
  return options;
}

/** Semanas del ciclo con sus letras, igual que la vista previa del backend (A, B, C…). */
export function rotationCycleLabel(cycleLengthWeeks: number): string {
  if (cycleLengthWeeks <= 1) return "1 semana";
  const letters = Array.from({ length: cycleLengthWeeks }, (_, index) => String.fromCharCode(65 + index));
  return `${cycleLengthWeeks} semanas (${letters.slice(0, -1).join(", ")} y ${letters[letters.length - 1]})`;
}

/** Versión de referencia para describir la grilla: la que rige hoy o la próxima. */
export function referenceVersion(versions: ShiftRotationVersionSummary[], todayKey: string) {
  return versions.find((version) => version.inEffectToday) ?? versions.find((version) => version.effectiveFrom > todayKey) ?? null;
}

/** El backend sólo permite eliminar una rotación inactiva que nunca tuvo personas. */
export function canDeleteRotation(rotation: Pick<ShiftRotation, "status" | "crews">) {
  return rotation.status === "INACTIVO" && !rotation.crews.some((crew) => crew.everHadMembers);
}
