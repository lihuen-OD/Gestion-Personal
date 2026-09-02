import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Eye } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { FilterPanel } from "../components/ui/FilterPanel";
import { Section } from "../components/ui/Section";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { TableShell } from "../components/ui/TableShell";
import { shiftAlertApiService, type ShiftAlert, type ShiftAlertSeverity, type ShiftAlertStatus, type ShiftAlertType } from "../services/api/shiftAlertApiService";
import { useDebouncedValue } from "../utils/useDebouncedValue";

const TYPE_LABELS: Record<ShiftAlertType, string> = {
  INGRESO_TARDE: "Llegada tarde",
  INGRESO_ANTICIPADO: "Ingreso anticipado",
  SALIDA_ANTICIPADA: "Salida anticipada",
  SALIDA_TARDIA: "Salida tardía",
  TURNO_NO_IDENTIFICADO: "Sin turno compatible",
  SHIFT_NOT_ENABLED_FOR_EMPLOYEE: "Turno no habilitado",
  // Etapa 13E: mismo criterio que el label backend -- pide revisar, no
  // afirma un diagnóstico de configuración que sólo es una hipótesis.
  // Etapa 13E.1: el backend ya no genera alertas nuevas de este tipo (ver
  // docs/decisions/SHIFT_CONFIGURATION_ALERT_POLICY_13E.md) -- este label
  // queda sólo para alertas ya persistidas antes de esa etapa.
  POSSIBLE_SHIFT_CONFIGURATION_MISSING: "Revisar configuración de turno",
  JORNADA_INSUFICIENTE: "Jornada por debajo del mínimo",
  JORNADA_EXTENDIDA: "Jornada extendida",
  DESCANSO_INSUFICIENTE: "Descanso insuficiente",
  POSIBLE_OLVIDO_SALIDA: "Posible olvido de salida",
  CONCEPTO_NO_HABILITADO: "Concepto no habilitado",
  SEGMENTO_SIN_CLASIFICAR: "Segmento sin clasificar",
};

const SEVERITY_TONE: Record<ShiftAlertSeverity, "neutral" | "warning" | "danger"> = {
  INFO: "neutral",
  ADVERTENCIA: "warning",
  CRITICA: "danger",
};

const SEVERITY_LABELS: Record<ShiftAlertSeverity, string> = {
  INFO: "Informativa",
  ADVERTENCIA: "Advertencia",
  CRITICA: "Crítica",
};

const STATUS_TONE: Record<ShiftAlertStatus, "warning" | "success" | "neutral"> = {
  PENDIENTE: "warning",
  RESUELTA: "success",
  DESCARTADA: "neutral",
};

