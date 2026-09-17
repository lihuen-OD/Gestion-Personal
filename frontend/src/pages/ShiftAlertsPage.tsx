import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { shiftAlertApiService, type ShiftAlert, type ShiftAlertSeverity, type ShiftAlertStatus, type ShiftAlertType } from "../services/api/shiftAlertApiService";
import { useDebouncedValue } from "../utils/useDebouncedValue";

// Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md, ajuste final):
// esta página ya NO ofrece "Crear novedad" -- el flujo principal para
// justificar una anomalía del fichador con una novedad es Notificaciones
// (NotificationsPage), con AttendancePage → "Problemas de fichada" como
// acceso complementario. ShiftAlertsPage queda como consulta/análisis
// técnico de alertas de turno solamente.
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
  JORNADA_FUERA_DE_TURNO: "Jornada fuera de turno",
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

const LEGACY_ALERT_TYPES = new Set<ShiftAlertType>([
  "SEGMENTO_SIN_CLASIFICAR", "CONCEPTO_NO_HABILITADO",
  "POSSIBLE_SHIFT_CONFIGURATION_MISSING", "DESCANSO_INSUFICIENTE",
]);

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
  "JORNADA_FUERA_DE_TURNO",
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
  status: "PENDIENTE" | "PARCIAL" | "RESUELTA";
  severity: ShiftAlertSeverity;
};

// La jornada queda pendiente mientras todas sus alertas lo estén, pasa a
// resolución parcial cuando conviven alertas pendientes y revisadas, y queda
// resuelta cuando ya no tiene alertas pendientes.
function computeGroupStatus(members: ShiftAlert[]): AlertGroup["status"] {
  const pending = members.filter((alert) => alert.status === "PENDIENTE").length;
  if (pending === members.length) return "PENDIENTE";
  if (pending > 0) return "PARCIAL";
  return "RESUELTA";
}

const GROUP_STATUS_LABELS: Record<AlertGroup["status"], string> = { PENDIENTE: "Pendiente", PARCIAL: "Parcialmente resuelta", RESUELTA: "Resuelta" };
const GROUP_STATUS_TONE: Record<AlertGroup["status"], "warning" | "success" | "neutral"> = { PENDIENTE: "warning", PARCIAL: "neutral", RESUELTA: "success" };

