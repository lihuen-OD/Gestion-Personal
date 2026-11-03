import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MonitorSmartphone, RefreshCw, RotateCcw, Smartphone, Wrench } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ApiError } from "../../services/api/apiClient";
import { clockMaintenanceApiService, type ClockMaintenanceDevice } from "../../services/api/clockMaintenanceApiService";
import { CLOCK_APP_VERSION } from "../../services/api/clockDeviceSession";
import { isStandaloneMode } from "../../pwa/platform";
import { formatDateTime, formatTime } from "../../utils/date";
import type { GrantedMaintenance } from "./MaintenanceAccessDialog";

/** Cada cuánto se actualiza el diagnóstico (y se confirma la sesión) con la pantalla visible. */
export const MAINTENANCE_REFRESH_MS = 30_000;
export const RECONFIGURE_CONFIRMATION_WORD = "RECONFIGURAR";

const connectivityLabel: Record<NonNullable<ClockMaintenanceDevice["connectivity"]>, string> = {
  ONLINE: "En línea",
  OFFLINE: "Sin conexión",
  NEVER_SEEN: "Sin conexión registrada",
};

function locationLabel(device: ClockMaintenanceDevice) {
  const establishment = device.establishment;
  if (!establishment) return "Sin establecimiento";
  return establishment.zone ? `${establishment.zone.name} · ${establishment.name}` : establishment.name;
}

function formatCountdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="maintenance-detail"><dt>{label}</dt><dd>{value}</dd></div>;
}

/**
 * Modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md). Reemplaza
 * al fichador mientras dura: nadie puede fichar con esta pantalla abierta.
 *
 * - Se cierra solo al vencer. La cuenta regresiva parte de los segundos que
 *   informa el servidor (nunca de la hora absoluta del equipo) y se resincroniza
 *   en cada actualización.
 * - Un 401 de sesión (vencida o cerrada) vuelve al fichador. Un 401/403 del
 *   dispositivo (revocado) lo resuelve el Gate, que desmonta esta pantalla.
 * - Reconfigurar reutiliza el reset del Gate: borra SÓLO la identidad local
 *   del equipo; el backend no se toca (la revocación sigue siendo de RRHH).
 */