const STATUS_LABELS: Record<ShiftAlertStatus, string> = {
  PENDIENTE: "Pendiente",
  RESUELTA: "Resuelta",
  DESCARTADA: "Descartada",
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function differenceLabel(alert: ShiftAlert) {
  if (alert.differenceMinutes === null || alert.differenceMinutes === undefined) return "-";
  const abs = Math.abs(alert.differenceMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const label = hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  return alert.differenceMinutes >= 0 ? `+${label}` : `-${label}`;
}

// Etapa 13H (docs/decisions/SHIFT_ALERTS_GROUPED_VIEW_13H.md): prioridad
// combinada para elegir la alerta "principal" de un grupo (mismo WorkShift).
// Reutiliza, en orden, la prioridad de salida ya definida en la Etapa 13G
// (Notificaciones) y la prioridad de entrada propuesta para esta etapa — más
// 2 tipos que ninguna de las dos listas cubría:
// - POSIBLE_OLVIDO_SALIDA va primero: es la señal más urgente en la
//   práctica (jornada posiblemente sin cerrar, puede afectar la
//   confiabilidad del resto del grupo), y puede llegar a severidad CRITICA
//   (régimen ALERT_ONLY) — no estaba en ninguna de las 2 listas del pedido.
// - DESCANSO_INSUFICIENTE y POSSIBLE_SHIFT_CONFIGURATION_MISSING (legacy,
//   Etapa 13E.1 — ya no se genera) van al final: ninguna lista los ordenaba
//   explícitamente y ninguno es, en la práctica, la alerta más relevante de
//   un grupo real.
const GROUP_MAIN_ALERT_PRIORITY: ShiftAlertType[] = [
  "POSIBLE_OLVIDO_SALIDA",
  "CONCEPTO_NO_HABILITADO",
  "JORNADA_EXTENDIDA",
  "SALIDA_TARDIA",
  "SALIDA_ANTICIPADA",
  "JORNADA_INSUFICIENTE",
  "SEGMENTO_SIN_CLASIFICAR",
  "TURNO_NO_IDENTIFICADO",
  "SHIFT_NOT_ENABLED_FOR_EMPLOYEE",
  "INGRESO_TARDE",
  "INGRESO_ANTICIPADO",
  "DESCANSO_INSUFICIENTE",
  "POSSIBLE_SHIFT_CONFIGURATION_MISSING",
];
const alertPriorityRank = new Map(GROUP_MAIN_ALERT_PRIORITY.map((type, index) => [type, index]));

type AlertGroup = {
  workShiftId: string;
  mainAlert: ShiftAlert;
  secondaryAlerts: ShiftAlert[];
  status: ShiftAlertStatus;
};

// Etapa 13H, Parte 5: el grupo queda Pendiente si CUALQUIER alerta interna
// está pendiente (no ocultar que falta revisión); si ninguna lo está, queda
// Resuelto en cuanto haya al menos una RESUELTA (se avanzó algo real);
// Descartado sólo si TODAS las alertas del grupo se descartaron.
function computeGroupStatus(members: ShiftAlert[]): ShiftAlertStatus {
  if (members.some((alert) => alert.status === "PENDIENTE")) return "PENDIENTE";
  if (members.some((alert) => alert.status === "RESUELTA")) return "RESUELTA";
  return "DESCARTADA";
}

// Etapa 13H, Parte 2: agrupa por workShiftId -- el identificador más
// confiable disponible (siempre presente, campo obligatorio en ShiftAlert;
// ver docs/decisions/SHIFT_ALERTS_GROUPED_VIEW_13H.md §4). No hizo falta
// implementar ningún fallback más débil (attendancePunchId no existe como
// campo propio de ShiftAlert; employeeId+fecha nunca se necesitó). Preserva
// el orden de llegada (la lista ya viene ordenada por createdAt desc desde
// el backend) usando la posición del primer miembro visto de cada grupo.
function groupAlerts(alerts: ShiftAlert[]): AlertGroup[] {
  const order: string[] = [];
  const membersByWorkShift = new Map<string, ShiftAlert[]>();
  for (const alert of alerts) {
    const existing = membersByWorkShift.get(alert.workShiftId);
    if (existing) {
      existing.push(alert);
    } else {
      membersByWorkShift.set(alert.workShiftId, [alert]);
      order.push(alert.workShiftId);
    }
  }
  return order.map((workShiftId) => {
    const members = [...membersByWorkShift.get(workShiftId)!].sort(
      (a, b) => (alertPriorityRank.get(a.type) ?? Number.MAX_SAFE_INTEGER) - (alertPriorityRank.get(b.type) ?? Number.MAX_SAFE_INTEGER),
    );
    const [mainAlert, ...secondaryAlerts] = members;
    return { workShiftId, mainAlert: mainAlert!, secondaryAlerts, status: computeGroupStatus(members) };
  });
}

export function ShiftAlertsPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [type, setType] = useState<ShiftAlertType | "">("");
  const [severity, setSeverity] = useState<ShiftAlertSeverity | "">("");
  const [status, setStatus] = useState<ShiftAlertStatus | "ALL">("PENDIENTE");
  const [alerts, setAlerts] = useState<ShiftAlert[]>([]);
  const [meta, setMeta] = useState({ total: 0, hasMore: false, nextBefore: null as string | null });
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [resolveTarget, setResolveTarget] = useState<ShiftAlert | undefined>(undefined);
  const [resolution, setResolution] = useState<"RESUELTA" | "DESCARTADA">("RESUELTA");
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  // Etapa 13H: qué grupos (por workShiftId) están expandidos mostrando sus
  // hallazgos secundarios -- colapsado por default, para no repetir el ruido
  // de filas sueltas que esta etapa vino a resolver.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupAlerts(alerts), [alerts]);

  const toggleGroup = (workShiftId: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(workShiftId)) next.delete(workShiftId);
      else next.add(workShiftId);
      return next;
    });
  };

  useEffect(() => {
    let alive = true;
    setLoadStatus("loading");
    shiftAlertApiService
      .getAll({ search: debouncedSearch, type: type || undefined, severity: severity || undefined, status, take: 20 })
      .then((response) => {
        if (!alive) return;
        setAlerts(response.data);
        setMeta({ total: response.meta.total, hasMore: response.meta.hasMore, nextBefore: response.meta.nextBefore });
        setLoadStatus("success");
      })
      .catch(() => {
        if (alive) setLoadStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [debouncedSearch, type, severity, status, refresh]);

  const loadMore = async () => {
    if (!meta.nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await shiftAlertApiService.getAll({ search: debouncedSearch, type: type || undefined, severity: severity || undefined, status, before: meta.nextBefore, take: 20 });
      setAlerts((current) => [...current, ...response.data]);
      setMeta({ total: response.meta.total, hasMore: response.meta.hasMore, nextBefore: response.meta.nextBefore });
    } catch {
      setActionError("No pudimos cargar más alertas.");
    } finally {
      setLoadingMore(false);
    }
  };

  const openResolve = (alert: ShiftAlert) => {
    setResolveTarget(alert);
    setResolution("RESUELTA");
    setReason("");
    setActionError("");
  };

  const confirmResolve = async () => {
    if (!resolveTarget || !reason.trim()) return;
    setIsResolving(true);
    setActionError("");
    try {
      await shiftAlertApiService.resolve(resolveTarget.id, resolution, reason.trim());
      setResolveTarget(undefined);
      setReason("");
      setRefresh((value) => value + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No pudimos resolver la alerta.");
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="GESTIÓN HORARIA" title="Alertas de turnos" description="Fichadas que requieren revisión: tardanzas, salidas fuera de margen y turnos que no coinciden con lo habilitado." />
      <Section
        title="Alertas"
        subtitle={
          groups.length !== meta.total
            ? `${groups.length} grupo(s) de alertas (${meta.total} alerta(s) individuales) según filtros aplicados.`
            : `${meta.total} alerta(s) según filtros aplicados.`
        }
      >
        <FilterPanel
          title="Filtros"
          search={{ value: search, onChange: setSearch, placeholder: "Nombre, legajo o DNI" }}
          onClear={() => { setSearch(""); setType(""); setSeverity(""); setStatus("PENDIENTE"); }}
        >
          <label>Tipo<select value={type} onChange={(e) => setType(e.target.value as ShiftAlertType | "")}><option value="">Todos</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Severidad<select value={severity} onChange={(e) => setSeverity(e.target.value as ShiftAlertSeverity | "")}><option value="">Todas</option>{Object.entries(SEVERITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Estado<select value={status} onChange={(e) => setStatus(e.target.value as ShiftAlertStatus | "ALL")}><option value="PENDIENTE">Pendientes</option><option value="RESUELTA">Resueltas</option><option value="DESCARTADA">Descartadas</option><option value="ALL">Todas</option></select></label>
        </FilterPanel>

        {actionError ? <div className="form-error">{actionError}</div> : null}

        {loadStatus === "loading" ? (
          <LoadingState variant="table" rows={5} columns={8} />
        ) : loadStatus === "error" ? (
          <ErrorState message="No pudimos cargar las alertas." onRetry={() => setRefresh((value) => value + 1)} />
        ) : !alerts.length ? (
          <EmptyState text="No hay alertas para los filtros seleccionados." icon={AlertTriangle} />
        ) : (
          <>
            <TableShell minWidth={1200}>
              <table>
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Tipo</th>
                    <th>Severidad</th>
                    <th>Turno</th>
                    <th>Diferencia</th>
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => {
                    const alert = group.mainAlert;
                    const expanded = expandedGroups.has(group.workShiftId);
                    return (
                      <Fragment key={group.workShiftId}>
                        <tr>
                          <td><b>{alert.employee.lastName}, {alert.employee.firstName}</b><span className="table-sub">Legajo {alert.employee.legajo}</span></td>
                          <td>
                            <div className="shift-alert-type-cell">
                              <span>{TYPE_LABELS[alert.type]}</span>
                              {group.secondaryAlerts.length > 0 ? (
                                <button
                                  type="button"
                                  className="shift-alert-toggle"
                                  onClick={() => toggleGroup(group.workShiftId)}
                                  aria-expanded={expanded}
                                >
                                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                  <span>
                                    {expanded ? "Ocultar" : "+"}{group.secondaryAlerts.length} hallazgo{group.secondaryAlerts.length > 1 ? "s" : ""} asociado{group.secondaryAlerts.length > 1 ? "s" : ""}
                                  </span>
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td><Badge tone={SEVERITY_TONE[alert.severity]}>{SEVERITY_LABELS[alert.severity]}</Badge></td>
                          <td>{alert.workShift.shiftTemplate ? `${alert.workShift.shiftTemplate.code} · ${alert.workShift.shiftTemplate.name}` : <em>Sin turno</em>}</td>
                          <td>{differenceLabel(alert)}</td>
                          <td>{formatDateTime(alert.actualAt)}</td>
                          <td><Badge tone={STATUS_TONE[group.status]}>{STATUS_LABELS[group.status]}</Badge></td>
                          <td>
                            <div className="table-actions">
                              <Link className="table-icon-action" title="Ver legajo" aria-label={`Ver legajo de ${alert.employee.firstName} ${alert.employee.lastName}`} to={`/legajos/${alert.employeeId}`}><Eye size={14} /><span>Ver legajo</span></Link>
                              {alert.workShift.shiftTemplate ? <Link className="table-icon-action" title="Ver turno" aria-label="Ver turno" to={`/configuracion/turnos/${alert.workShift.shiftTemplate.id}`}><Eye size={14} /><span>Ver turno</span></Link> : null}
                              {alert.status === "PENDIENTE" ? <button type="button" className="table-icon-action" title="Resolver alerta" aria-label="Resolver alerta" onClick={() => openResolve(alert)}><CheckCircle2 size={14} /><span>Resolver</span></button> : null}
                            </div>
                          </td>
                        </tr>
                        {expanded && group.secondaryAlerts.length > 0 ? (
                          <tr className="shift-alert-group-detail-row">
                            <td colSpan={8}>
                              <div className="shift-alert-group-detail">
                                <p>También se detectó en esta misma jornada</p>
                                <ul>
                                  {group.secondaryAlerts.map((secondary) => (
                                    <li key={secondary.id}>
                                      <span>{TYPE_LABELS[secondary.type]}</span>
                                      <Badge tone={SEVERITY_TONE[secondary.severity]}>{SEVERITY_LABELS[secondary.severity]}</Badge>
                                      <span>{differenceLabel(secondary)}</span>
                                      <Badge tone={STATUS_TONE[secondary.status]}>{STATUS_LABELS[secondary.status]}</Badge>
                                      {secondary.status === "PENDIENTE" ? (
                                        <button type="button" className="table-link" onClick={() => openResolve(secondary)}>Resolver</button>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
            {meta.hasMore ? <div className="attendance-load-more"><Button variant="subtle" onClick={loadMore} loading={loadingMore}>Cargar 20 más</Button></div> : null}
          </>
        )}
      </Section>

      {resolveTarget ? (
        <Modal title="Resolver alerta de turno" close={() => setResolveTarget(undefined)}>
          <div className="form-stack">
            <div className="info-note compact">
              <b>{TYPE_LABELS[resolveTarget.type]}</b>
              <p>{resolveTarget.employee.lastName}, {resolveTarget.employee.firstName} · Legajo {resolveTarget.employee.legajo}</p>
            </div>
            <label className="field">
              <span>Resolución</span>
              <select value={resolution} onChange={(e) => setResolution(e.target.value as "RESUELTA" | "DESCARTADA")}>
                <option value="RESUELTA">Confirmar como resuelta</option>
                <option value="DESCARTADA">Descartar (no requiere acción)</option>
              </select>
            </label>
            <label>
              Observación
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: se habilitó el turno correcto para el empleado" />
            </label>
            {actionError ? <p className="error">{actionError}</p> : null}
            <div className="form-actions">
              <Button variant="subtle" onClick={() => setResolveTarget(undefined)}>Cancelar</Button>
              <Button onClick={confirmResolve} loading={isResolving} disabled={!reason.trim()}>Confirmar</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
