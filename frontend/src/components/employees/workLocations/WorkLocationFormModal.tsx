import { useMemo, useState } from "react";
import { getUserErrorMessage } from "../../../services/api/apiClient";
import { employeeWorkLocationApiService } from "../../../services/api/employeeWorkLocationApiService";
import type { OrgStructureCatalog } from "../../../types/orgStructure.types";
import type { EmployeeWorkLocation } from "../../../types/employeeWorkLocation.types";
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
  workLocationDraftError,
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
  if (!location || mode === "create") return "Una persona puede tener varias zonas a la vez. En cada zona elegí explícitamente sus establecimientos.";
  const current = `${location.zone.name} · ${describeWorkLocationPeriod(location)}`;
  if (mode === "change") return `${current}. Se cerrará el día anterior a la nueva fecha desde y queda en el historial.`;
  if (mode === "end") return `${current}. Deja de aplicar después de la fecha de fin; no se reemplaza por otra.`;
  return `${current}. Corrige este mismo registro sin crear una vigencia nueva: usalo sólo para datos mal cargados.`;
}

export function WorkLocationFormModal({ mode, employeeId, catalog, location, close, onSaved }: Props) {
  const [draft, setDraft] = useState<WorkLocationDraft>(() => draftFrom(mode, argentinaDateKey(new Date()), location));
  const [error, setError] = useState("");
  const keepIds = useMemo(() => new Set(mode === "correct" ? location?.establishments.map((item) => item.id) : []), [mode, location]);
  const zones = zoneOptions(catalog, mode === "correct" ? location?.zone.id : undefined);
  const establishments = draft.zoneId ? establishmentOptions(catalog, draft.zoneId, keepIds) : [];
  const set = (patch: Partial<WorkLocationDraft>) => { setDraft((current) => ({ ...current, ...patch })); setError(""); };
  const toggle = (id: string) => set({ establishmentIds: draft.establishmentIds.includes(id) ? draft.establishmentIds.filter((item) => item !== id) : [...draft.establishmentIds, id] });

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
              <select value={draft.zoneId} onChange={(event) => set({ zoneId: event.target.value, establishmentIds: [] })}>
                <option value="">Seleccionar zona</option>
                {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.code} · {zone.name}</option>)}
              </select>
            </label>
            <fieldset className="work-location-establishments-field">
              <legend>Establecimientos de la zona *</legend>
              {!draft.zoneId ? (
                <p className="muted">Elegí una zona para ver sus establecimientos.</p>
              ) : establishments.length ? (
                <div className="check-grid">
                  {establishments.map((item) => (
                    <label className="check-card" key={item.id}>
                      <input type="checkbox" checked={draft.establishmentIds.includes(item.id)} onChange={() => toggle(item.id)} />
                      <span><b>{item.name}</b><small>{item.code}{item.status !== "ACTIVO" ? " · Inactivo (ya asignado)" : ""}</small></span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="muted">Esta zona no tiene establecimientos activos para asignar.</p>
              )}
              <small className="work-location-hint">Sin selección no se guarda: no existe la opción “zona completa”.</small>
            </fieldset>
            <div className="work-location-dates">
              <Field label={mode === "change" ? "Nueva vigencia desde *" : "Fecha desde *"} type="date" value={draft.effectiveFrom} set={(value) => set({ effectiveFrom: value })} />
              <Field label="Fecha hasta (opcional)" type="date" value={draft.effectiveTo} set={(value) => set({ effectiveTo: value })} />
            </div>
          </>
        )}
        <Field label={mode === "end" ? "Motivo de la finalización *" : mode === "correct" ? "Motivo de la asignación *" : "Motivo *"} value={draft.reason} set={(value) => set({ reason: value })} />
        {mode !== "end" ? <Field label="Observaciones" value={draft.notes} set={(value) => set({ notes: value })} /> : null}
        {mode === "correct" ? <Field label="Motivo de la corrección *" value={draft.correctionReason} set={(value) => set({ correctionReason: value })} /> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button variant="subtle" onClick={close} disabled={isRunning}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={isRunning}>{isRunning ? "Guardando..." : submitLabels[mode]}</Button>
        </div>
      </div>
    </Modal>
  );
}
