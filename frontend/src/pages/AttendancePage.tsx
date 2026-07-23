import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarDays, Camera, CheckCircle2, Clock3, DoorOpen, Eye, RefreshCcw, Search, TimerReset, X } from "lucide-react";
import { attendanceApiService, type AttendanceObservation, type AttendancePunch, type AttendanceShift } from "../services/api/attendanceApiService";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { Modal } from "../components/ui/Modal";
import { TableShell } from "../components/ui/TableShell";
import { useDebouncedValue } from "../utils/useDebouncedValue";

const OBSERVED_PAGE_SIZE = 10;

function observationId(item: AttendanceObservation) {
  if (item.kind === "SHIFT") return `${item.kind}-${item.shift.id}`;
  if (item.kind === "PUNCH") return `${item.kind}-${item.punch.id}`;
  return `${item.kind}-${item.incident.id}`;
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Cordoba" });
}

function employeeName(shift: Pick<AttendanceShift, "employee"> | Pick<AttendancePunch, "employee">) {
  return `${shift.employee.lastName}, ${shift.employee.firstName}`;
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Cordoba",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Cordoba",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(minutes?: number | null) {
  if (!minutes) return "0 h";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function toDateTimeLocalValue(value = new Date()) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "PROCESADO" || status === "REVISADO") return "success";
  if (status === "ABIERTO") return "warning";
  if (status === "OBSERVADO" || status === "FALTA_SALIDA" || status === "FALTA_INGRESO" || status === "INVALIDO") return "danger";
  return "neutral";
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    ADMIN: "Admin",
    PORTAL_DNI: "Fichador",
    PUBLIC_CLOCK_PHOTO: "Fichador con foto",
    KIOSK: "Kiosco",
    BIOTIME: "BioTime",
    FACIAL: "Facial",
  };
  return labels[source] || source;
}

function faceStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    VALID: "Rostro válido",
    NO_FACE: "Sin rostro",
    MULTIPLE_FACES: "Más de una cara",
    LOW_LIGHT: "Baja luz",
    FACE_TOO_SMALL: "Rostro pequeño",
    CAMERA_ERROR: "Error cámara",
  };
  return status ? labels[status] || status : "Sin validación";
}

function hasPunchPhoto(punch?: { photoStoragePath?: string | null; photoUrl?: string | null; photoFileId?: string | null; thumbnailFileId?: string | null } | null) {
  return Boolean(punch?.photoFileId || punch?.thumbnailFileId || punch?.photoStoragePath || punch?.photoUrl);
}

const RISK_LABEL: Record<string, string> = {
  NORMAL: "Normal",
  MISSING_OUT: "Posible olvido de salida",
  EXPIRED: "Jornada vencida",
};

const RISK_TONE: Record<string, "success" | "warning" | "danger"> = {
  NORMAL: "success",
  MISSING_OUT: "warning",
  EXPIRED: "danger",
};

function PunchEvidence({ punch, label, onViewPhoto }: { punch?: AttendanceShift["startPunch"] | AttendanceShift["endPunch"] | null; label: string; onViewPhoto: (id: string) => void }) {
  if (!punch) return null;
  return (
    <div className="attendance-evidence">
      <span>{faceStatusLabel(punch.faceValidationStatus)}</span>
      {hasPunchPhoto(punch) ? (
        <button type="button" className="table-link" onClick={() => onViewPhoto(punch.id)}>
          <Camera size={14} />
          {label}
        </button>
      ) : null}
    </div>
  );
}

