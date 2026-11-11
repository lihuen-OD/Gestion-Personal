import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, ArrowLeft, Clock3, MonitorSmartphone, RefreshCw, RotateCcw, Smartphone, Wrench } from "lucide-react";
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
/** Etapa 6B-4 (F6-05): desde cuántos segundos antes del vencimiento se avisa. */
export const MAINTENANCE_EXPIRY_WARNING_SECONDS = 60;
export const MAINTENANCE_EXPIRY_WARNING = "El acceso vence en menos de un minuto.";
/** Por qué se sale del panel: "expired" = el servidor dio la sesión por vencida o venció su plazo. */
export type MaintenanceExitReason = "expired";

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

/** Señal de estado junto al texto (nunca sola: el texto dice lo mismo). */
type Tone = "ok" | "warn" | "neutral";

const connectivityTone: Record<NonNullable<ClockMaintenanceDevice["connectivity"]>, Tone> = {
  ONLINE: "ok",
  OFFLINE: "warn",
  NEVER_SEEN: "neutral",
};

function Detail({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="maintenance-detail">
      <dt>{label}</dt>
      <dd>{tone ? <span className={`maintenance-dot is-${tone}`} aria-hidden="true" /> : null}{value}</dd>
    </div>
  );
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
  /** Sin motivo: salida voluntaria. "expired": venció (plazo del servidor o 401 de sesión). */
  onExit: (reason?: MaintenanceExitReason) => void;
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
  // F6-05b: el panel sale una sola vez (vencimiento, 401 o salida voluntaria),
  // aunque coincidan un clic, un tick de la cuenta y la respuesta del servidor.
  const exited = useRef(false);
  const token = access.token;
  const secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
  const ending = secondsLeft > 0 && secondsLeft <= MAINTENANCE_EXPIRY_WARNING_SECONDS;

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
  const leave = useCallback((reason?: MaintenanceExitReason) => {
    if (exited.current) return;
    exited.current = true;
    onExit(reason);
  }, [onExit]);
  /**
   * F6-05b: la cuenta en pantalla se actualiza una vez por segundo; el plazo
   * real se comprueba contra el reloj en el instante de cada acción (mismo
   * `deadline`, sin otro temporizador ni otra fuente). Vencido, la acción no se
   * ejecuta y se sale por el mismo camino del vencimiento (aviso de F6-05).
   */
  const sessionExpired = () => Date.now() >= deadline;
  useEffect(() => {
    if (secondsLeft === 0) leave("expired");
  }, [secondsLeft, leave]);

  const refresh = useCallback(async () => {
    try {
      const current = await clockMaintenanceApiService.current(token);
      if (!alive.current) return;
      const now = Date.now();
      setDevice(current.device);
      setVerifiedAt(now);
      setDeadline(now + current.expiresInSeconds * 1_000);
    } catch (refreshError) {
      if (alive.current && refreshError instanceof ApiError && refreshError.code === "CLOCK_MAINTENANCE_SESSION_INVALID") leave("expired");
      // Sin red o 5xx: queda la última verificación a la vista.
    }
  }, [token, leave]);

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
    if (sessionExpired()) {
      leave("expired");
      return;
    }
    void endSession();
    leave();
  };

  const reload = () => {
    if (exited.current) return;
    if (sessionExpired()) {
      leave("expired");
      return;
    }
    void endSession();
    reloadApp();
  };

  const reconfigure = async () => {
    if (confirmation.trim().toUpperCase() !== RECONFIGURE_CONFIRMATION_WORD || reconfiguring || exited.current) return;
    // Vencida la sesión no se inicia: ni cierre en el servidor ni borrado de la identidad local.
    if (sessionExpired()) {
      leave("expired");
      return;
    }
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

  // Foco (sólo presentación): al abrir la confirmación el botón que la abrió
  // desaparece; el foco pasa al campo de la palabra (el paso que falta) y, si
  // se cancela, vuelve a ese botón. Si el borrado local falla, vuelve al campo.
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmWasOpen = useRef(false);
  useEffect(() => {
    if (confirming) confirmInputRef.current?.focus();
    else if (confirmWasOpen.current) confirmTriggerRef.current?.focus();
    confirmWasOpen.current = confirming;
  }, [confirming]);
  useEffect(() => {
    if (reconfigureError) confirmInputRef.current?.focus();
  }, [reconfigureError]);

  const confirmed = confirmation.trim().toUpperCase() === RECONFIGURE_CONFIRMATION_WORD;
  const connectivity = device.connectivity;

  return (
    <main className="maintenance" aria-labelledby="maintenance-title">
      <div className="maintenance-bar">
        <div className="maintenance-bar-inner">
          {/* En teléfono se lee "Volver"; el nombre accesible sigue completo. */}
          <Button icon={ArrowLeft} onClick={exit} disabled={reconfiguring} className="maintenance-back">
            <span>Volver{" "}<span className="maintenance-back-long">al fichador</span></span>
          </Button>
          <div className={`maintenance-timer${ending ? " is-ending" : ""}`} role="timer" aria-live="off">
            <Clock3 aria-hidden="true" />
            <span>Se cierra en</span>
            <strong>{formatCountdown(secondsLeft)}</strong>
          </div>
          {/* F6-05: el último minuto se anuncia una sola vez (la cuenta en sí no se lee segundo a segundo). */}
          <p className="sr-only" role="status">{ending ? MAINTENANCE_EXPIRY_WARNING : ""}</p>
        </div>
      </div>

      <div className="maintenance-body">
        <header className="maintenance-head">
          <span className="maintenance-tile" aria-hidden="true"><Wrench strokeWidth={1.75} /></span>
          <div>
            <h1 id="maintenance-title">Modo mantenimiento</h1>
            <p>Uso exclusivo de RRHH. Mientras esta pantalla esté abierta no se puede fichar.</p>
          </div>
        </header>

        <div className="maintenance-groups">
          <section className="maintenance-group" aria-labelledby="maintenance-device">
            <h2 id="maintenance-device"><MonitorSmartphone aria-hidden="true" />Dispositivo</h2>
            <dl>
              <Detail label="Nombre" value={device.name || "Sin nombre"} />
              <Detail label="Estado" value="Activo" tone="ok" />
              <Detail label="Establecimiento" value={locationLabel(device)} />
              <Detail label="Conexión" value={connectivity ? connectivityLabel[connectivity] : "Sin dato"} tone={connectivity ? connectivityTone[connectivity] : undefined} />
              <Detail label="Última conexión registrada" value={device.lastSeenAt ? formatDateTime(device.lastSeenAt) : "Sin registro"} />
              <Detail label="Versión informada" value={device.lastAppVersion || "No informada"} />
              <Detail label="Aprobado el" value={device.activatedAt ? formatDateTime(device.activatedAt) : "Sin dato"} />
            </dl>
          </section>
          <section className="maintenance-group" aria-labelledby="maintenance-app">
            <h2 id="maintenance-app"><Smartphone aria-hidden="true" />Aplicación</h2>
            <dl>
              <Detail label="Versión" value={CLOCK_APP_VERSION} />
              <Detail label="Internet" value={online ? "Con conexión" : "Sin conexión"} tone={online ? "ok" : "warn"} />
              <Detail label="Modo de uso" value={isStandaloneMode() ? "Instalada en el equipo" : "Abierta en el navegador"} />
              <Detail label="Última verificación con el servidor" value={`A las ${formatTime(new Date(verifiedAt))}`} />
            </dl>
          </section>
        </div>

        <div className="maintenance-actions">
          <Button icon={RefreshCw} onClick={reload} disabled={reconfiguring}>Recargar aplicación</Button>
        </div>

        <section className="maintenance-danger" aria-labelledby="maintenance-reconfigure">
          <div className="maintenance-danger-row">
            <div>
              <h2 id="maintenance-reconfigure">Reconfigurar dispositivo</h2>
              <p>Borra la vinculación guardada en este equipo. Las fichadas y el historial no se tocan.</p>
            </div>
            {!confirming ? (
              <button ref={confirmTriggerRef} type="button" className="button subtle maintenance-danger-open" aria-label="Reconfigurar dispositivo" onClick={() => setConfirming(true)}>
                <RotateCcw aria-hidden="true" />Reconfigurar
              </button>
            ) : null}
          </div>
          {confirming ? (
            <div className="maintenance-confirm" role="alertdialog" aria-label="Confirmar reconfiguración" aria-describedby="maintenance-confirm-text">
              <div className="maintenance-confirm-text">
                <AlertTriangle aria-hidden="true" />
                <p id="maintenance-confirm-text">
                  <strong>Este dispositivo dejará de estar vinculado y deberá aprobarse nuevamente desde RRHH.</strong>
                  {" "}El registro actual va a seguir figurando en Gestión Personal hasta que RRHH lo revoque.
                </p>
              </div>
              <label>
                Escribí {RECONFIGURE_CONFIRMATION_WORD} para confirmar
                <input ref={confirmInputRef} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} disabled={reconfiguring} />
              </label>
              {reconfigureError ? <p className="error has-icon" role="alert"><AlertCircle size={20} strokeWidth={2} aria-hidden="true" /><span>{reconfigureError}</span></p> : null}
              <div className="maintenance-confirm-actions">
                <button type="button" className="button subtle" onClick={() => { setConfirming(false); setConfirmation(""); }} disabled={reconfiguring}>Cancelar</button>
                <Button variant="danger" loading={reconfiguring} aria-busy={reconfiguring || undefined} disabled={!confirmed} onClick={() => void reconfigure()}>
                  {reconfiguring ? <><span className="kiosk-spinner" aria-hidden="true" />Reconfigurando…</> : "Reconfigurar"}
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <p className="maintenance-footnote">El modo mantenimiento no bloquea el equipo. Para que nadie pueda salir del fichador se usa el modo kiosco del sistema operativo.</p>
      </div>
    </main>
  );
}
