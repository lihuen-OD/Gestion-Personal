import { Eye, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataTable } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { FilterPanel } from "../ui/FilterPanel";
import { Section } from "../ui/Section";
import type { ShiftGroup } from "../../services/api/shiftGroupApiService";
import { shiftRotationApiService, type ShiftRotation } from "../../services/api/shiftRotationApiService";
import { argentinaDateKey } from "../../utils/argentinaDateKey";
import { compareSortValues } from "../../utils/sort";

const compareText = (left: string, right: string) => compareSortValues(left, right, "asc");
import {
  countLabel,
  ROTATION_STATE_OPTIONS,
  rotationHealth,
  rotationMatchesSearch,
  rotationState,
  rotationVersionStatus,
} from "../../utils/shiftRotation";
import { TOAST_SUCCESS_MS } from "../../utils/toast";
import { RotationFormModal } from "./RotationFormModal";

export const ROTATION_DETAIL_PATH = "/configuracion/turnos/rotaciones";

/**
 * Pestaña "Rotaciones" de Turnos (R4.8A). El listado del backend es completo
 * (sin paginación), así que búsqueda y filtros son locales. Se carga sólo al
 * abrir la pestaña; los grupos llegan del catálogo que ya cargó la pantalla.
 */
export function ShiftRotationsPanel({ canEdit, groups, groupsStatus }: { canEdit: boolean; groups: ShiftGroup[] | null; groupsStatus: "loading" | "success" | "error" }) {
  const navigate = useNavigate();
  const [rotations, setRotations] = useState<ShiftRotation[] | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const todayKey = argentinaDateKey(new Date());
  // Aviso que deja el detalle al eliminar una rotación (navegación con state).
  const location = useLocation() as { state?: { notice?: string } };
  const [notice, setNotice] = useState(location.state?.notice ?? "");

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), TOAST_SUCCESS_MS);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    shiftRotationApiService
      .list()
      .then((items) => {
        if (!alive) return;
        setRotations(items);
        setStatus("success");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [reload]);

  const groupOrder = useMemo(() => new Map((groups ?? []).map((group) => [group.id, group.sortOrder])), [groups]);

  // Opciones del filtro: los grupos que efectivamente tienen rotaciones.
  const groupOptions = useMemo(() => {
    const seen = new Map<string, ShiftRotation["shiftGroup"]>();
    for (const rotation of rotations ?? []) seen.set(rotation.shiftGroup.id, rotation.shiftGroup);
    return [...seen.values()].sort((left, right) => (groupOrder.get(left.id) ?? 9999) - (groupOrder.get(right.id) ?? 9999) || compareText(left.name, right.name));
  }, [rotations, groupOrder]);

  const items = useMemo(() => {
    return (rotations ?? [])
      .filter((rotation) => (!stateFilter || rotationState(rotation).key === stateFilter) && (!groupFilter || rotation.shiftGroup.id === groupFilter) && rotationMatchesSearch(rotation, search))
      .sort((left, right) =>
        (groupOrder.get(left.shiftGroup.id) ?? 9999) - (groupOrder.get(right.shiftGroup.id) ?? 9999)
        || compareText(left.shiftGroup.name, right.shiftGroup.name)
        || compareText(left.code, right.code));
  }, [rotations, stateFilter, groupFilter, search, groupOrder]);

  const filtersActive = Boolean(search.trim() || stateFilter || groupFilter);
  const tableStatus = status === "loading" ? "loading" : status === "error" ? "error" : items.length ? "ready" : "empty";
  const createButton = <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Crear rotación</Button>;
  const subtitle = status === "success"
    ? `${countLabel(items.length, "rotación", "rotaciones")}${filtersActive ? " según filtros aplicados" : ""}.`
    : "Ciclos de turnos por equipos (por ejemplo, semanas A y B) y las personas que los siguen.";

  return (
    <Section title="Rotaciones de turnos" subtitle={subtitle} action={canEdit && status === "success" && rotations?.length ? createButton : undefined}>
      {notice ? <div className="toast" role="status">{notice}</div> : null}
      {status === "success" && !rotations?.length ? null : (
      <FilterPanel title="Filtros" search={{ value: search, onChange: setSearch, placeholder: "Código, nombre o grupo" }}>
        <label>Estado<select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="">Todos</option>{ROTATION_STATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Grupo<select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="">Todos</option>{groupOptions.map((group) => <option key={group.id} value={group.id}>{group.status === "ACTIVO" ? group.name : `${group.name} (inactivo)`}</option>)}</select></label>
      </FilterPanel>
      )}
      {tableStatus === "empty" && !filtersActive ? (
        <EmptyState text="Todavía no hay rotaciones configuradas. Una rotación agrupa a las personas en equipos que alternan turnos y descansos según un ciclo semanal." action={canEdit ? createButton : undefined} />
      ) : (
        <DataTable
          status={tableStatus}
          minWidth={960}
          loadingColumns={8}
          errorMessage="No pudimos cargar las rotaciones."
          onRetry={() => setReload((value) => value + 1)}
          emptyText="Ninguna rotación coincide con los filtros aplicados."
        >
          <table className="rotations-table">
            <thead>
              <tr>
                <th className="col-rotation">Rotación</th>
                <th className="col-group">Grupo</th>
                <th className="col-state">Estado</th>
                <th className="col-health">Diagnóstico</th>
                <th className="col-count">Equipos</th>
                <th className="col-count">Personas</th>
                <th className="col-version">Grilla vigente</th>
                <th className="col-actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((rotation) => {
                const state = rotationState(rotation);
                const health = rotationHealth(rotation.health);
                const version = rotationVersionStatus(rotation.versions, todayKey);
                const activeCrews = rotation.crews.filter((crew) => crew.status === "ACTIVO").length;
                return (
                  <tr key={rotation.id}>
                    <td className="col-rotation">
                      <Link className="rotation-name-link" to={`${ROTATION_DETAIL_PATH}/${rotation.id}`}>
                        <b>{rotation.code}</b>
                        <span>{rotation.name}</span>
                      </Link>
                    </td>
                    <td className="col-group">{rotation.shiftGroup.name}{rotation.shiftGroup.status === "ACTIVO" ? null : <span className="rotation-muted"> (inactivo)</span>}</td>
                    <td className="col-state"><Badge tone={state.tone}>{state.label}</Badge></td>
                    <td className="col-health"><Badge tone={health.tone}>{health.label}</Badge></td>
                    <td className="col-count">{activeCrews}</td>
                    <td className="col-count">{rotation.members.length}</td>
                    <td className="col-version">
                      <span className="rotation-version-label">{version.label}</span>
                      {version.detail ? <span className="rotation-muted">{version.detail}</span> : null}
                    </td>
                    <td className="col-actions">
                      <Link className="table-icon-action" title="Ver detalle" aria-label={`Ver detalle de ${rotation.name}`} to={`${ROTATION_DETAIL_PATH}/${rotation.id}`}>
                        <Eye size={14} /><span>Ver detalle</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      )}
      {creating ? (
        <RotationFormModal
          rotation={null}
          groups={groups}
          groupsUnavailable={groupsStatus === "error"}
          close={() => setCreating(false)}
          onSaved={(saved) => navigate(`${ROTATION_DETAIL_PATH}/${saved.id}`, { state: { created: true } })}
        />
      ) : null}
    </Section>
  );
}