function ShiftRows({ items, emptyText, showSegments = false, showRisk = false, onAction, onViewPhoto }: { items: AttendanceShift[]; emptyText: string; showSegments?: boolean; showRisk?: boolean; onAction?: (shift: AttendanceShift, action: ShiftActionType) => void; onViewPhoto: (id: string) => void }) {
  if (!items.length) return <EmptyState text={emptyText} icon={Clock3} />;
  return (
    <TableShell minWidth={showRisk ? 1420 : 1080}>
    <table className="attendance-table">
      <thead>
        <tr>
          <th>Empleado</th>
          <th>Legajo</th>
          <th>Sector</th>
          <th>Ingreso</th>
          <th>Salida</th>
          <th>Total</th>
          <th>Origen</th>
          {showRisk && <th>Turno</th>}
          {showRisk && <th>Salida esperada</th>}
          <th>Estado</th>
          {showRisk && <th>Riesgo</th>}
          {showSegments && <th>Tramos</th>}
          <th>Acción</th>
        </tr>
      </thead>
      <tbody>
        {items.map((shift) => (
          <tr key={shift.id}>
            <td>
              <strong>{employeeName(shift)}</strong>
              <span className="muted-line">DNI {shift.employee.dni}</span>
            </td>
            <td>{shift.employee.legajo}</td>
            <td>{shift.employee.sector?.name || "-"}</td>
            <td>
              {formatDateTime(shift.startAt)}
              <PunchEvidence punch={shift.startPunch} label="Ver foto" onViewPhoto={onViewPhoto} />
            </td>
            <td>
              {formatDateTime(shift.endAt)}
              <PunchEvidence punch={shift.endPunch} label="Ver foto" onViewPhoto={onViewPhoto} />
            </td>
            <td>{formatDuration(shift.workedMinutes || shift.totalMinutes)}</td>
            <td>{sourceLabel(shift.source)}</td>
            {showRisk && <td>{shift.shiftTemplate ? `${shift.shiftTemplate.code} · ${shift.shiftTemplate.name}` : <em>Sin turno</em>}</td>}
            {showRisk && <td>{formatDateTime(shift.risk?.expectedExitAt)}</td>}
            <td><Badge tone={statusTone(shift.status)}>{shift.status.replace(/_/g, " ")}</Badge></td>
            {showRisk && <td>{shift.risk ? <Badge tone={RISK_TONE[shift.risk.level]}>{RISK_LABEL[shift.risk.level]}</Badge> : "-"}</td>}
            {showSegments && (
              <td>
                <div className="attendance-segments">
                  {shift.timeSegments.length ? shift.timeSegments.map((segment) => (
                    <span key={segment.id}>{formatTime(segment.fromDateTime)} a {formatTime(segment.toDateTime)} · {formatDuration(segment.minutes)}</span>
                  )) : <span>Sin tramos</span>}
                </div>
              </td>
            )}
            <td>
              <div className="attendance-actions">
                <Link className="table-link" to={`/horas/${shift.employeeId}?period=${shift.startAt.slice(0, 7)}`}>
                  <Eye size={14} />
                  Ver carga
                </Link>
                {onAction && shift.status === "ABIERTO" ? (
                  <>
                    <button type="button" className="table-link" onClick={() => onAction(shift, "close")}>Cerrar</button>
                    <button type="button" className="table-link" onClick={() => onAction(shift, "missing")}>Olvido salida</button>
                  </>
                ) : null}
                {onAction && shift.status !== "OBSERVADO" ? (
                  <button type="button" className="table-link" onClick={() => onAction(shift, "observe")}>Observar</button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </TableShell>
  );
}

type ShiftActionType = "close" | "missing" | "observe";

const MANUAL_CLOSE_REASONS = [
  "Olvido de salida",
  "Error de fichada",
  "Corte de sistema",
  "Corrección autorizada por supervisor",
  "Jornada de campo/campaña",
  "Otro",
];

type ShiftAction = {
  shift: AttendanceShift;
  type: ShiftActionType;
};

function ObservationRows({ items, onViewPhoto, onResolve }: { items: AttendanceObservation[]; onViewPhoto: (id: string) => void; onResolve: (kind: "SHIFT" | "PUNCH" | "INACTIVITY", id: string) => void }) {
  if (!items.length) {
    return <EmptyState text="No hay problemas de fichada para los filtros seleccionados." icon={AlertTriangle} />;
  }
  return (
    <table className="attendance-table attendance-review-table">
      <thead><tr><th>Empleado</th><th>Fecha y hora</th><th>Problema</th><th>Detalle</th><th>Origen</th><th>Acción</th></tr></thead>
      <tbody>{items.map((item) => {
        if (item.kind === "INACTIVITY") {
          const incident = item.incident;
          const isPending = incident.status === "PENDIENTE";
          return <tr key={`INACTIVITY-${incident.id}`}>
            <td><strong>{employeeName(incident)}</strong><span className="muted-line">Legajo {incident.employee.legajo} · DNI {incident.employee.dni}</span></td>
            <td>{new Date(incident.operationalDate).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
            <td><Badge tone="danger">Sin actividad registrada</Badge></td>
            <td><span className="attendance-review-detail">{incident.observation}</span></td>
            <td>Control automático</td>
            <td>{isPending ? <button type="button" className="table-link" onClick={() => onResolve("INACTIVITY", incident.id)}>Resolver</button> : <Badge tone="success">Resuelta</Badge>}</td>
          </tr>;
        }
        const record = item.kind === "SHIFT" ? item.shift : item.punch;
        const isPending = record.reviewStatus === "PENDIENTE";
        const problem = item.kind === "SHIFT" ? item.shift.status.replace(/_/g, " ") : item.punch.type === "INGRESO" ? "Intento de ingreso" : "Intento de salida";
        const detail = item.kind === "SHIFT"
          ? item.shift.observation || (item.shift.status === "FALTA_SALIDA" ? "No se registró la salida" : "Jornada con conflicto")
          : item.punch.observation || faceStatusLabel(item.punch.faceValidationStatus);
        return <tr key={`${item.kind}-${record.id}`}>
          <td><strong>{employeeName(record)}</strong><span className="muted-line">Legajo {record.employee.legajo} · DNI {record.employee.dni}</span></td>
          <td>{formatDateTime(item.occurredAt)}</td>
          <td><Badge tone="danger">{problem}</Badge></td>
          <td><span className="attendance-review-detail">{detail}</span>{item.kind === "PUNCH" && hasPunchPhoto(item.punch) ? <button type="button" className="table-link" onClick={() => onViewPhoto(item.punch.id)}><Camera size={14} />Ver foto</button> : null}</td>
          <td>{sourceLabel(record.source)}</td>
          <td>{isPending ? <button type="button" className="table-link" onClick={() => onResolve(item.kind, record.id)}>Resolver</button> : <Badge tone="success">Resuelta</Badge>}</td>
        </tr>;
      })}</tbody>
    </table>
  );
}

export function AttendancePage() {
  const [searchParams] = useSearchParams();
  const [date, setDate] = useState(todayKey());
  const [observationDate, setObservationDate] = useState(() => searchParams.get("observationDate") || "");
  const [observedQuery, setObservedQuery] = useState("");
  const debouncedObservedQuery = useDebouncedValue(observedQuery, 300);
  const [observedType, setObservedType] = useState<"ALL" | "SHIFT" | "PUNCH" | "INACTIVITY">("ALL");
  const [observedStatus, setObservedStatus] = useState<"PENDIENTE" | "RESUELTA">("PENDIENTE");
  const [observations, setObservations] = useState<AttendanceObservation[]>([]);
  const [observationsMeta, setObservationsMeta] = useState({ total: 0, hasMore: false, nextBefore: null as string | null });
  const [observationsLoading, setObservationsLoading] = useState(true);
  const [observationsLoadingMore, setObservationsLoadingMore] = useState(false);
  const [observationsError, setObservationsError] = useState("");
  const [observationsRefresh, setObservationsRefresh] = useState(0);
  const [reviewAction, setReviewAction] = useState<{ kind: "SHIFT" | "PUNCH" | "INACTIVITY"; id: string }>();
  const [reviewReason, setReviewReason] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [shiftAction, setShiftAction] = useState<ShiftAction>();
  const [actionReason, setActionReason] = useState("");
  const [closeReasonOption, setCloseReasonOption] = useState("");
  const [manualEndAt, setManualEndAt] = useState(toDateTimeLocalValue());
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof attendanceApiService.getSummary>>>();
  const [photoPreview, setPhotoPreview] = useState<{ url: string; title: string }>();
  const [photoError, setPhotoError] = useState("");
  const [photoLoading, setPhotoLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    attendanceApiService.getSummary(date)
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar el control de asistencia.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setObservationsLoading(true);
    setObservationsError("");
    attendanceApiService.getObservations({ date: observationDate || undefined, search: debouncedObservedQuery, type: observedType, reviewStatus: observedStatus, take: OBSERVED_PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setObservations(result.data);
        setObservationsMeta({ total: result.meta.total, hasMore: result.meta.hasMore, nextBefore: result.meta.nextBefore });
      })
      .catch(() => { if (!cancelled) setObservationsError("No se pudieron cargar los problemas de fichada."); })
      .finally(() => { if (!cancelled) setObservationsLoading(false); });
    return () => { cancelled = true; };
  }, [observationDate, debouncedObservedQuery, observedType, observedStatus, observationsRefresh]);

  useEffect(() => {
    return () => {
      if (photoPreview?.url) URL.revokeObjectURL(photoPreview.url);
    };
  }, [photoPreview?.url]);

  const loadMoreObservations = async () => {
    if (!observationsMeta.nextBefore || observationsLoadingMore) return;
    setObservationsLoadingMore(true);
    setObservationsError("");
    try {
      const result = await attendanceApiService.getObservations({ date: observationDate || undefined, search: debouncedObservedQuery, type: observedType, reviewStatus: observedStatus, before: observationsMeta.nextBefore, take: OBSERVED_PAGE_SIZE });
      setObservations((current) => [...current, ...result.data.filter((next) => !current.some((item) => observationId(item) === observationId(next)))]);
      setObservationsMeta({ total: result.meta.total, hasMore: result.meta.hasMore, nextBefore: result.meta.nextBefore });
    } catch {
      setObservationsError("No se pudieron cargar más problemas de fichada.");
    } finally {
      setObservationsLoadingMore(false);
    }
  };

  const confirmReviewAction = async () => {
    if (!reviewAction || !reviewReason.trim()) return;
    setActionLoading(true);
    setActionError("");
    try {
      await attendanceApiService.resolveObservation(reviewAction.kind, reviewAction.id, "RESUELTA", reviewReason.trim());
      setReviewAction(undefined);
      setReviewReason("");
      setObservationsRefresh((value) => value + 1);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo resolver el problema de fichada.");
    } finally {
      setActionLoading(false);
    }
  };

  const openAction = (shift: AttendanceShift, type: ShiftActionType) => {
    setShiftAction({ shift, type });
    setActionReason("");
    setCloseReasonOption("");
    setActionError("");
    setManualEndAt(toDateTimeLocalValue());
  };

  const closeAction = () => {
    setShiftAction(undefined);
    setActionReason("");
    setCloseReasonOption("");
    setActionError("");
  };

  const selectCloseReason = (value: string) => {
    setCloseReasonOption(value);
    setActionReason(value === "Otro" ? "" : value);
  };

  const closePhotoPreview = () => {
    if (photoPreview?.url) URL.revokeObjectURL(photoPreview.url);
    setPhotoPreview(undefined);
    setPhotoError("");
  };

  const openPunchPhoto = async (id: string) => {
    setPhotoError("");
    setPhotoLoading(true);
    try {
      const result = await attendanceApiService.downloadPunchPhoto(id);
      closePhotoPreview();
      setPhotoPreview({
        url: URL.createObjectURL(result.blob),
        title: result.fileName || "Foto de fichada",
      });
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "No se pudo abrir la foto de la fichada.");
    } finally {
      setPhotoLoading(false);
    }
  };

  const confirmShiftAction = async () => {
    if (!shiftAction || !actionReason.trim()) return;
    setActionLoading(true);
    setActionError("");
    try {
      if (shiftAction.type === "close") {
        await attendanceApiService.closeWorkShiftManually(shiftAction.shift.id, {
          endAt: new Date(manualEndAt).toISOString(),
          reason: actionReason.trim(),
        });
      } else if (shiftAction.type === "missing") {
        await attendanceApiService.markMissingOut(shiftAction.shift.id, actionReason.trim());
      } else {
        await attendanceApiService.observeWorkShift(shiftAction.shift.id, actionReason.trim());
      }
      closeAction();
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo registrar la acción.");
    } finally {
      setActionLoading(false);
    }
  };

  const actionTitle = shiftAction?.type === "close" ? "Cerrar jornada manualmente" : shiftAction?.type === "missing" ? "Marcar olvido de salida" : "Observar jornada";

  return (
    <div className="page-wrap attendance-page">
      <PageHeader
        eyebrow="Asistencia"
        title="Control de fichadas"
        description="Seguimiento diario de ingresos, salidas, jornadas abiertas y marcaciones observadas."
        action={(
          <>
            <div className="attendance-journey-filter">
              <span>Jornadas del día</span>
              <label className="date-filter"><CalendarDays size={16} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            </div>
            <Button icon={RefreshCcw} onClick={() => setRefreshKey((value) => value + 1)} loading={loading}>Actualizar</Button>
          </>
        )}
      />

      <div className="stat-grid">
        <StatCard label="Jornadas abiertas" value={summary?.totals.open || 0} detail="Ingresos sin salida" icon={DoorOpen} tone="orange" />
        <StatCard label="Jornadas cerradas" value={summary?.totals.closed || 0} detail="Con salida registrada" icon={CheckCircle2} tone="green" />
        <StatCard label="Problemas del día" value={summary?.totals.observed || 0} detail="Detectados en la fecha de jornadas" icon={AlertTriangle} tone="red" />
        <StatCard label="Horas registradas" value={`${summary?.totals.workedHours || 0} h`} detail="Sobre jornadas cerradas" icon={TimerReset} tone="blue" />
      </div>

      {error && <div className="form-error">{error}</div>}

      <Section title="Jornadas abiertas" subtitle="Ordenadas por riesgo: vencidas y con posible olvido de salida primero, sin esperar siempre a las 20hs.">
        {loading ? <EmptyState text="Cargando jornadas abiertas..." icon={Clock3} /> : <ShiftRows items={summary?.openShifts || []} emptyText="No hay jornadas abiertas para esta fecha." showRisk onAction={openAction} onViewPhoto={openPunchPhoto} />}
      </Section>

      {photoError ? <div className="form-error">{photoError}</div> : null}

      <Section title="Jornadas cerradas" subtitle="Jornadas procesadas con sus tramos calculados y carga horaria generada.">
        {loading ? <EmptyState text="Cargando jornadas cerradas..." icon={CheckCircle2} /> : <ShiftRows items={summary?.closedShifts || []} emptyText="No hay jornadas cerradas para esta fecha." showSegments onAction={openAction} onViewPhoto={openPunchPhoto} />}
      </Section>

      <Section
        title="Problemas de fichada"
        subtitle="Casos que requieren revisión. Podés resolverlos o descartarlos dejando un motivo."
        className="attendance-observed-panel"
        action={<button type="button" className="table-link" onClick={() => setObservedStatus((current) => current === "PENDIENTE" ? "RESUELTA" : "PENDIENTE")}>{observedStatus === "PENDIENTE" ? "Ver resueltas" : "Volver a pendientes"}</button>}
      >
        <div className="attendance-observed-filters">
          <label>
            <span>Fecha de observaciones</span>
            <div className="attendance-filter-control">
              <CalendarDays size={16} />
              <input type="date" value={observationDate} onChange={(event) => setObservationDate(event.target.value)} aria-label="Fecha de observaciones; vacío muestra todas" />
            </div>
            <small className="attendance-filter-help">Vacía: todas las fechas</small>
          </label>
          <label className="attendance-observed-search">
            <span>Empleado</span>
            <div className="attendance-filter-control">
              <Search size={16} />
              <input value={observedQuery} onChange={(event) => setObservedQuery(event.target.value)} placeholder="Nombre, legajo, DNI o sector" />
            </div>
          </label>
          <label>
            <span>Mostrar</span>
            <select value={observedType} onChange={(event) => setObservedType(event.target.value as typeof observedType)}>
              <option value="ALL">Todos los tipos</option>
              <option value="SHIFT">Jornadas con conflicto</option>
              <option value="PUNCH">Intentos inválidos</option>
              <option value="INACTIVITY">Sin actividad registrada</option>
            </select>
          </label>
          {(observationDate || observedQuery || observedType !== "ALL") ? (
            <button type="button" className="attendance-clear-filters" onClick={() => { setObservationDate(""); setObservedQuery(""); setObservedType("ALL"); }}>
              <X size={15} /> Limpiar
            </button>
          ) : null}
        </div>
        <div className="attendance-results-bar">
          <span><b>{observationsMeta.total}</b> {observedStatus === "PENDIENTE" ? "problemas pendientes" : "problemas resueltos"} · mostrando {observations.length}</span>
          <small>El servidor carga únicamente {OBSERVED_PAGE_SIZE} por vez</small>
        </div>
        {observationsError ? <div className="form-error">{observationsError}</div> : null}
        {observationsLoading ? <EmptyState text="Cargando problemas de fichada..." icon={AlertTriangle} /> : (
          <>
            <ObservationRows items={observations} onViewPhoto={openPunchPhoto} onResolve={(kind, id) => { setReviewAction({ kind, id }); setReviewReason(""); setActionError(""); }} />
            {observationsMeta.hasMore ? <div className="attendance-load-more"><Button variant="subtle" onClick={loadMoreObservations} loading={observationsLoadingMore}>Cargar 10 más</Button></div> : null}
          </>
        )}
      </Section>

      {reviewAction ? (
        <Modal title="Resolver problema de fichada" close={() => setReviewAction(undefined)}>
          <div className="form-stack">
            <div className="info-note compact"><b>Resolución con trazabilidad</b><p>El caso saldrá de pendientes y quedará disponible en el historial.</p></div>
            <label>Cómo se resolvió<textarea value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="Ej.: se corrigió la salida según lo informado por el responsable" /></label>
            {actionError ? <p className="error">{actionError}</p> : null}
            <div className="form-actions"><Button variant="subtle" onClick={() => setReviewAction(undefined)}>Cancelar</Button><Button onClick={confirmReviewAction} loading={actionLoading} disabled={!reviewReason.trim()}>Confirmar resolución</Button></div>
          </div>
        </Modal>
      ) : null}

      {shiftAction ? (
        <Modal title={actionTitle} close={closeAction}>
          <div className="form-stack">
            <div className="info-note compact">
              <b>{employeeName(shiftAction.shift)}</b>
              <p>Ingreso: {formatDateTime(shiftAction.shift.startAt)} · Legajo {shiftAction.shift.employee.legajo}</p>
            </div>
            {shiftAction.type === "close" ? (
              <>
                <label>
                  Hora de salida
                  <input type="datetime-local" value={manualEndAt} onChange={(event) => setManualEndAt(event.target.value)} />
                </label>
                <label>
                  Motivo
                  <select value={closeReasonOption} onChange={(event) => selectCloseReason(event.target.value)}>
                    <option value="">Seleccionar motivo...</option>
                    {MANUAL_CLOSE_REASONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              </>
            ) : null}
            {shiftAction.type !== "close" || closeReasonOption === "Otro" ? (
              <label>
                {shiftAction.type === "close" ? "Detalle del motivo" : "Motivo obligatorio"}
                <textarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Indicá el motivo para dejar trazabilidad" />
              </label>
            ) : null}
            {!actionReason.trim() ? <p className="error">El motivo es obligatorio.</p> : null}
            {actionError ? <p className="error">{actionError}</p> : null}
            <div className="form-actions">
              <Button variant="subtle" onClick={closeAction}>Cancelar</Button>
              <Button variant={shiftAction.type === "missing" ? "danger" : "primary"} onClick={confirmShiftAction} loading={actionLoading} disabled={!actionReason.trim()}>
                Confirmar
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {photoPreview ? (
        <Modal title={photoPreview.title} close={closePhotoPreview}>
          <div className="attendance-photo-preview">
            <img src={photoPreview.url} alt="Evidencia de fichada" />
          </div>
        </Modal>
      ) : null}

      {photoLoading ? (
        <Modal title="Evidencia de fichada" close={() => undefined} closeDisabled>
          <EmptyState text="Cargando evidencia fotográfica..." icon={Camera} />
        </Modal>
      ) : null}
    </div>
  );
}