function maximumGroupSeverity(members: ShiftAlert[]): ShiftAlertSeverity {
  const candidates = members.some((alert) => alert.status === "PENDIENTE") ? members.filter((alert) => alert.status === "PENDIENTE") : members;
  if (candidates.some((alert) => alert.severity === "CRITICA")) return "CRITICA";
  if (candidates.some((alert) => alert.severity === "ADVERTENCIA")) return "ADVERTENCIA";
  return "INFO";
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
    return { workShiftId, mainAlert: mainAlert!, secondaryAlerts, status: computeGroupStatus(members), severity: maximumGroupSeverity(members) };
  });
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
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
    // Etapa 14G.5: antes se hacía `setLoadStatus("loading")` incondicional en
    // cada cambio de búsqueda/tipo/severidad/estado, blanqueando la tabla con
    // el skeleton completo aunque ya hubiera alertas visibles -- mismo
    // criterio ya usado en HoursPage/AttendancePage (`if (!X.length)
    // setLoading(true)`). Sólo se muestra el loading grande en la carga
    // inicial real; un refetch con datos ya visibles no blanquea la tabla
    // mientras llega la respuesta nueva.
    if (!alerts.length) setLoadStatus("loading");
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
      setActionError("No pudimos resolver la alerta. Actualizá la página e intentá nuevamente.");
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
          `${countLabel(groups.length, "jornada con alertas", "jornadas con alertas")} · ${countLabel(meta.total, "alerta", "alertas")}`
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
            <div className="shift-alert-journey-list">
                  {groups.map((group) => {
                    const alert = group.mainAlert;
                    const expanded = expandedGroups.has(group.workShiftId);
                    const members = [group.mainAlert, ...group.secondaryAlerts];
                    const warningCount = members.filter((item) => item.severity === "ADVERTENCIA").length;
                    const infoCount = members.filter((item) => item.severity === "INFO").length;
                    return (
                      <article className={`shift-alert-journey-card severity-${group.severity.toLowerCase()}`} key={group.workShiftId}>
                        <header className="shift-alert-journey-header">
                          <div className="shift-alert-employee"><h3>{alert.employee.lastName}, {alert.employee.firstName}</h3><span>Legajo {alert.employee.legajo}</span></div>
                          <div className="shift-alert-journey-context"><b>{formatDateTime(alert.actualAt)}</b><span>{alert.workShift.shiftTemplate ? `Turno ${alert.workShift.shiftTemplate.name}` : "Sin turno asignado"}</span></div>
                          <div className="shift-alert-group-badges"><Badge tone={SEVERITY_TONE[group.severity]}>{SEVERITY_LABELS[group.severity]}</Badge><Badge tone={GROUP_STATUS_TONE[group.status]}>{GROUP_STATUS_LABELS[group.status]}</Badge></div>
                          <div className="shift-alert-journey-actions">
                              <Link className="table-icon-action" title="Ver legajo" aria-label={`Ver legajo de ${alert.employee.firstName} ${alert.employee.lastName}`} to={`/legajos/${alert.employeeId}`}><User size={14} /><span>Ver legajo</span></Link>
                              {alert.workShift.shiftTemplate ? <Link className="table-icon-action" title="Ver turno" aria-label="Ver turno" to={`/configuracion/turnos/${alert.workShift.shiftTemplate.id}`}><Clock size={14} /><span>Ver turno</span></Link> : null}
                          </div>
                        </header>
                        <div className="shift-alert-journey-summary">
                          <div><span className="shift-alert-primary-label">Alerta principal</span><b>{TYPE_LABELS[alert.type]}</b><span>{differenceLabel(alert)}</span>{LEGACY_ALERT_TYPES.has(alert.type) ? <Badge tone="neutral">Registro anterior</Badge> : null}</div>
                          <span>{countLabel(members.length, "alerta", "alertas")}{warningCount ? ` · ${countLabel(warningCount, "advertencia", "advertencias")}` : ""}{infoCount ? ` · ${countLabel(infoCount, "informativa", "informativas")}` : ""}</span>
                          <button type="button" className="shift-alert-toggle" onClick={() => toggleGroup(group.workShiftId)} aria-expanded={expanded} aria-controls={`shift-alert-detail-${group.workShiftId}`}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<span>{expanded ? "Ocultar detalles" : `Ver ${countLabel(members.length, "alerta", "alertas")}`}</span></button>
                        </div>
                        {expanded ? <div className="shift-alert-group-detail" id={`shift-alert-detail-${group.workShiftId}`}><p>Alertas de esta jornada</p><ul>{members.map((member, index) => <li key={member.id} className={index === 0 ? "is-primary" : ""}><div className="shift-alert-detail-name"><span>{TYPE_LABELS[member.type]}</span>{index === 0 ? <small>Principal</small> : null}{LEGACY_ALERT_TYPES.has(member.type) ? <small>Registro anterior</small> : null}</div><span className="shift-alert-difference">{differenceLabel(member)}</span><Badge tone={SEVERITY_TONE[member.severity]}>{SEVERITY_LABELS[member.severity]}</Badge><Badge tone={STATUS_TONE[member.status]}>{STATUS_LABELS[member.status]}</Badge>{member.status === "PENDIENTE" ? <button type="button" className="table-link" aria-label={`Resolver ${TYPE_LABELS[member.type]}`} onClick={() => openResolve(member)}><CheckCircle2 size={13} />Resolver</button> : <span />}</li>)}</ul></div> : null}
                      </article>
                    );
                  })}
            </div>
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
