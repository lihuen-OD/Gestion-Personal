import { useMemo, useState } from "react";
import { getUserErrorMessage } from "../../../services/api/apiClient";
import { employeeWorkLocationApiService } from "../../../services/api/employeeWorkLocationApiService";
import type { OrgStructureCatalog } from "../../../types/orgStructure.types";
import type { EmployeeWorkLocation, WorkLocationCoverage, WorkLocationEstablishmentSelection } from "../../../types/employeeWorkLocation.types";
import { argentinaDateKey } from "../../../utils/argentinaDateKey";
import { formatCalendarDate } from "../../../utils/date";
import { useAsyncAction } from "../../../utils/useAsyncAction";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/FormControls";
import { Modal } from "../../ui/Modal";
import {
  assignmentPayload,
  correctionPayload,
  describeWorkLocationPeriod,
  draftFrom,
  establishmentOptions,
  unitOptions,
  workLocationDraftError,
  zonePath,
  zoneOptions,
  type WorkLocationDraft,
  type WorkLocationFormMode,
} from "./workLocationForm";

const titles: Record<WorkLocationFormMode, string> = {
  create: "Agregar ubicación de trabajo",
  change: "Cambiar ubicación desde una fecha",
  end: "Finalizar ubicación",
  correct: "Corregir registro de ubicación",
};

const submitLabels: Record<WorkLocationFormMode, string> = {
  create: "Guardar ubicación",
  change: "Registrar cambio",
  end: "Finalizar ubicación",
  correct: "Guardar corrección",
};

type Props = {
  mode: WorkLocationFormMode;
  employeeId: string;
  catalog: OrgStructureCatalog;
  location?: EmployeeWorkLocation;
  close: () => void;
  onSaved: (rows: EmployeeWorkLocation[]) => void;
};

function subtitleFor(mode: WorkLocationFormMode, location?: EmployeeWorkLocation) {
  if (!location || mode === "create") return "Una persona puede tener varias zonas a la vez. En cada zona elegí explícitamente sus establecimientos y, si corresponde, sus unidades.";
  const current = `${zonePath(location.zone)} · ${describeWorkLocationPeriod(location)}`;
  if (mode === "change") return `${current}. Se cerrará el día anterior a la nueva fecha desde y queda en el historial.`;
  if (mode === "end") return `${current}. Deja de aplicar después de la fecha de fin; no se reemplaza por otra.`;
  return `${current}. Corrige este mismo registro sin crear una vigencia nueva: usalo sólo para datos mal cargados.`;
}

