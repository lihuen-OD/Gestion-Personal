import { useEffect, useRef, useState } from "react";
import { employeeWorkLocationApiService } from "../../../services/api/employeeWorkLocationApiService";
import { orgStructureApiService } from "../../../services/api/orgStructureApiService";
import type { OrgStructureCatalog } from "../../../types/orgStructure.types";
import type { EmployeeWorkLocation } from "../../../types/employeeWorkLocation.types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingState } from "../../ui/LoadingState";
import { BlockHistoryTimeline } from "../FieldHistoryControls";
import { WorkLocationFormModal } from "./WorkLocationFormModal";
import { describeWorkLocationPeriod, sortWorkLocations, workLocationStateLabels, workLocationStateTones, type WorkLocationFormMode } from "./workLocationForm";

type Props = {
  employeeId: string;
  canEdit: boolean;
  onLoaded?: (rows: EmployeeWorkLocation[]) => void;
};

/**
 * A6 (ORG_LOCATION_REORGANIZATION.md §3.3): ubicaciones de trabajo con
 * vigencia, asignadas directamente al legajo. Alta, cambio desde una fecha,
 * finalización y corrección son acciones distintas; todas quedan en el
 * historial visible del bloque y en Auditoría.
 */
export function EmployeeWorkLocationsPanel({ employeeId, canEdit, onLoaded }: Props) {
  const [rows, setRows] = useState<EmployeeWorkLocation[]>([]);
  const [catalog, setCatalog] = useState<OrgStructureCatalog | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [form, setForm] = useState<{ mode: WorkLocationFormMode; location?: EmployeeWorkLocation } | null>(null);
  // Callback de notificación al padre: no debe disparar recargas.
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    let mounted = true;
    setStatus("loading");
    Promise.all([employeeWorkLocationApiService.list(employeeId), orgStructureApiService.getCatalog()])
      .then(([items, structure]) => {
        if (!mounted) return;
        setRows(items);
        setCatalog(structure);
        setStatus("success");
        onLoadedRef.current?.(items);
      })
      .catch(() => {
        if (mounted) setStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [employeeId, retry]);

  const saved = (items: EmployeeWorkLocation[]) => {
    setRows(items);
    onLoadedRef.current?.(items);
    setForm(null);
    setShowHistory(true);
    setHistoryVersion((version) => version + 1);
  };

  const sorted = sortWorkLocations(rows);
  const zoneCount = new Set(rows.filter((row) => row.state === "CURRENT").map((row) => row.zone.id)).size;

  return (
    <div className="block-card work-locations-card">
      <div className="block-card-head">
        <div>
          <h3>Ubicaciones de trabajo</h3>
          <p>{status !== "success" ? "Zonas y establecimientos asignados con vigencia." : zoneCount ? `${zoneCount} ${zoneCount === 1 ? "zona vigente" : "zonas vigentes"} · ${rows.length} ${rows.length === 1 ? "registro" : "registros"} en total` : rows.length ? "Sin ubicaciones vigentes hoy." : "Sin ubicaciones cargadas."}</p>
          <small>Cada asignación vincula una zona con establecimientos elegidos de esa zona. Se pueden tener varias zonas a la vez.</small>
        </div>
        <div className="tracked-actions">
          <Button variant="subtle" onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Ocultar historial" : "Ver historial"}</Button>
          {canEdit && catalog ? <Button variant="primary" onClick={() => setForm({ mode: "create" })}>Agregar ubicación</Button> : null}
        </div>
      </div>
      {status === "loading" ? (
        <LoadingState text="Cargando ubicaciones..." />
      ) : status === "error" ? (
        <ErrorState message="No pudimos cargar las ubicaciones de trabajo." onRetry={() => setRetry((value) => value + 1)} size="compact" />
      ) : sorted.length ? (
        <div className="work-location-list">
          {sorted.map((location) => (
            <article className={`work-location-item ${location.state.toLowerCase()}`} key={location.id}>
              <div className="work-location-main">
                <div className="work-location-title">
                  <b>{location.zone.name}</b>
                  <Badge tone={workLocationStateTones[location.state]}>{workLocationStateLabels[location.state]}</Badge>
                </div>
                <span className="work-location-period">{describeWorkLocationPeriod(location)}</span>
                <div className="work-location-establishments" aria-label="Establecimientos">
                  {location.establishments.map((item) => <span key={item.id}>{item.name}</span>)}
                </div>
                <small>Motivo: {location.reason}{location.notes ? ` · ${location.notes}` : ""}</small>
              </div>
              {canEdit && catalog ? (
                <div className="work-location-actions">
                  {location.state !== "ENDED" ? <Button variant="subtle" onClick={() => setForm({ mode: "change", location })}>Cambiar desde…</Button> : null}
                  {location.effectiveTo === null ? <Button variant="subtle" onClick={() => setForm({ mode: "end", location })}>Finalizar</Button> : null}
                  <Button variant="subtle" onClick={() => setForm({ mode: "correct", location })}>Corregir</Button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="Todavía no hay ubicaciones de trabajo asignadas a este legajo." size="compact" />
      )}
      {showHistory ? (
        <BlockHistoryTimeline
          employeeId={employeeId}
          section="DATOS_LABORALES"
          block="UBICACIONES_TRABAJO"
          refreshKey={historyVersion}
          empty="Todavía no hay historial de ubicaciones registrado."
        />
      ) : null}
      {form && catalog ? (
        <WorkLocationFormModal
          mode={form.mode}
          employeeId={employeeId}
          catalog={catalog}
          location={form.location}
          close={() => setForm(null)}
          onSaved={saved}
        />
      ) : null}
    </div>
  );
}
