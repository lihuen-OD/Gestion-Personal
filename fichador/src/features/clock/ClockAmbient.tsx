import { Check, WifiOff } from "lucide-react";
import { Brand } from "../../components/ui/Brand";
import { formatClock, formatLongDate } from "../../utils/date";
import type { useMaintenanceTrigger } from "../maintenance/maintenanceTrigger";

export type ClockStep = 1 | 2 | 3;

const STEPS = ["Buscá tu nombre", "Tocá Marcar ingreso o salida", "Mirá a la cámara y confirmá"] as const;

// Marcas del anillo del reloj (decorativas): se calculan una sola vez.
const RING_TICKS = Array.from({ length: 120 }, (_, index) => {
  const angle = (index / 120) * Math.PI * 2;
  const major = index % 10 === 0;
  const from = major ? 83 : 86;
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    key: index,
    major,
    x1: round(100 + from * Math.sin(angle)),
    y1: round(100 - from * Math.cos(angle)),
    x2: round(100 + 90 * Math.sin(angle)),
    y2: round(100 - 90 * Math.cos(angle)),
  };
});

/** Anillo luminoso del reloj («Biometric Future»). Decorativo: aria-hidden. */
function ClockRing({ seconds }: { seconds: number }) {
  return (
    <svg className="kiosk-dial-svg" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <circle className="kiosk-dial-outer" cx="100" cy="100" r="97" />
      <g className="kiosk-dial-ticks">
        {RING_TICKS.map((tick) => (
          <line key={tick.key} className={tick.major ? "is-major" : undefined} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
        ))}
      </g>
      <circle className="kiosk-dial-track" cx="100" cy="100" r="78" />
      {/* Segundos: el arco avanza con el reloj (atributo SVG, sin estilos en línea por la CSP). */}
      <circle className="kiosk-dial-seconds" cx="100" cy="100" r="78" pathLength={60} strokeDasharray={`${Math.max(seconds, 0.01)} 60`} transform="rotate(-90 100 100)" />
      <circle className="kiosk-dial-dot" cx="100" cy="3" r="1.6" />
      <circle className="kiosk-dial-dot" cx="197" cy="100" r="1.2" />
      <circle className="kiosk-dial-dot" cx="100" cy="197" r="1.2" />
      <circle className="kiosk-dial-dot" cx="3" cy="100" r="1.2" />
    </svg>
  );
}

/**
 * Marca, conexión, hora y pasos («Biometric Future»; la estructura viene de la
 * Etapa 2 de «Calma y certeza»). La hora es la de Argentina (P1). El bloque del
 * reloj recibe la presión larga oculta del modo mantenimiento
 * (docs/decisions/FICHADOR_MAINTENANCE_MODE.md) y lleva el título accesible de
 * la pantalla; no muestra ninguna señal de ese gesto. Devuelve piezas sueltas
 * para que la grilla de .kiosk (screens/kiosk.css) las ubique según el paso.
 */
export function ClockAmbient({ now, step, online, maintenanceTrigger }: {
  now: Date;
  step: ClockStep;
  online: boolean;
  maintenanceTrigger: ReturnType<typeof useMaintenanceTrigger>;
}) {
  const clock = formatClock(now);
  return (
    <>
      <div className="kiosk-backdrop" aria-hidden="true">
        <span className="kiosk-floor" />
      </div>
      <header className="kiosk-top">
        <Brand />
        {online ? (
          <span className="kiosk-pill is-online">
            <span className="kiosk-pill-dot" aria-hidden="true" />
            En línea
          </span>
        ) : (
          <span className="kiosk-pill is-offline">
            <WifiOff size={16} strokeWidth={1.75} aria-hidden="true" />
            Sin conexión
          </span>
        )}
      </header>
      <div className="clock-heading kiosk-clock" {...maintenanceTrigger}>
        <h1 className="sr-only">Fichador de personal</h1>
        <div className="kiosk-dial">
          <ClockRing seconds={Number(clock.seconds)} />
          {/* Arcos que giran: SVG propios para rotar con transform (compositor) sin repintar el anillo. */}
          <svg className="kiosk-dial-spin is-a" viewBox="0 0 200 200" aria-hidden="true" focusable="false"><circle cx="100" cy="100" r="94" pathLength={100} /></svg>
          <svg className="kiosk-dial-spin is-b" viewBox="0 0 200 200" aria-hidden="true" focusable="false"><circle cx="100" cy="100" r="70" pathLength={100} /></svg>
          <div className="kiosk-dial-face">
            <p className="kiosk-time">
              <span className="kiosk-time-main">{clock.time}</span>
              <span className="kiosk-time-seconds" aria-hidden="true">{clock.seconds}</span>
            </p>
            <p className="kiosk-dial-caption" aria-hidden="true">Hora de Argentina</p>
          </div>
        </div>
        <p className="kiosk-date">{formatLongDate(now)}</p>
      </div>
      <ol className="kiosk-steps" aria-label="Pasos para fichar">
        {STEPS.map((text, index) => {
          const number = index + 1;
          const state = number < step ? "is-done" : number === step ? "is-current" : "";
          return (
            <li key={text} className={state} aria-current={number === step ? "step" : undefined}>
              <span className="kiosk-step-number" aria-hidden="true">
                {number < step ? <Check size={14} strokeWidth={2.25} /> : `0${number}`}
              </span>
              <span className="kiosk-step-label">{text}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
