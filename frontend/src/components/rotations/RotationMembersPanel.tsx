import { ArrowRightLeft, CalendarX2, Plus, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataTable } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { FilterPanel } from "../ui/FilterPanel";
import { Section } from "../ui/Section";
import { Tabs } from "../ui/Tabs";
import { shiftRotationApiService, type ShiftRotation, type ShiftRotationMember, type ShiftRotationWithoutFixedShift } from "../../services/api/shiftRotationApiService";
import { confirmAction } from "../../services/appDialog";
import { argentinaDateKey } from "../../utils/argentinaDateKey";
import { formatCalendarDate } from "../../utils/date";
import { countLabel } from "../../utils/shiftRotation";
import { canCancelMembership, closeRange, describeMemberError, memberMatchesSearch, membershipRangeText, membershipState, membershipTimeline, moveRange, sortMembers } from "../../utils/shiftRotationMembers";
import { TOAST_SUCCESS_MS } from "../../utils/toast";
import { RotationAddMembersModal } from "./RotationAddMembersModal";
import { RotationMemberDateModal, type MemberDateAction } from "./RotationMemberDateModal";

type Scope = "current" | "history";

/**
 * Personas de la rotación (R4.8C). Lectura para todos los roles; alta,
 * baja, cambio de equipo y cancelación de altas futuras sólo RRHH. La lista
 * se pide al backend (vigentes y futuras, o el historial completo) y se
 * ordena por persona y período; el historial nunca se edita.
 */
