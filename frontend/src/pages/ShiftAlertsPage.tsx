import { AlertTriangle, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { EmptyState } from "../components/ui/EmptyState";
import { TableShell } from "../components/ui/TableShell";
import { shiftAlertApiService, type ShiftAlert, type ShiftAlertSeverity, type ShiftAlertStatus, type ShiftAlertType } from "../services/api/shiftAlertApiService";
import { useDebouncedValue } from "../utils/useDebouncedValue";

const TYPE_LABELS: Record<ShiftAlertType, string> = {
  INGRESO_TARDE: "Llegada tarde",
  SALIDA_ANTICIPADA: "Salida anticipada",
  SALIDA_TARDIA: "Salida tardía",
  TURNO_NO_IDENTIFICADO: "Sin turno compatible",
  SHIFT_NOT_ENABLED_FOR_EMPLOYEE: "Turno no habilitado",
  POSSIBLE_SHIFT_CONFIGURATION_MISSING: "Posible falta de configuración",
  JORNADA_INSUFICIENTE: "Jornada por debajo del mínimo",
  JORNADA_EXTENDIDA: "Jornada extendida",
  DESCANSO_INSUFICIENTE: "Descanso insuficiente",
  POSIBLE_OLVIDO_SALIDA: "Posible olvido de salida",
};

const SEVERITY_TONE: Record<ShiftAlertSeverity, "neutral" | "warning" | "danger"> = {
  INFO: "neutral",
  ADVERTENCIA: "warning",
  CRITICA: "danger",
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

  const hasFilters = Boolean(search || type || severity || status !== "PENDIENTE");

  return (
    <>
      <PageHeader eyebrow="GESTIÓN HORARIA" title="Alertas de turnos" description="Fichadas que requieren revisión: tardanzas, salidas fuera de margen y turnos que no coinciden con lo habilitado." />
      <Section title="Alertas" subtitle={`${meta.total} alerta(s) según filtros aplicados.`}>
        <div className="position-filters catalog-filters">
          <div className="position-filter-title"><Search size={16} /><b>Filtros</b></div>
          <label>Buscar<input value={search} placeholder="Nombre, legajo o DNI" onChange={(e) => setSearch(e.target.value)} /></label>
          <label>Tipo<select value={type} onChange={(e) => setType(e.target.value as ShiftAlertType | "")}><option value="">Todos</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Severidad<select value={severity} onChange={(e) => setSeverity(e.target.value as ShiftAlertSeverity | "")}><option value="">Todas</option><option value="INFO">Informativa</option><option value="ADVERTENCIA">Advertencia</option><option value="CRITICA">Crítica</option></select></label>
          <label>Estado<select value={status} onChange={(e) => setStatus(e.target.value as ShiftAlertStatus | "ALL")}><option value="PENDIENTE">Pendientes</option><option value="RESUELTA">Resueltas</option><option value="DESCARTADA">Descartadas</option><option value="ALL">Todas</option></select></label>
          {hasFilters ? <button type="button" className="attendance-clear-filters" onClick={() => { setSearch(""); setType(""); setSeverity(""); setStatus("PENDIENTE"); }}><X size={15} /> Limpiar</button> : null}
        </div>

        {actionError ? <div className="form-error">{actionError}</div> : null}

        {loadStatus === "loading" ? (
          <EmptyState text="Cargando alertas..." icon={AlertTriangle} />
        ) : loadStatus === "error" ? (
          <EmptyState text="No pudimos cargar las alertas." icon={AlertTriangle} />
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
                  {alerts.map((alert) => (
                    <tr key={alert.id}>
                      <td><b>{alert.employee.lastName}, {alert.employee.firstName}</b><span className="table-sub">Legajo {alert.employee.legajo}</span></td>
                      <td>{TYPE_LABELS[alert.type]}</td>
                      <td><Badge tone={SEVERITY_TONE[alert.severity]}>{alert.severity}</Badge></td>
                      <td>{alert.workShift.shiftTemplate ? `${alert.workShift.shiftTemplate.code} · ${alert.workShift.shiftTemplate.name}` : <em>Sin turno</em>}</td>
                      <td>{differenceLabel(alert)}</td>
                      <td>{formatDateTime(alert.actualAt)}</td>
                      <td><Badge tone={STATUS_TONE[alert.status]}>{STATUS_LABELS[alert.status]}</Badge></td>
                      <td>
                        <div className="table-actions">
                          <Link className="table-link" to={`/legajos/${alert.employeeId}`}>Ver legajo</Link>
                          {alert.workShift.shiftTemplate ? <Link className="table-link" to={`/configuracion/turnos/${alert.workShift.shiftTemplate.id}`}>Ver turno</Link> : null}
                          {alert.status === "PENDIENTE" ? <button type="button" className="table-link" onClick={() => openResolve(alert)}>Resolver</button> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
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
