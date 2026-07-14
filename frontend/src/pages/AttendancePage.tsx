import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarDays, Camera, CheckCircle2, Clock3, DoorOpen, Eye, RefreshCcw, TimerReset } from "lucide-react";
import { attendanceApiService, type AttendancePunch, type AttendanceShift } from "../services/api/attendanceApiService";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { Modal } from "../components/ui/Modal";

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

function ShiftRows({ items, emptyText, showSegments = false, onAction, onViewPhoto }: { items: AttendanceShift[]; emptyText: string; showSegments?: boolean; onAction?: (shift: AttendanceShift, action: ShiftActionType) => void; onViewPhoto: (id: string) => void }) {
  if (!items.length) return <EmptyState text={emptyText} icon={Clock3} />;
  return (
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
          <th>Estado</th>
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
            <td><Badge tone={statusTone(shift.status)}>{shift.status.replace(/_/g, " ")}</Badge></td>
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
  );
}

type ShiftActionType = "close" | "missing" | "observe";

type ShiftAction = {
  shift: AttendanceShift;
  type: ShiftActionType;
};

function PunchRows({ items, onViewPhoto }: { items: AttendancePunch[]; onViewPhoto: (id: string) => void }) {
  if (!items.length) return <EmptyState text="No hay intentos observados para la fecha." icon={AlertTriangle} />;
  return (
    <table className="attendance-table">
      <thead>
        <tr>
          <th>Empleado</th>
          <th>Legajo</th>
          <th>Tipo</th>
          <th>Hora</th>
          <th>Origen</th>
          <th>Validación</th>
          <th>Motivo</th>
        </tr>
      </thead>
      <tbody>
        {items.map((punch) => (
          <tr key={punch.id}>
            <td>
              <strong>{employeeName(punch)}</strong>
              <span className="muted-line">DNI {punch.employee.dni}</span>
            </td>
            <td>{punch.employee.legajo}</td>
            <td>{punch.type === "INGRESO" ? "Ingreso" : "Salida"}</td>
            <td>{formatDateTime(punch.timestamp)}</td>
            <td>{sourceLabel(punch.source)}</td>
            <td>
              <div className="attendance-evidence">
                <span>{faceStatusLabel(punch.faceValidationStatus)}</span>
                {hasPunchPhoto(punch) ? (
                  <button type="button" className="table-link" onClick={() => onViewPhoto(punch.id)}>
                    <Camera size={14} />
                    Ver foto
                  </button>
                ) : null}
              </div>
            </td>
            <td>{punch.observation || "Intento observado"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ObservedRows({ shifts, punches, onAction, onViewPhoto }: { shifts: AttendanceShift[]; punches: AttendancePunch[]; onAction: (shift: AttendanceShift, action: ShiftActionType) => void; onViewPhoto: (id: string) => void }) {
  if (!shifts.length && !punches.length) {
    return <EmptyState text="No hay marcaciones observadas para la fecha." icon={AlertTriangle} />;
  }

  return (
    <div className="attendance-observed-grid">
      {shifts.length ? <ShiftRows items={shifts} emptyText="" showSegments onAction={onAction} onViewPhoto={onViewPhoto} /> : null}
      {punches.length ? <PunchRows items={punches} onViewPhoto={onViewPhoto} /> : null}
    </div>
  );
}

export function AttendancePage() {
  const [date, setDate] = useState(todayKey());
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [shiftAction, setShiftAction] = useState<ShiftAction>();
  const [actionReason, setActionReason] = useState("");
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
    return () => {
      if (photoPreview?.url) URL.revokeObjectURL(photoPreview.url);
    };
  }, [photoPreview?.url]);

  const observedCount = useMemo(() => (summary?.observedShifts.length || 0) + (summary?.observedPunches.length || 0), [summary]);

  const openAction = (shift: AttendanceShift, type: ShiftActionType) => {
    setShiftAction({ shift, type });
    setActionReason("");
    setActionError("");
    setManualEndAt(toDateTimeLocalValue());
  };

  const closeAction = () => {
    setShiftAction(undefined);
    setActionReason("");
    setActionError("");
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
            <label className="date-filter">
              <CalendarDays size={16} />
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <Button icon={RefreshCcw} onClick={() => setRefreshKey((value) => value + 1)} loading={loading}>Actualizar</Button>
          </>
        )}
      />

      <div className="stat-grid">
        <StatCard label="Jornadas abiertas" value={summary?.totals.open || 0} detail="Ingresos sin salida" icon={DoorOpen} tone="orange" />
        <StatCard label="Jornadas cerradas" value={summary?.totals.closed || 0} detail="Con salida registrada" icon={CheckCircle2} tone="green" />
        <StatCard label="Observadas" value={observedCount} detail="Requieren revisión" icon={AlertTriangle} tone="red" />
        <StatCard label="Horas registradas" value={`${summary?.totals.workedHours || 0} h`} detail="Sobre jornadas cerradas" icon={TimerReset} tone="blue" />
      </div>

      {error && <div className="form-error">{error}</div>}

      <Section title="Jornadas abiertas" subtitle="Empleados que marcaron ingreso y todavía no registraron salida.">
        {loading ? <EmptyState text="Cargando jornadas abiertas..." icon={Clock3} /> : <ShiftRows items={summary?.openShifts || []} emptyText="No hay jornadas abiertas para esta fecha." onAction={openAction} onViewPhoto={openPunchPhoto} />}
      </Section>

      {photoError ? <div className="form-error">{photoError}</div> : null}

      <Section title="Marcaciones observadas" subtitle="Intentos inválidos y jornadas con conflictos para revisar.">
        {loading ? <EmptyState text="Cargando observaciones..." icon={AlertTriangle} /> : (
          <ObservedRows shifts={summary?.observedShifts || []} punches={summary?.observedPunches || []} onAction={openAction} onViewPhoto={openPunchPhoto} />
        )}
      </Section>

      <Section title="Jornadas cerradas" subtitle="Jornadas procesadas con sus tramos calculados y carga horaria generada.">
        {loading ? <EmptyState text="Cargando jornadas cerradas..." icon={CheckCircle2} /> : <ShiftRows items={summary?.closedShifts || []} emptyText="No hay jornadas cerradas para esta fecha." showSegments onAction={openAction} onViewPhoto={openPunchPhoto} />}
      </Section>

      {shiftAction ? (
        <Modal title={actionTitle} close={closeAction}>
          <div className="form-stack">
            <div className="info-note compact">
              <b>{employeeName(shiftAction.shift)}</b>
              <p>Ingreso: {formatDateTime(shiftAction.shift.startAt)} · Legajo {shiftAction.shift.employee.legajo}</p>
            </div>
            {shiftAction.type === "close" ? (
              <label>
                Hora de salida
                <input type="datetime-local" value={manualEndAt} onChange={(event) => setManualEndAt(event.target.value)} />
              </label>
            ) : null}
            <label>
              Motivo obligatorio
              <textarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Indicá el motivo para dejar trazabilidad" />
            </label>
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