export function RotationMembersPanel({ rotation, canEdit, onChanged }: { rotation: ShiftRotation; canEdit: boolean; onChanged: () => void }) {
  const todayKey = argentinaDateKey(new Date());
  const [scope, setScope] = useState<Scope>("current");
  const [members, setMembers] = useState<ShiftRotationMember[] | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [crewFilter, setCrewFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [dateAction, setDateAction] = useState<{ action: MemberDateAction; member: ShiftRotationMember } | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [withoutFixed, setWithoutFixed] = useState<ShiftRotationWithoutFixedShift[]>([]);

  useEffect(() => {
    let alive = true;
    if (!members) setStatus("loading");
    shiftRotationApiService
      .members(rotation.id, scope === "history")
      .then((data) => {
        if (!alive) return;
        setMembers(data);
        setStatus("success");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [rotation.id, scope, reload]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), TOAST_SUCCESS_MS);
    return () => clearTimeout(timeout);
  }, [notice]);

  const crews = useMemo(() => [...rotation.crews].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)), [rotation.crews]);
  const items = useMemo(() => sortMembers((members ?? []).filter((member) => (!crewFilter || member.crewId === crewFilter) && memberMatchesSearch(member, search))), [members, crewFilter, search]);
  const filtersActive = Boolean(search.trim() || crewFilter);
  const canAdd = canEdit && crews.some((crew) => crew.status === "ACTIVO");

  const done = (message: string) => {
    setActionError("");
    setNotice(message);
    setReload((value) => value + 1);
    onChanged();
  };

  const cancel = async (member: ShiftRotationMember) => {
    const ok = await confirmAction(`¿Querés cancelar el alta de ${member.employee} en ${member.crew} (${membershipRangeText(member)})? Todavía no rigió, así que se elimina sin dejar un período en el historial.`, { title: "Cancelar alta", confirmLabel: "Cancelar alta", cancelLabel: "Volver", tone: "danger" });
    if (!ok) return;
    try {
      await shiftRotationApiService.cancelMember(rotation.id, member.id);
      setWithoutFixed([]);
      done("Alta cancelada.");
    } catch (reason) {
      setActionError(describeMemberError(reason, "No pudimos cancelar el alta.").message);
    }
  };

  const addButton = <Button variant="primary" onClick={() => setAdding(true)}><Plus size={16} /> Incorporar personas</Button>;
  const subtitle = status === "success"
    ? `${countLabel(items.length, scope === "history" ? "período" : "persona", scope === "history" ? "períodos" : "personas")}${filtersActive ? " según filtros aplicados" : ""}.`
    : "Quiénes siguen la rotación, en qué equipo y desde cuándo.";
  const tableStatus = status === "loading" ? "loading" : status === "error" ? "error" : items.length ? "ready" : "empty";

  return (
    <Section title="Personas" subtitle={subtitle} action={canAdd && status === "success" && members?.length ? addButton : undefined}>
      {notice ? <div className="toast" role="status">{notice}</div> : null}
      {actionError ? <p className="error rotation-section-error" role="alert">{actionError}</p> : null}
      {withoutFixed.length ? (
        <div className="info-note warning rotation-without-fixed" role="status">
          <p><b>Sin turno asignado después de la baja.</b> Estas personas no tienen turno fijo ni otra rotación desde la fecha indicada:</p>
          <ul>{withoutFixed.map((entry) => <li key={entry.employeeId}>{entry.employee}: desde el {formatCalendarDate(entry.from)}</li>)}</ul>
          <Button variant="subtle" onClick={() => setWithoutFixed([])}>Entendido</Button>
        </div>
      ) : null}
      <div className="rotation-members-toolbar">
        <Tabs
          className="view-switch"
          ariaLabel="Períodos a mostrar"
          tabs={[{ key: "current", label: "Vigentes y futuras" }, { key: "history", label: "Historial completo" }]}
          active={scope}
          onChange={(key) => setScope(key === "history" ? "history" : "current")}
        />
      </div>
      {status === "success" && !members?.length && !filtersActive ? (
        <EmptyState
          text={scope === "history" ? "Nadie perteneció a esta rotación todavía." : "No hay personas vigentes ni con inicio futuro en esta rotación."}
          action={canAdd && scope === "current" ? addButton : undefined}
        />
      ) : (
        <>
          <FilterPanel title="Filtros" search={{ value: search, onChange: setSearch, placeholder: "Nombre o legajo" }}>
            <label>Equipo<select value={crewFilter} onChange={(event) => setCrewFilter(event.target.value)}><option value="">Todos</option>{crews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name} (equipo {crew.code})</option>)}</select></label>
          </FilterPanel>
          <DataTable status={tableStatus} minWidth={canEdit ? 980 : 820} loadingColumns={7} errorMessage="No pudimos cargar las personas de la rotación." onRetry={() => setReload((value) => value + 1)} emptyText="Ninguna persona coincide con los filtros aplicados.">
            <table className="rotation-members-table">
              <thead>
                <tr>
                  <th className="col-legajo">Legajo</th>
                  <th>Persona</th>
                  <th className="col-crew">Equipo</th>
                  <th className="col-date">Desde</th>
                  <th className="col-date">Hasta</th>
                  <th className="col-state">Estado</th>
                  {canEdit ? <th className="col-actions">Acciones</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((member) => {
                  const state = membershipState(member, todayKey);
                  // Historial inmutable: un período terminado no ofrece ninguna acción.
                  const ended = membershipTimeline(member, todayKey) === "ENDED";
                  const closable = !ended && closeRange(member, todayKey) !== null;
                  const movable = !ended && moveRange(member, todayKey) !== null && crews.some((crew) => crew.status === "ACTIVO" && crew.id !== member.crewId);
                  const cancellable = !ended && canCancelMembership(member, rotation.status, todayKey);
                  return (
                    <tr key={member.id}>
                      <td className="col-legajo">{member.legajo}</td>
                      <td>
                        <span className="rotation-member-name">{member.employee.replace(/ · Legajo .*$/, "")}</span>
                        {member.employeeStatus !== "ACTIVO" ? <Badge tone="warning">Persona inactiva</Badge> : null}
                      </td>
                      <td className="col-crew">{member.crew}</td>
                      <td className="col-date">{formatCalendarDate(member.effectiveFrom)}</td>
                      <td className="col-date">{member.effectiveTo ? formatCalendarDate(member.effectiveTo) : <span className="rotation-muted">Sin fecha de fin</span>}</td>
                      <td className="col-state"><Badge tone={state.tone}>{state.label}</Badge></td>
                      {canEdit ? (
                        <td className="col-actions">
                          <div className="table-actions">
                            {movable ? (
                              <button type="button" className="table-icon-action" title="Cambiar de equipo" aria-label={`Cambiar de equipo a ${member.employee}`} onClick={() => setDateAction({ action: "move", member })}>
                                <ArrowRightLeft size={14} /><span>Cambiar de equipo</span>
                              </button>
                            ) : null}
                            {closable && !cancellable ? (
                              <button type="button" className="table-icon-action danger-link" title="Dar de baja" aria-label={`Dar de baja a ${member.employee}`} onClick={() => setDateAction({ action: "close", member })}>
                                <CalendarX2 size={14} /><span>Dar de baja</span>
                              </button>
                            ) : null}
                            {cancellable ? (
                              <button type="button" className="table-icon-action danger-link" title="Cancelar alta" aria-label={`Cancelar el alta de ${member.employee}`} onClick={() => void cancel(member)}>
                                <Undo2 size={14} /><span>Cancelar alta</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataTable>
        </>
      )}
      {adding ? (
        <RotationAddMembersModal
          rotation={rotation}
          todayKey={todayKey}
          close={() => setAdding(false)}
          onAdded={({ added, closedFixedAssignments }) => {
            setAdding(false);
            setWithoutFixed([]);
            done(`${countLabel(added, "persona incorporada", "personas incorporadas")}${closedFixedAssignments ? ` · ${countLabel(closedFixedAssignments, "turno fijo cerrado", "turnos fijos cerrados")}` : ""}.`);
          }}
        />
      ) : null}
      {dateAction ? (
        <RotationMemberDateModal
          action={dateAction.action}
          member={dateAction.member}
          rotation={rotation}
          todayKey={todayKey}
          close={() => setDateAction(null)}
          onDone={({ message, withoutFixedShift }) => {
            setDateAction(null);
            setWithoutFixed(withoutFixedShift);
            done(message);
          }}
        />
      ) : null}
    </Section>
  );
}