export function WorkLocationFormModal({ mode, employeeId, catalog, location, close, onSaved }: Props) {
  const [draft, setDraft] = useState<WorkLocationDraft>(() => draftFrom(mode, argentinaDateKey(new Date()), location));
  const [error, setError] = useState("");
  const keepIds = useMemo(() => new Set(mode === "correct" ? location?.establishments.map((item) => item.id) : []), [mode, location]);
  const keepUnitIds = useMemo(() => new Set(mode === "correct" ? location?.establishments.flatMap((item) => item.units.map((unit) => unit.id)) : []), [mode, location]);
  const zones = zoneOptions(catalog, mode === "correct" ? location?.zone.id : undefined);
  const provinceName = (provinceId?: string) => (catalog.provinces ?? []).find((item) => item.id === provinceId)?.name;
  const establishments = draft.zoneId ? establishmentOptions(catalog, draft.zoneId, keepIds) : [];
  const set = (patch: Partial<WorkLocationDraft>) => { setDraft((current) => ({ ...current, ...patch })); setError(""); };
  const selectionFor = (id: string) => draft.establishments.find((item) => item.establishmentId === id);
  const updateSelection = (id: string, patch: Partial<WorkLocationEstablishmentSelection>) =>
    set({ establishments: draft.establishments.map((item) => (item.establishmentId === id ? { ...item, ...patch } : item)) });
  // Un establecimiento recién elegido arranca como completo: es la cobertura
  // que no requiere más datos. "Unidades específicas" se elige a mano.
  const toggle = (id: string) => set({
    establishments: selectionFor(id)
      ? draft.establishments.filter((item) => item.establishmentId !== id)
      : [...draft.establishments, { establishmentId: id, coverage: "ESTABLISHMENT", unitIds: [] }],
  });
  const setCoverage = (id: string, coverage: WorkLocationCoverage) => updateSelection(id, { coverage, unitIds: coverage === "UNITS" ? selectionFor(id)?.unitIds ?? [] : [] });
  const toggleUnit = (id: string, unitId: string) => {
    const unitIds = selectionFor(id)?.unitIds ?? [];
    updateSelection(id, { unitIds: unitIds.includes(unitId) ? unitIds.filter((item) => item !== unitId) : [...unitIds, unitId] });
  };

  const { isRunning, run: submit } = useAsyncAction(async () => {
    const validation = workLocationDraftError(mode, draft);
    if (validation) return setError(validation);
    try {
      const rows = mode === "create"
        ? await employeeWorkLocationApiService.create(employeeId, assignmentPayload(draft))
        : mode === "change"
          ? await employeeWorkLocationApiService.change(employeeId, location!.id, assignmentPayload(draft))
          : mode === "end"
            ? await employeeWorkLocationApiService.end(employeeId, location!.id, { effectiveTo: draft.effectiveTo, reason: draft.reason.trim() })
            : await employeeWorkLocationApiService.correct(employeeId, location!.id, correctionPayload(location!, draft));
      onSaved(rows);
    } catch (saveError) {
      setError(getUserErrorMessage(saveError, "No pudimos guardar la ubicación. Intentá nuevamente."));
    }
  });

  return (
    <Modal title={titles[mode]} subtitle={subtitleFor(mode, location)} close={close} closeDisabled={isRunning}>
      <div className="form-stack work-location-form">
        {mode === "end" ? (
          <Field label={`Fecha de fin * (inicio ${formatCalendarDate(draft.effectiveFrom)})`} type="date" value={draft.effectiveTo} set={(value) => set({ effectiveTo: value })} />
        ) : (
          <>
            <label>
              Zona *
              <select value={draft.zoneId} onChange={(event) => set({ zoneId: event.target.value, establishments: [] })}>
                <option value="">Seleccionar zona</option>
                {zones.map((zone) => <option key={zone.id} value={zone.id}>{provinceName(zone.provinceId) ? `${provinceName(zone.provinceId)} › ` : ""}{zone.name} · {zone.code}{zone.provinceId ? "" : " (sin provincia)"}</option>)}
              </select>
            </label>
            <fieldset className="work-location-establishments-field">
              <legend>Establecimientos de la zona *</legend>
              {!draft.zoneId ? (
                <p className="muted">Elegí una zona para ver sus establecimientos.</p>
              ) : establishments.length ? (
                <div className="check-grid">
                  {establishments.map((item) => {
                    const unitCount = unitOptions(catalog, item.id).length;
                    return (
                      <label className="check-card" key={item.id}>
                        <input type="checkbox" checked={Boolean(selectionFor(item.id))} onChange={() => toggle(item.id)} />
                        <span><b>{item.name}</b><small>{item.code}{item.status !== "ACTIVO" ? " · Inactivo (ya asignado)" : ""} · {unitCount ? `${unitCount} ${unitCount === 1 ? "unidad" : "unidades"}` : "sin unidades"}</small></span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">Esta zona no tiene establecimientos activos para asignar.</p>
              )}
              <small className="work-location-hint">Sin selección no se guarda: no existe la opción “zona completa”.</small>
            </fieldset>
            {establishments.filter((item) => selectionFor(item.id)).map((item) => {
              const selection = selectionFor(item.id)!;
              const selectedUnits = new Set(selection.unitIds);
              // Las unidades ya elegidas se muestran aunque se hayan inactivado:
              // al corregir se conservan; en un cambio hay que quitarlas.
              const units = unitOptions(catalog, item.id, new Set([...keepUnitIds, ...selectedUnits]));
              // Sin unidades cargadas el establecimiento sólo puede asignarse completo.
              if (!units.length && selection.coverage === "ESTABLISHMENT") return null;
              return (
                <fieldset className="work-location-coverage" key={item.id}>
                  <legend>{item.name}: ¿qué se asigna?</legend>
                  <div className="work-location-coverage-modes" role="radiogroup" aria-label={`Cobertura de ${item.name}`}>
                    <label><input type="radio" name={`coverage-${item.id}`} checked={selection.coverage === "ESTABLISHMENT"} onChange={() => setCoverage(item.id, "ESTABLISHMENT")} /> Establecimiento completo</label>
                    <label><input type="radio" name={`coverage-${item.id}`} checked={selection.coverage === "UNITS"} onChange={() => setCoverage(item.id, "UNITS")} disabled={!units.length} /> Unidades específicas</label>
                  </div>
                  {selection.coverage === "UNITS" ? (
                    units.length ? (
                      <div className="check-grid">
                        {units.map((unit) => (
                          <label className="check-card" key={unit.id}>
                            <input type="checkbox" checked={selectedUnits.has(unit.id)} onChange={() => toggleUnit(item.id, unit.id)} />
                            <span><b>{unit.name}</b><small>{unit.code}{unit.status !== "ACTIVO" ? (keepUnitIds.has(unit.id) ? " · Inactiva (ya asignada)" : " · Inactiva: quitala para guardar") : ""}</small></span>
                          </label>
                        ))}
                      </div>
                    ) : <p className="muted">Este establecimiento no tiene unidades activas: asignalo completo.</p>
                  ) : null}
                </fieldset>
              );
            })}
            <div className="work-location-dates">
              <Field label={mode === "change" ? "Nueva vigencia desde *" : "Fecha desde *"} type="date" value={draft.effectiveFrom} set={(value) => set({ effectiveFrom: value })} />
              <Field label="Fecha hasta (opcional)" type="date" value={draft.effectiveTo} set={(value) => set({ effectiveTo: value })} />
            </div>
          </>
        )}
        <Field label={mode === "end" ? "Motivo de la finalización *" : mode === "correct" ? "Motivo de la asignación *" : "Motivo *"} value={draft.reason} set={(value) => set({ reason: value })} spellCheck />
        {mode !== "end" ? <Field label="Observaciones" value={draft.notes} set={(value) => set({ notes: value })} spellCheck /> : null}
        {mode === "correct" ? <Field label="Motivo de la corrección *" value={draft.correctionReason} set={(value) => set({ correctionReason: value })} spellCheck /> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button variant="subtle" onClick={close} disabled={isRunning}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={isRunning}>{isRunning ? "Guardando..." : submitLabels[mode]}</Button>
        </div>
      </div>
    </Modal>
  );
}
