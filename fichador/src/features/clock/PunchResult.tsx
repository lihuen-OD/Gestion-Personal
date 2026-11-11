import { Info, ScanFace, ShieldCheck } from "lucide-react";
import { formatDateTime, formatLongDate, formatTime } from "../../utils/date";

/**
 * Confirmación de una fichada (F8): sólo se muestra con la respuesta exitosa
 * del backend y con la hora OFICIAL que devolvió (nunca el reloj del equipo).
 * Ocupa toda la pantalla y vuelve sola al inicio (TimeClockPage,
 * SUCCESS_RESET_MS; la barra dura lo mismo en screens/kiosk.css).
 */
export function PunchResult({ punchType, employeeName, at, previousOpenShiftAt }: {
  punchType: "IN" | "OUT";
  employeeName: string;
  at: string;
  previousOpenShiftAt?: string;
}) {
  const time = formatTime(at);
  return (
    <main className="kiosk-result" role="status" aria-live="polite">
      {/* Sello «Biometric Future»: confirma la fichada que aceptó el servidor. */}
      <span className="kiosk-result-check" aria-hidden="true">
        <svg className="kiosk-emblem" viewBox="0 0 160 160" focusable="false">
          <circle className="kiosk-emblem-orbit" cx="80" cy="80" r="78" />
          <circle className="kiosk-emblem-ring" cx="80" cy="80" r="64" pathLength={100} />
          <circle className="kiosk-emblem-core" cx="80" cy="80" r="50" />
          <path className="kiosk-emblem-check" d="M60 81 l13 13 l27 -29" pathLength={1} />
        </svg>
        <span className="kiosk-emblem-pulse" />
      </span>
      <h1 className="kiosk-result-title">{punchType === "IN" ? "Entrada registrada" : "Salida registrada"}</h1>
      <p className="kiosk-result-name">{employeeName}</p>
      <p className="kiosk-result-time">
        <span className="sr-only">{"Hora registrada: "}</span>
        <span>{time}</span>
      </p>
      <p className="kiosk-result-date">{formatLongDate(at)}</p>
      {/* Toda fichada del kiosco lleva la foto tomada en el paso 3: es evidencia, no una verificación de identidad. */}
      <p className="kiosk-result-evidence">
        <span className="kiosk-result-evidence-icon" aria-hidden="true"><ScanFace size={20} strokeWidth={1.75} /></span>
        Foto tomada para esta fichada
        <ShieldCheck className="kiosk-result-evidence-ok" size={18} strokeWidth={1.75} aria-hidden="true" />
      </p>
      {previousOpenShiftAt ? (
        <div className="kiosk-notice tone-neutral kiosk-result-note" role="note">
          <Info size={22} strokeWidth={1.75} aria-hidden="true" />
          <div>
            <strong>Tu jornada anterior quedó sin salida</strong>
            <p>El ingreso anterior del {formatDateTime(previousOpenShiftAt)} quedó marcado como olvido de salida.</p>
          </div>
        </div>
      ) : null}
      <div className="kiosk-result-footer">
        <span>Volviendo al inicio…</span>
        <span className="kiosk-result-bar" aria-hidden="true"><span /></span>
      </div>
    </main>
  );
}