export function MaintenancePanel({ access, onExit, onReconfigure, reloadApp = () => window.location.reload() }: {
  access: GrantedMaintenance;
  onExit: () => void;
  /** true = la identidad local se borró. */
  onReconfigure: () => Promise<boolean>;
  reloadApp?: () => void;
}) {
  const [device, setDevice] = useState(access.device);
  const [verifiedAt, setVerifiedAt] = useState(access.verifiedAt);
  const [deadline, setDeadline] = useState(access.deadline);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [reconfiguring, setReconfiguring] = useState(false);
  const [reconfigureError, setReconfigureError] = useState("");
  const [, setTick] = useState(0);
  const alive = useRef(true);
  const token = access.token;
  const secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));

  const endSession = useCallback(() => clockMaintenanceApiService.end(token).catch(() => undefined), [token]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Cuenta regresiva y cierre al vencer (también si el equipo estuvo suspendido).
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (secondsLeft === 0) onExit();
  }, [secondsLeft, onExit]);

  const refresh = useCallback(async () => {
    try {
      const current = await clockMaintenanceApiService.current(token);
      if (!alive.current) return;
      const now = Date.now();
      setDevice(current.device);
      setVerifiedAt(now);
      setDeadline(now + current.expiresInSeconds * 1_000);
    } catch (refreshError) {
      if (alive.current && refreshError instanceof ApiError && refreshError.code === "CLOCK_MAINTENANCE_SESSION_INVALID") onExit();
      // Sin red o 5xx: queda la última verificación a la vista.
    }
  }, [token, onExit]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, MAINTENANCE_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onOnline = () => {
      setOnline(true);
      void refresh();
    };
    const onOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh]);

  const exit = () => {
    void endSession();
    onExit();
  };

  const reload = () => {
    void endSession();
    reloadApp();
  };

  const reconfigure = async () => {
    if (confirmation.trim().toUpperCase() !== RECONFIGURE_CONFIRMATION_WORD || reconfiguring) return;
    setReconfiguring(true);
    setReconfigureError("");
    // Sale antes del reset: el request toma la credencial en el momento.
    void endSession();
    // Si el Gate borró la identidad, esta pantalla se desmonta sola.
    if (!await onReconfigure() && alive.current) {
      setReconfiguring(false);
      setReconfigureError("No pudimos borrar la vinculación de este equipo. Intentá nuevamente.");
    }
  };

  return (
    <main className="clock-page maintenance-page">
      <section className="maintenance-panel" aria-labelledby="maintenance-title">
        <header className="maintenance-header">
          <div className="maintenance-title">
            <span className="maintenance-icon" aria-hidden="true"><Wrench /></span>
            <div>
              <p className="eyebrow">Mantenimiento</p>
              <h1 id="maintenance-title">Modo mantenimiento</h1>
              <p className="muted">Uso exclusivo de RRHH. Mientras esta pantalla esté abierta no se puede fichar.</p>
            </div>
          </div>
          <div className="maintenance-timer" role="timer" aria-live="off">
            <small>Se cierra en</small>
            <strong>{formatCountdown(secondsLeft)}</strong>
          </div>
        </header>

        <div className="maintenance-grid">
          <section className="maintenance-card" aria-labelledby="maintenance-device">
            <h2 id="maintenance-device"><MonitorSmartphone aria-hidden="true" />Dispositivo</h2>
            <dl>
              <Detail label="Nombre" value={device.name || "Sin nombre"} />
              <Detail label="Estado" value="Activo" />
              <Detail label="Establecimiento" value={locationLabel(device)} />
              <Detail label="Conexión" value={device.connectivity ? connectivityLabel[device.connectivity] : "Sin dato"} />
              <Detail label="Última conexión registrada" value={device.lastSeenAt ? formatDateTime(device.lastSeenAt) : "Sin registro"} />
              <Detail label="Versión informada" value={device.lastAppVersion || "No informada"} />
              <Detail label="Aprobado el" value={device.activatedAt ? formatDateTime(device.activatedAt) : "Sin dato"} />
            </dl>
          </section>
          <section className="maintenance-card" aria-labelledby="maintenance-app">
            <h2 id="maintenance-app"><Smartphone aria-hidden="true" />Aplicación</h2>
            <dl>
              <Detail label="Versión" value={CLOCK_APP_VERSION} />
              <Detail label="Internet" value={online ? "Con conexión" : "Sin conexión"} />
              <Detail label="Modo de uso" value={isStandaloneMode() ? "Instalada en el equipo" : "Abierta en el navegador"} />
              <Detail label="Última verificación con el servidor" value={`A las ${formatTime(new Date(verifiedAt))}`} />
            </dl>
          </section>
        </div>

        <div className="maintenance-actions">
          <Button variant="primary" icon={ArrowLeft} onClick={exit} disabled={reconfiguring}>Volver al fichador</Button>
          <Button icon={RefreshCw} onClick={reload} disabled={reconfiguring}>Recargar aplicación</Button>
        </div>

        <section className="maintenance-danger" aria-labelledby="maintenance-reconfigure">
          <div>
            <h2 id="maintenance-reconfigure">Reconfigurar dispositivo</h2>
            <p>Borra la vinculación guardada en este equipo. Las fichadas y el historial no se tocan.</p>
          </div>
          {!confirming ? <Button variant="danger" icon={RotateCcw} onClick={() => setConfirming(true)}>Reconfigurar dispositivo</Button> : null}
        </section>
        {confirming ? (
          <div className="device-confirm maintenance-confirm" role="alertdialog" aria-label="Confirmar reconfiguración">
            <p>
              <strong>Este dispositivo dejará de estar vinculado y deberá aprobarse nuevamente desde RRHH.</strong>
              El registro actual va a seguir figurando en Gestión Personal hasta que RRHH lo revoque.
            </p>
            <label>
              Escribí {RECONFIGURE_CONFIRMATION_WORD} para confirmar
              <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} disabled={reconfiguring} />
            </label>
            {reconfigureError ? <p className="error" role="alert">{reconfigureError}</p> : null}
            <div className="device-confirm-actions">
              <Button onClick={() => { setConfirming(false); setConfirmation(""); }} disabled={reconfiguring}>Cancelar</Button>
              <Button variant="danger" loading={reconfiguring} disabled={confirmation.trim().toUpperCase() !== RECONFIGURE_CONFIRMATION_WORD} onClick={() => void reconfigure()}>
                {reconfiguring ? "Reconfigurando…" : "Reconfigurar"}
              </Button>
            </div>
          </div>
        ) : null}

        <p className="maintenance-footnote">El modo mantenimiento no bloquea el equipo. Para que nadie pueda salir del fichador se usa el modo kiosco del sistema operativo.</p>
      </section>
    </main>
  );
}
