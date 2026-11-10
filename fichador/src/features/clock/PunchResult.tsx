import { Info } from "lucide-react";
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
      <span className="kiosk-result-check" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <h1 className="kiosk-result-title">{punchType === "IN" ? "Entrada registrada" : "Salida registrada"}</h1>
      <p className="kiosk-result-name">{employeeName}</p>
      <p className="kiosk-result-time">
        <span className="sr-only">{"Hora registrada: "}</span>
        <span>{time}</span>
      </p>
      <p className="kiosk-result-date">{formatLongDate(at)}</p>
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
