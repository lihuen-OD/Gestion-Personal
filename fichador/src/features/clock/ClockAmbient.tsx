import { Check, WifiOff } from "lucide-react";
import { Brand } from "../../components/ui/Brand";
import { formatClock, formatLongDate } from "../../utils/date";
import type { useMaintenanceTrigger } from "../maintenance/maintenanceTrigger";

export type ClockStep = 1 | 2 | 3;

const STEPS = ["Buscá tu nombre", "Tocá Marcar ingreso o salida", "Mirá a la cámara y confirmá"] as const;

/**
 * Hora → persona → acción (Etapa 2 del rediseño «Calma y certeza»). La hora
 * es la de Argentina (P1). El bloque del reloj recibe la presión larga oculta
 * del modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md) y lleva
 * el título accesible de la pantalla; no muestra ninguna señal de ese gesto.
 */
export function ClockAmbient({ now, step, online, maintenanceTrigger }: {
  now: Date;
  step: ClockStep;
  online: boolean;
  maintenanceTrigger: ReturnType<typeof useMaintenanceTrigger>;
}) {
  const clock = formatClock(now);
  return (
    <header className="kiosk-ambient">
      <div className="kiosk-top">
        <Brand />
        {online ? null : (
          <span className="kiosk-pill">
            <WifiOff size={16} strokeWidth={1.75} aria-hidden="true" />
            Sin conexión
          </span>
        )}
      </div>
      <div className="clock-heading kiosk-clock" {...maintenanceTrigger}>
        <h1 className="sr-only">Fichador de personal</h1>
        <p className="kiosk-time">
          <span className="kiosk-time-main">{clock.time}</span>
          <span className="kiosk-time-seconds" aria-hidden="true">{clock.seconds}</span>
        </p>
        <p className="kiosk-date">{formatLongDate(now)}</p>
      </div>
      <ol className="kiosk-steps" aria-label="Pasos para fichar">
        {STEPS.map((text, index) => {
          const number = index + 1;
          const state = number < step ? "is-done" : number === step ? "is-current" : "";
          return (
            <li key={text} className={state} aria-current={number === step ? "step" : undefined}>
              <span className="kiosk-step-number" aria-hidden="true">
                {number < step ? <Check size={14} strokeWidth={2.25} /> : number}
              </span>
              <span>{text}</span>
            </li>
          );
        })}
      </ol>
    </header>
  );
}
