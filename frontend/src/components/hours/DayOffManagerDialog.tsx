import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { getUserErrorMessage } from "../../services/api/apiClient";
import { employeeDayOffApiService, type DayOffCandidate, type EmployeeDayOffStatus } from "../../services/api/employeeDayOffApiService";
import type { ListMeta } from "../../services/api/listQuery";
import { useDebouncedValue } from "../../utils/useDebouncedValue";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";
import { Modal } from "../ui/Modal";
import { Pagination } from "../ui/Pagination";
import { SearchInput } from "../ui/SearchInput";
import { TableShell } from "../ui/TableShell";

const PAGE_SIZE = 50;
const emptyMeta: ListMeta = { total: 0, page: 1, pageSize: PAGE_SIZE, hasMore: false };

function formatDateLabel(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

const personLabel = (candidate: DayOffCandidate) => `${candidate.employee.lastName}, ${candidate.employee.firstName}`;
const hasActiveDayOff = (candidate: DayOffCandidate) => candidate.dayOff?.status === "ACTIVO";

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * "Gestionar francos" (docs/decisions/EMPLOYEE_DAY_OFF.md §15): fecha →
 * personas del alcance → selección múltiple → asignar / cancelar. Cada acción
 * guarda en el acto con el mismo servicio (PUT /employee-day-offs); reactivar
 * un franco cancelado es asignarlo de nuevo. El backend decide alcance,
 * período cerrado y conflicto con convocatorias: acá sólo se anticipa en la UI.
 */
export function DayOffManagerDialog({
  initialDate,
  initialSearch = "",
  initialSelectedEmployeeId,
  canCorrectClosedPeriods,
  close,
  onSaved,
}: {
  initialDate: string;
  initialSearch?: string;
  initialSelectedEmployeeId?: string;
  // Sólo RRHH corrige un período enviado/aprobado, con motivo.
  canCorrectClosedPeriods: boolean;
  close: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [search, setSearch] = useState(initialSearch);
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<DayOffCandidate[]>([]);
  const [meta, setMeta] = useState<ListMeta>(emptyMeta);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [reloadToken, setReloadToken] = useState(0);
  // Seleccionados con su última foto conocida (pueden estar en otra página).
  const [selected, setSelected] = useState<Map<string, DayOffCandidate>>(new Map());
  const [notes, setNotes] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [saving, setSaving] = useState<EmployeeDayOffStatus | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // La preselección desde una celda vale sólo para la primera carga: después
  // de guardar, la recarga no vuelve a marcar a nadie.
  const pendingPreselect = useRef(initialSelectedEmployeeId);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    // Refresco sin blanquear: la tabla sigue visible mientras llega la respuesta.
    if (!items.length) setLoadState("loading");
    employeeDayOffApiService
      .getByDate({ date, search: debouncedSearch, page, take: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setMeta(result.meta);
        setLoadState("ready");
        // Preselección desde una celda: la persona que se estaba mirando.
        if (pendingPreselect.current) {
          const preselected = result.items.find((item) => item.employee.id === pendingPreselect.current);
          pendingPreselect.current = undefined;
          if (preselected) setSelected(new Map([[preselected.employee.id, preselected]]));
        }
        // La foto de los seleccionados se actualiza con lo que llegó.
        setSelected((current) => {
          if (!current.size) return current;
          const next = new Map(current);
          for (const item of result.items) if (next.has(item.employee.id)) next.set(item.employee.id, item);
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
    // `items` sólo decide si mostrar el skeleton inicial: no es dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, debouncedSearch, page, reloadToken]);

  const selectedList = useMemo(() => [...selected.values()], [selected]);
  const toAssign = selectedList.filter((item) => !hasActiveDayOff(item) && !item.holidayWork);
  const toCancel = selectedList.filter(hasActiveDayOff);
  const blockedByPeriod = (item: DayOffCandidate) => item.periodLocked && !canCorrectClosedPeriods;
  const selectable = (item: DayOffCandidate) => !blockedByPeriod(item) && !(item.holidayWork && !hasActiveDayOff(item));
  const visibleSelectable = items.filter(selectable);
  const allVisibleSelected = visibleSelectable.length > 0 && visibleSelectable.every((item) => selected.has(item.employee.id));

  const changeDate = (value: string) => {
    setDate(value);
    setPage(1);
    // La selección es de una fecha: al cambiarla se empieza de cero.
    setSelected(new Map());
    setError("");
    setNotice("");
  };

  const toggle = (item: DayOffCandidate) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(item.employee.id)) next.delete(item.employee.id);
      else next.set(item.employee.id, item);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((current) => {
      const next = new Map(current);
      for (const item of visibleSelectable) {
        if (allVisibleSelected) next.delete(item.employee.id);
        else next.set(item.employee.id, item);
      }
      return next;
    });
  };

  const apply = async (status: EmployeeDayOffStatus) => {
    const targets = status === "ACTIVO" ? toAssign : toCancel;
    if (!targets.length || saving) return;
    const needsReason = targets.some((item) => item.periodLocked);
    if (needsReason && correctionReason.trim().length < 3) {
      setError("Indicá el motivo de la corrección: hay personas con el período ya enviado a cierre.");
      return;
    }
    setSaving(status);
    setError("");
    setNotice("");
    try {
      const result = await employeeDayOffApiService.save({
        date,
        correctionReason: needsReason ? correctionReason.trim() : null,
        employees: targets.map((item) => ({ employeeId: item.employee.id, status, ...(status === "ACTIVO" ? { notes: notes.trim() || null } : {}) })),
      });
      const changed = result.summary.changed;
      const base = status === "ACTIVO"
        ? `Franco asignado a ${plural(changed, "persona", "personas")} para el ${formatDateLabel(date)}.`
        : `Franco cancelado para ${plural(changed, "persona", "personas")} el ${formatDateLabel(date)}.`;
      const alerts = result.summary.activityAlerts > 0
        ? ` ${plural(result.summary.activityAlerts, "jornada ya registrada quedó", "jornadas ya registradas quedaron")} para revisión: sus horas no computan hasta que se reconozcan.`
        : "";
      setNotice(`${base}${alerts}`);
      setSelected(new Map());
      setNotes("");
      setCorrectionReason("");
      setReloadToken((value) => value + 1);
      onSaved();
    } catch (saveError) {
      setError(getUserErrorMessage(saveError, "No pudimos guardar los francos. Intentá nuevamente."));
    } finally {
      setSaving(null);
    }
  };

  const reasonRequired = [...toAssign, ...toCancel].some((item) => item.periodLocked);

  return (
    <Modal
      title="Gestionar francos"
      subtitle="Un franco indica que la persona no debía trabajar esa fecha: no genera falta de ingreso y sus horas del fichador no computan hasta que alguien las reconozca."
      close={close}
      closeDisabled={Boolean(saving)}
    >
      <div className="day-off-manager">
        <div className="day-off-toolbar">
          <label className="field">
            <span>Fecha</span>
            <input type="date" value={date} onChange={(event) => changeDate(event.target.value)} required />
          </label>
          <div className="field day-off-search">
            <span>Personas</span>
            <SearchInput
              placeholder="Buscar por legajo, apellido o nombre"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              aria-label="Buscar persona"
            />
          </div>
        </div>

        {loadState === "loading" && !items.length ? (
          <LoadingState variant="table" rows={5} columns={5} text="Cargando personas..." />
        ) : loadState === "error" ? (
          <ErrorState size="compact" message="No pudimos cargar las personas de esa fecha." onRetry={() => setReloadToken((value) => value + 1)} />
        ) : !items.length ? (
          <EmptyState size="compact" text={debouncedSearch ? "Nadie de tu alcance coincide con la búsqueda." : "No hay personas activas en tu alcance."} />
        ) : (
          <TableShell className="day-off-table-shell" minWidth={640}>
            <table className="day-off-table">
              <thead>
                <tr>
                  <th className="day-off-check">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={!visibleSelectable.length} aria-label="Seleccionar todas las personas visibles" />
                  </th>
                  <th>Legajo</th>
                  <th>Persona</th>
                  <th>Franco del {formatDateLabel(date)}</th>
                  <th>Observación</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const checked = selected.has(item.employee.id);
                  const disabledReason = blockedByPeriod(item)
                    ? "El período ya fue enviado a cierre: sólo RRHH puede corregirlo."
                    : item.holidayWork && !hasActiveDayOff(item)
                      ? "Está convocado a trabajar el feriado de esa fecha: cancelá la convocatoria antes de asignar franco."
                      : undefined;
                  return (
                    <tr key={item.employee.id} className={checked ? "is-selected" : undefined}>
                      <td className="day-off-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={Boolean(disabledReason)}
                          title={disabledReason}
                          onChange={() => toggle(item)}
                          aria-label={`Seleccionar a ${personLabel(item)}`}
                        />
                      </td>
                      <td><b>{item.employee.legajo}</b></td>
                      <td>{personLabel(item)}</td>
                      <td>
                        <span className="day-off-status">
                          {hasActiveDayOff(item) ? <Badge tone="info">Franco</Badge> : item.dayOff ? <Badge tone="neutral">Franco cancelado</Badge> : <span className="day-off-muted">Sin franco</span>}
                          {item.holidayWork ? <Badge tone="warning">Convocado al feriado</Badge> : null}
                          {item.periodLocked ? <Badge tone="neutral">Período cerrado</Badge> : null}
                        </span>
                      </td>
                      <td className="day-off-notes">{item.dayOff?.notes || <span className="day-off-muted">Sin observación</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        )}

        {meta.total > PAGE_SIZE ? <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="personas" /> : null}

        <div className="day-off-inputs">
          <label className="field">
            <span>Observación del franco (opcional)</span>
            <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Ej.: franco compensatorio acordado con el encargado" />
          </label>
          {reasonRequired ? (
            <label className="field">
              <span>Motivo de la corrección *</span>
              <textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} maxLength={500} rows={2} placeholder="Queda registrado en auditoría: el período ya fue enviado a cierre." />
            </label>
          ) : null}
        </div>

        {error ? <div className="rule-form-alert-error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div> : null}
        {notice ? <div className="info-note" role="status">{notice}</div> : null}

        <div className="form-actions day-off-actions">
          <span className="day-off-selection">
            {selected.size ? `${plural(selected.size, "persona seleccionada", "personas seleccionadas")}` : "Seleccioná una o más personas"}
            {selected.size ? <Button type="button" variant="ghost" onClick={() => setSelected(new Map())}>Limpiar</Button> : null}
          </span>
          <Button variant="subtle" onClick={() => void apply("CANCELADO")} disabled={!toCancel.length || Boolean(saving)} loading={saving === "CANCELADO"}>
            {saving === "CANCELADO" ? "Cancelando..." : `Cancelar franco${toCancel.length ? ` (${toCancel.length})` : ""}`}
          </Button>
          <Button variant="primary" onClick={() => void apply("ACTIVO")} disabled={!toAssign.length || Boolean(saving)} loading={saving === "ACTIVO"}>
            {saving === "ACTIVO" ? "Guardando..." : `Asignar franco${toAssign.length ? ` (${toAssign.length})` : ""}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
