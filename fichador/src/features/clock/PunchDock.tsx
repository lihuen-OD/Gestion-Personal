import type { ReactNode } from "react";
import { AlertCircle, Camera, CameraOff, Clock3, LogIn, LogOut, WifiOff, type LucideIcon } from "lucide-react";
import { Button } from "../../components/ui/Button";

export type NoticeTone = "neutral" | "warn" | "danger";

const NOTICE_ICONS: Record<"error" | "offline" | "unconfirmed" | "paused", LucideIcon> = {
  error: AlertCircle,
  offline: WifiOff,
  unconfirmed: Clock3,
  paused: CameraOff,
};

/** Aviso junto a la acción: siempre a la vista, en el mismo lugar. */
export function DockNotice({ tone, icon, role, children }: { tone: NoticeTone; icon: keyof typeof NOTICE_ICONS; role: "alert" | "status"; children: ReactNode }) {
  const Icon = NOTICE_ICONS[icon];
  return (
    <div className={`kiosk-notice tone-${tone}`} role={role}>
      <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

/**
 * Espera entre fichadas: aviso informativo (no es un error) con un anillo que
 * se vacía. La cuenta y su texto salen de TimeClockPage, sin consultar al backend.
 */
export function CooldownNotice({ secondsLeft, totalSeconds }: { secondsLeft: number; totalSeconds: number }) {
  const circumference = 2 * Math.PI * 9;
  const offset = circumference * (1 - secondsLeft / Math.max(1, totalSeconds));
  return (
    <div className="kiosk-notice tone-warn" role="status">
      <svg className="kiosk-ring" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle className="kiosk-ring-track" cx="11" cy="11" r="9" />
        <circle className="kiosk-ring-bar" cx="11" cy="11" r="9" strokeDasharray={circumference.toFixed(2)} strokeDashoffset={offset.toFixed(2)} />
      </svg>
      <div>
        <strong>Ya registraste una fichada hace unos segundos.</strong>
        <p role="timer" aria-live="off">Podés volver a intentar en {secondsLeft} s.</p>
      </div>
    </div>
  );
}

/**
 * Paso 2 → 3: una única acción, la que corresponde al estado real del legajo.
 * Ingreso en azul, salida en grafito. Qué acción y si está habilitada lo
 * decide TimeClockPage (canClockIn/canClockOut); acá sólo se presenta.
 */
export function PunchDock({ notice, punchType, label, enabled, statusLoading, onPunch }: {
  notice: ReactNode;
  punchType: "IN" | "OUT";
  label: string;
  enabled: boolean;
  statusLoading: boolean;
  onPunch: () => void;
}) {
  const exit = punchType === "OUT";
  return (
    <div className="kiosk-dock">
      {notice}
      <Button variant="primary" className={`kiosk-action ${exit ? "is-exit" : "is-entry"}`} icon={exit ? LogOut : LogIn} disabled={!enabled} onClick={onPunch}>
        {label}
      </Button>
      {statusLoading ? (
        <p className="kiosk-caption"><span className="kiosk-spinner is-small" aria-hidden="true" />Consultando tu estado…</p>
      ) : enabled ? (
        <p className="kiosk-caption"><Camera size={16} strokeWidth={1.75} aria-hidden="true" />Vas a confirmar con una foto.</p>
      ) : null}
    </div>
  );
}
