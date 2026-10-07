import type { OrgEstablishment, OrgStructureCatalog, OrgZone } from "../../../types/orgStructure.types";
import type { EmployeeWorkLocation, WorkLocationAssignmentInput, WorkLocationCorrectionInput, WorkLocationState } from "../../../types/employeeWorkLocation.types";
import { formatCalendarDate } from "../../../utils/date";
import { nextCalendarDateKey } from "../../../utils/argentinaDateKey";

export type WorkLocationFormMode = "create" | "change" | "end" | "correct";

export type WorkLocationDraft = {
  zoneId: string;
  establishmentIds: string[];
  effectiveFrom: string;
  effectiveTo: string;
  reason: string;
  notes: string;
  correctionReason: string;
};

export const workLocationStateLabels: Record<WorkLocationState, string> = { CURRENT: "Vigente", FUTURE: "Futura", ENDED: "Finalizada" };
export const workLocationStateTones: Record<WorkLocationState, "success" | "warning" | "neutral"> = { CURRENT: "success", FUTURE: "warning", ENDED: "neutral" };
const stateOrder: Record<WorkLocationState, number> = { CURRENT: 0, FUTURE: 1, ENDED: 2 };

export function describeWorkLocationPeriod(location: Pick<EmployeeWorkLocation, "effectiveFrom" | "effectiveTo">) {
  return location.effectiveTo
    ? `${formatCalendarDate(location.effectiveFrom)} → ${formatCalendarDate(location.effectiveTo)}`
    : `Desde ${formatCalendarDate(location.effectiveFrom)} · sin fecha de fin`;
}

/** Vigentes, futuras y finalizadas; dentro de cada grupo, por zona y fecha. */
export function sortWorkLocations(rows: EmployeeWorkLocation[]) {
  return [...rows].sort((a, b) =>
    stateOrder[a.state] - stateOrder[b.state]
    || a.zone.name.localeCompare(b.zone.name, "es")
    || b.effectiveFrom.localeCompare(a.effectiveFrom));
}

/**
 * Zonas y establecimientos elegibles: sólo del árbol nuevo y activos. Al
 * corregir, se conservan los nodos inactivos que ya estaban en el registro.
 */
export function zoneOptions(catalog: OrgStructureCatalog, keepZoneId?: string): OrgZone[] {
  return catalog.zones
    .filter((zone) => zone.status === "ACTIVO" || zone.id === keepZoneId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function establishmentOptions(catalog: OrgStructureCatalog, zoneId: string, keepIds: ReadonlySet<string> = new Set()): OrgEstablishment[] {
  return catalog.establishments
    .filter((item) => item.zoneId === zoneId && !item.pendingReload && (item.status === "ACTIVO" || keepIds.has(item.id)))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function draftFrom(mode: WorkLocationFormMode, todayKey: string, location?: EmployeeWorkLocation): WorkLocationDraft {
  const blank = { zoneId: "", establishmentIds: [], effectiveFrom: todayKey, effectiveTo: "", reason: "", notes: "", correctionReason: "" };
  if (!location || mode === "create") return blank;
  if (mode === "end") return { ...blank, effectiveFrom: location.effectiveFrom, effectiveTo: todayKey < location.effectiveFrom ? location.effectiveFrom : todayKey };
  const establishmentIds = location.establishments.map((item) => item.id);
  if (mode === "change") {
    const firstAllowed = nextCalendarDateKey(location.effectiveFrom);
    return { ...blank, zoneId: location.zone.id, establishmentIds, effectiveFrom: todayKey < firstAllowed ? firstAllowed : todayKey, effectiveTo: location.effectiveTo || "" };
  }
  return { zoneId: location.zone.id, establishmentIds, effectiveFrom: location.effectiveFrom, effectiveTo: location.effectiveTo || "", reason: location.reason, notes: location.notes || "", correctionReason: "" };
}

/** Validación de la UI; el backend sigue siendo la autoridad. */
export function workLocationDraftError(mode: WorkLocationFormMode, draft: WorkLocationDraft): string {
  if (mode === "end") {
    if (!draft.effectiveTo) return "Indicá la fecha de fin.";
    if (draft.effectiveTo < draft.effectiveFrom) return "La fecha de fin no puede ser anterior al inicio de la ubicación.";
    if (draft.reason.trim().length < 2) return "Indicá el motivo de la finalización.";
    return "";
  }
  if (!draft.zoneId) return "Seleccioná una zona.";
  if (!draft.establishmentIds.length) return "Seleccioná al menos un establecimiento de la zona. No existe la opción “zona completa”.";
  if (!draft.effectiveFrom) return "La fecha desde es obligatoria.";
  if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom) return "La fecha hasta no puede ser anterior a la fecha desde.";
  if (draft.reason.trim().length < 2) return "El motivo es obligatorio.";
  if (mode === "correct" && draft.correctionReason.trim().length < 2) return "Indicá el motivo de la corrección.";
  return "";
}

export function assignmentPayload(draft: WorkLocationDraft): WorkLocationAssignmentInput {
  return {
    zoneId: draft.zoneId,
    establishmentIds: draft.establishmentIds,
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo || null,
    reason: draft.reason.trim(),
    notes: draft.notes.trim() || null,
  };
}

/** Corrección: sólo los datos que difieren del registro original. */
export function correctionPayload(location: EmployeeWorkLocation, draft: WorkLocationDraft): WorkLocationCorrectionInput {
  const next = assignmentPayload(draft);
  const currentIds = location.establishments.map((item) => item.id);
  const sameEstablishments = currentIds.length === next.establishmentIds.length && next.establishmentIds.every((id) => currentIds.includes(id));
  return {
    ...(next.zoneId !== location.zone.id ? { zoneId: next.zoneId } : {}),
    ...(!sameEstablishments ? { establishmentIds: next.establishmentIds } : {}),
    ...(next.effectiveFrom !== location.effectiveFrom ? { effectiveFrom: next.effectiveFrom } : {}),
    ...(next.effectiveTo !== location.effectiveTo ? { effectiveTo: next.effectiveTo } : {}),
    ...(next.reason !== location.reason ? { reason: next.reason } : {}),
    ...(next.notes !== location.notes ? { notes: next.notes } : {}),
    correctionReason: draft.correctionReason.trim(),
  };
}
