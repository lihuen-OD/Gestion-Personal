import type { OrgEstablishment, OrgEstablishmentUnit, OrgStructureCatalog, OrgZone } from "../../../types/orgStructure.types";
import type {
  EmployeeWorkLocation,
  WorkLocationAssignmentInput,
  WorkLocationCorrectionInput,
  WorkLocationEstablishment,
  WorkLocationEstablishmentSelection,
  WorkLocationState,
} from "../../../types/employeeWorkLocation.types";
import { formatCalendarDate } from "../../../utils/date";
import { nextCalendarDateKey } from "../../../utils/argentinaDateKey";
import { establishmentUnitsLabel, zonePathLabel } from "../../../utils/workLocationPath";

export type WorkLocationFormMode = "create" | "change" | "end" | "correct";

export type WorkLocationDraft = {
  zoneId: string;
  /** Un elemento por establecimiento elegido, con su cobertura explícita. */
  establishments: WorkLocationEstablishmentSelection[];
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
  const path = (zone: OrgZone) => zonePathLabel(zone.name, catalog.provinces?.find((province) => province.id === zone.provinceId)?.name);
  return catalog.zones
    .filter((zone) => zone.status === "ACTIVO" || zone.id === keepZoneId)
    .sort((a, b) => path(a).localeCompare(path(b), "es"));
}

export function establishmentOptions(catalog: OrgStructureCatalog, zoneId: string, keepIds: ReadonlySet<string> = new Set()): OrgEstablishment[] {
  return catalog.establishments
    .filter((item) => item.zoneId === zoneId && !item.pendingReload && (item.status === "ACTIVO" || keepIds.has(item.id)))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Unidades activas del establecimiento; al corregir se conservan las inactivas ya asignadas. */
export function unitOptions(catalog: OrgStructureCatalog, establishmentId: string, keepIds: ReadonlySet<string> = new Set()): OrgEstablishmentUnit[] {
  return (catalog.establishmentUnits ?? [])
    .filter((item) => item.establishmentId === establishmentId && (item.status === "ACTIVO" || keepIds.has(item.id)))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** "La Suiza (Lote Norte, Lote Sur)" o "Oficina Central". */
export function establishmentSummary(item: Pick<WorkLocationEstablishment, "name" | "coverage" | "units">) {
  return establishmentUnitsLabel(item.name, item.coverage, item.units.map((unit) => unit.name));
}

/** "Entre Ríos › Arroyo Barú", o sólo la zona si todavía no tiene provincia. */
export function zonePath(zone: EmployeeWorkLocation["zone"]) {
  return zonePathLabel(zone.name, zone.province?.name);
}

const selectionOf = (item: WorkLocationEstablishment): WorkLocationEstablishmentSelection => ({
  establishmentId: item.id,
  coverage: item.coverage,
  unitIds: item.coverage === "UNITS" ? item.units.map((unit) => unit.id) : [],
});

const selectionKey = (items: WorkLocationEstablishmentSelection[]) =>
  items.map((item) => `${item.establishmentId}:${item.coverage}:${item.coverage === "UNITS" ? [...item.unitIds].sort().join(",") : ""}`).sort().join("|");

export function draftFrom(mode: WorkLocationFormMode, todayKey: string, location?: EmployeeWorkLocation): WorkLocationDraft {
  const blank = { zoneId: "", establishments: [], effectiveFrom: todayKey, effectiveTo: "", reason: "", notes: "", correctionReason: "" };
  if (!location || mode === "create") return blank;
  if (mode === "end") return { ...blank, effectiveFrom: location.effectiveFrom, effectiveTo: todayKey < location.effectiveFrom ? location.effectiveFrom : todayKey };
  const establishments = location.establishments.map(selectionOf);
  if (mode === "change") {
    const firstAllowed = nextCalendarDateKey(location.effectiveFrom);
    return { ...blank, zoneId: location.zone.id, establishments, effectiveFrom: todayKey < firstAllowed ? firstAllowed : todayKey, effectiveTo: location.effectiveTo || "" };
  }
  return { zoneId: location.zone.id, establishments, effectiveFrom: location.effectiveFrom, effectiveTo: location.effectiveTo || "", reason: location.reason, notes: location.notes || "", correctionReason: "" };
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
  if (!draft.establishments.length) return "Seleccioná al menos un establecimiento de la zona. No existe la opción “zona completa”.";
  if (draft.establishments.some((item) => item.coverage === "UNITS" && !item.unitIds.length)) return "Elegí al menos una unidad en cada establecimiento marcado con “Unidades específicas”, o marcalo como establecimiento completo.";
  if (!draft.effectiveFrom) return "La fecha desde es obligatoria.";
  if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom) return "La fecha hasta no puede ser anterior a la fecha desde.";
  if (draft.reason.trim().length < 2) return "El motivo es obligatorio.";
  if (mode === "correct" && draft.correctionReason.trim().length < 2) return "Indicá el motivo de la corrección.";
  return "";
}

export function assignmentPayload(draft: WorkLocationDraft): WorkLocationAssignmentInput {
  return {
    zoneId: draft.zoneId,
    establishments: draft.establishments.map((item) => ({ ...item, unitIds: item.coverage === "UNITS" ? item.unitIds : [] })),
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo || null,
    reason: draft.reason.trim(),
    notes: draft.notes.trim() || null,
  };
}

/** Corrección: sólo los datos que difieren del registro original. */
export function correctionPayload(location: EmployeeWorkLocation, draft: WorkLocationDraft): WorkLocationCorrectionInput {
  const next = assignmentPayload(draft);
  const sameEstablishments = selectionKey(next.establishments) === selectionKey(location.establishments.map(selectionOf));
  return {
    ...(next.zoneId !== location.zone.id ? { zoneId: next.zoneId } : {}),
    ...(!sameEstablishments ? { establishments: next.establishments } : {}),
    ...(next.effectiveFrom !== location.effectiveFrom ? { effectiveFrom: next.effectiveFrom } : {}),
    ...(next.effectiveTo !== location.effectiveTo ? { effectiveTo: next.effectiveTo } : {}),
    ...(next.reason !== location.reason ? { reason: next.reason } : {}),
    ...(next.notes !== location.notes ? { notes: next.notes } : {}),
    correctionReason: draft.correctionReason.trim(),
  };
}
