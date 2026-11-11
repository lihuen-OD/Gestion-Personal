import { AlertTriangle, Clock3, LogIn, RefreshCw } from "lucide-react";
import type { ClockEmployee } from "../../services/api/timeClockApiService";
import { formatDayMonth, formatTime, isSameArgentinaDay } from "../../utils/date";
import { employeeFullName, employeeIdentity, employeeInitials } from "./employeeLabels";

export type ShiftView =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "none" }
  | { kind: "open"; startAt: string; minutes: number }
  | { kind: "late"; startAt: string };

function elapsed(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${String(minutes % 60).padStart(2, "0")} min` : `${minutes} min`;
}

function since(startAt: string, now: Date) {
  return isSameArgentinaDay(startAt, now) ? `Desde las ${formatTime(startAt)}` : `Desde el ${formatDayMonth(startAt)} a las ${formatTime(startAt)}`;
}

/**
 * Paso 2: quién ficha y en qué estado está su jornada. El estado sale tal
 * cual de /clock/status (TimeClockPage); acá sólo se presenta.
 */
export function EmployeeStatus({ employee, shift, now, refreshing, refreshDisabled, changeDisabled = false, onRefresh, onChange }: {
  employee: ClockEmployee;
  shift: ShiftView;
  now: Date;
  refreshing: boolean;
  refreshDisabled: boolean;
  /** Con una fichada en curso (cámara abierta o envío) no se cambia de empleado. */
  changeDisabled?: boolean;
  onRefresh: () => void;
  onChange: () => void;
}) {
  // F10: actualizar el estado del legajo (no es una búsqueda); gira mientras consulta.
  const refresh = (
    <button type="button" className="icon-button" onClick={onRefresh} title="Actualizar estado" aria-label="Actualizar estado" disabled={refreshDisabled}>
      <RefreshCw strokeWidth={1.75} className={refreshing ? "spin-icon" : undefined} />
    </button>
  );

  let status = null;
  if (shift.kind === "loading") {
    status = (
      <div className="kiosk-status st-none" aria-busy="true">
        <span className="kiosk-status-icon"><Clock3 size={20} strokeWidth={1.75} aria-hidden="true" /></span>
        <span className="kiosk-status-text">
          <span className="skeleton-bar kiosk-skeleton-name" />
          <span className="skeleton-bar kiosk-skeleton-meta" />
        </span>
        {refresh}
      </div>
    );
  } else if (shift.kind === "none") {
    status = (
      <div className="kiosk-status st-none">
        <span className="kiosk-status-icon"><Clock3 size={20} strokeWidth={1.75} aria-hidden="true" /></span>
        <span className="kiosk-status-text">
          <strong>Sin jornada abierta</strong>
          <span>Tu próxima fichada es un ingreso.</span>
        </span>
        {refresh}
      </div>
    );
  } else if (shift.kind === "open") {
    status = (
      <div className="kiosk-status st-open">
        <span className="kiosk-status-icon"><LogIn size={20} strokeWidth={1.75} aria-hidden="true" /></span>
        <span className="kiosk-status-text">
          <strong>Jornada abierta</strong>
          <span>{since(shift.startAt, now)} · <span className="nowrap">hace {elapsed(shift.minutes)}</span></span>
        </span>
        {refresh}
      </div>
    );
  } else if (shift.kind === "late") {
    status = (
      <div className="kiosk-status st-late">
        <span className="kiosk-status-icon"><AlertTriangle size={20} strokeWidth={1.75} aria-hidden="true" /></span>
        <span className="kiosk-status-text">
          <strong>Quedó una jornada sin salida</strong>
          <span>Ingreso del {formatDayMonth(shift.startAt)} a las {formatTime(shift.startAt)}. Podés marcar un nuevo ingreso; RRHH lo revisa desde Asistencia.</span>
        </span>
        {refresh}
      </div>
    );
  } else {
    // Sin estado confirmado (falló la consulta, F6-02): no se ofrece ninguna
    // fichada hasta actualizar. El motivo queda en el aviso junto a la acción.
    status = (
      <div className="kiosk-status st-none">
        <span className="kiosk-status-icon"><AlertTriangle size={20} strokeWidth={1.75} aria-hidden="true" /></span>
        <span className="kiosk-status-text">
          <strong>No pudimos consultar tu jornada</strong>
          <span>Tocá actualizar para volver a intentar.</span>
        </span>
        {refresh}
      </div>
    );
  }

  return (
    <>
      <div className="kiosk-person">
        <span className="kiosk-orb" aria-hidden="true">
          <svg className="kiosk-orb-ring" viewBox="0 0 100 100" focusable="false">
            <circle cx="50" cy="50" r="47" pathLength={100} />
            <circle className="kiosk-orb-arc" cx="50" cy="50" r="47" pathLength={100} />
          </svg>
          <span className="kiosk-avatar is-large">{employeeInitials(employee)}</span>
        </span>
        <div className="kiosk-person-text">
          <p className="kiosk-eyebrow" aria-hidden="true">Empleado seleccionado</p>
          <h2>{employeeFullName(employee)}</h2>
          <p>{employeeIdentity(employee)}</p>
        </div>
        <button type="button" className="kiosk-change" onClick={onChange} disabled={changeDisabled} aria-label="Cambiar empleado">
          Cambiar
        </button>
      </div>
      {status}
    </>
  );
}
