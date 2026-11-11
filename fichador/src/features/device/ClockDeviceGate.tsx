import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Clock3, KeyRound, RefreshCw, ShieldAlert, Tablet, WifiOff, type LucideIcon } from "lucide-react";
import { Brand } from "../../components/ui/Brand";
import { ApiError, getUserErrorMessage } from "../../services/api/apiClient";
import { clockDeviceApiService, type ClockDeviceState } from "../../services/api/clockDeviceApiService";
import { clockDeviceSession, type ClockDeviceAuthFailure } from "../../services/api/clockDeviceSession";
import { ClockMaintenanceMode } from "../maintenance/ClockMaintenanceMode";
import { clockDeviceStorage, type StoredClockDeviceIdentity } from "./clockDeviceStorage";
import { DeviceInstallHint, DeviceSetupChecklist } from "./DeviceSetupGuide";
import { useClockDeviceHeartbeat } from "./useClockDeviceHeartbeat";
import { useClockWakeLock } from "./useClockWakeLock";
import { formatTime } from "../../utils/date";

const POLL_MS = 7_500;
/**
 * Etapa 6B-4 (F6-06): esperas entre reintentos automáticos de la verificación
 * cuando el servidor no respondió (la última se repite). Siempre es la misma
 * consulta real al servidor que el botón "Reintentar"; volver a tener red sólo
 * adelanta el próximo intento.
 */
export const VERIFY_RETRY_DELAYS_MS: readonly number[] = [5_000, 10_000, 20_000, 30_000, 60_000];
/** F6-07: fallas seguidas de la consulta de aprobación antes de avisarlo (un corte breve no parpadea). */
export const POLL_FAILURES_BEFORE_NOTICE = 2;
export const POLL_INTERRUPTED_MESSAGE = "No pudimos consultar la aprobación. Seguimos intentando.";
export const AUTO_RETRY_MESSAGE = "Volvemos a intentar automáticamente.";
/**
 * Etapa 6B-5 (F6-08): la hora de vencimiento la da el servidor; el equipo no
 * decide si ya pasó (su reloj puede estar desajustado). Se explica qué hacer
 * si pasó, sin afirmar que el código sigue vigente ni generar otro solo.
 */
export const PAIRING_RENEW_HINT = "Si ya pasó esa hora, generá un código nuevo.";
let registrationPromise: ReturnType<typeof clockDeviceApiService.register> | null = null;

async function registerOnce() {
  registrationPromise ||= (async () => {
    const existing = await clockDeviceStorage.get();
    if (existing) return { identity: existing, device: await clockDeviceApiService.status(existing) };
    const registered = await clockDeviceApiService.register();
    await clockDeviceStorage.set(registered.identity);
    return registered;
  })().finally(() => { registrationPromise = null; });
  return registrationPromise;
}

async function registerWithCrossTabLock() {
  const locks = (navigator as Navigator & { locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> } }).locks;
  return locks ? locks.request("fichador-device-registration", registerOnce) : registerOnce();
}

const isInvalidCredential = (error: unknown) => error instanceof ApiError && error.code === "CLOCK_DEVICE_INVALID_CREDENTIAL";
/** Una respuesta sólo vale para la identidad que la pidió (p. ej. no después de reconfigurar). */
const sameIdentity = (a: StoredClockDeviceIdentity | null, b: StoredClockDeviceIdentity) => a !== null && a.id === b.id && a.secret === b.secret;
/** 429 con espera informada por el backend: hasta cuándo no consultar. */
const retryAfterDeadline = (error: unknown) => (error instanceof ApiError && error.retryAfterSeconds ? Date.now() + error.retryAfterSeconds * 1_000 : 0);

/**
 * Único dueño de la identidad del equipo. Sólo con el backend confirmando
 * ACTIVE abre la sesión operativa (clockDeviceSession) y muestra el fichador.
 * Si en medio de la operación el backend rechaza la credencial (RRHH revocó
 * el equipo, la identidad dejó de existir), la sesión ya quedó cerrada y acá
 * se desmonta el fichador: no quedan empleados en pantalla ni fichadas que
 * reintentar. La identidad local sólo se borra con confirmación explícita,
 * nunca ante un error de red o del servidor.
 */
export function ClockDeviceGate({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<StoredClockDeviceIdentity | null>(null);
  const [device, setDevice] = useState<ClockDeviceState | null>(null);
  const [credentialLost, setCredentialLost] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const identityRef = useRef<StoredClockDeviceIdentity | null>(null);
  // F6-07: fallas seguidas de la consulta de aprobación (se avisa desde POLL_FAILURES_BEFORE_NOTICE).
  const [pollFailures, setPollFailures] = useState(0);
  // F6-06/F6-07: no consultar antes de lo que pidió el backend con un 429.
  const quietUntil = useRef(0);
  // F6-06: fallas seguidas de la verificación. Cada falla cambia el valor (y
  // reprograma el próximo intento) aunque el error repita el mismo texto.
  const [verifyFailures, setVerifyFailures] = useState(0);
  const verifyInFlight = useRef(false);

  // La sesión operativa se abre en el mismo paso que el estado ACTIVE, antes
  // de que el fichador se monte, y se cierra con cualquier otro estado.
  const applyDevice = useCallback((owner: StoredClockDeviceIdentity, next: ClockDeviceState) => {
    if (next.status === "ACTIVE") clockDeviceSession.start(owner);
    else clockDeviceSession.end();
    setDevice(next);
    setCredentialLost(false);
    setError("");
    setPollFailures(0);
    setVerifyFailures(0);
  }, []);

  const verify = useCallback(async (owner: StoredClockDeviceIdentity) => {
    try {
      const next = await clockDeviceApiService.status(owner);
      if (alive.current && sameIdentity(identityRef.current, owner)) applyDevice(owner, next);
    } catch (statusError) {
      if (!alive.current || !sameIdentity(identityRef.current, owner)) return;
      clockDeviceSession.end();
      quietUntil.current = retryAfterDeadline(statusError);
      if (isInvalidCredential(statusError)) { setDevice(null); setCredentialLost(true); }
      else {
        setError(getUserErrorMessage(statusError, "No pudimos verificar este dispositivo."));
        setVerifyFailures((failures) => failures + 1);
      }
    }
  }, [applyDevice]);

  useEffect(() => {
    alive.current = true;
    clockDeviceStorage.get().then(async (stored) => {
      if (!alive.current) return;
      identityRef.current = stored || null;
      setIdentity(stored || null);
      if (stored) await verify(stored);
    }).catch(() => setError("No pudimos acceder al almacenamiento seguro del dispositivo.")).finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; clockDeviceSession.end(); };
  }, [verify]);

  useEffect(() => clockDeviceSession.onAuthFailure((failure: ClockDeviceAuthFailure) => {
    if (failure === "CLOCK_DEVICE_REVOKED") setDevice((current) => (current ? { ...current, status: "REVOKED" } : current));
    else if (failure === "CLOCK_DEVICE_INVALID_CREDENTIAL") { setDevice(null); setCredentialLost(true); }
    else {
      // NOT_ACTIVE no debería pasar después de ACTIVE (REVOKED es terminal):
      // se bloquea igual y se le pregunta al backend el estado real.
      setDevice(null);
      if (identityRef.current) void verify(identityRef.current);
    }
  }), [verify]);

  // Espera de aprobación: la consulta periódica habilita el fichador sólo
  // cuando el servidor responde ACTIVE. F6-07: de a una por vez, respeta el
  // 429, cuenta las fallas (para avisarlas) y, al volver la red, consulta en
  // el acto. Una respuesta de otra identidad (reconfigurado) no se aplica.
  useEffect(() => {
    if (!identity || device?.status !== "PENDING") return undefined;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || Date.now() < quietUntil.current) return;
      inFlight = true;
      try {
        const next = await clockDeviceApiService.status(identity);
        if (alive.current && sameIdentity(identityRef.current, identity)) applyDevice(identity, next);
      } catch (pollError) {
        if (!alive.current || !sameIdentity(identityRef.current, identity)) return;
        if (isInvalidCredential(pollError)) { setDevice(null); setCredentialLost(true); return; }
        quietUntil.current = retryAfterDeadline(pollError);
        setPollFailures((failures) => failures + 1);
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onOnline = () => void poll();
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [identity, device?.status, applyDevice]);

  // F9: con la sesión operativa abierta (ACTIVE) el equipo avisa que sigue
  // conectado. F10: mientras tanto también mantiene la pantalla encendida.
  // PENDING, REVOKED o credencial perdida: ni heartbeat ni bloqueo de pantalla
  // (al revocarse se liberan los dos).
  const operational = device?.status === "ACTIVE" && !credentialLost;
  useClockDeviceHeartbeat(operational);
  useClockWakeLock(operational);

  const configure = async () => {
    setBusy(true); setError("");
    try {
      const result = await registerWithCrossTabLock();
      identityRef.current = result.identity;
      setIdentity(result.identity);
      applyDevice(result.identity, result.device);
      if (result.device.pairingCode && result.device.pairingExpiresAt) setPairing({ code: result.device.pairingCode, expiresAt: result.device.pairingExpiresAt });
    } catch (registerError) { setError(getUserErrorMessage(registerError, "No pudimos configurar el dispositivo.")); }
    finally { setBusy(false); }
  };

  const refreshPairing = async () => {
    if (!identity) return;
    setBusy(true); setError("");
    try { const result = await clockDeviceApiService.refreshPairing(identity); setPairing({ code: result.pairingCode, expiresAt: result.pairingExpiresAt }); }
    catch (refreshError) { setError(getUserErrorMessage(refreshError, "No pudimos generar un código nuevo.")); }
    finally { setBusy(false); }
  };

  const retry = async () => {
    if (!identity || verifyInFlight.current) return;
    verifyInFlight.current = true;
    setBusy(true); setError("");
    try { await verify(identity); } finally { verifyInFlight.current = false; if (alive.current) setBusy(false); }
  };

  // F6-06: sin respuesta del servidor ("No pudimos verificar"), se reintenta
  // solo con espera creciente y, si vuelve la red, en el acto. Es el mismo
  // `retry` del botón (consulta real, sin registrar nada nuevo); el resultado
  // lo decide el servidor (ACTIVE, PENDING, REVOKED o credencial inválida).
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const awaitingRetry = Boolean(identity && !device && !credentialLost && !loading && error && !busy);
  useEffect(() => {
    if (!awaitingRetry) return undefined;
    const backoff = VERIFY_RETRY_DELAYS_MS[Math.min(Math.max(verifyFailures - 1, 0), VERIFY_RETRY_DELAYS_MS.length - 1)]!;
    const timer = window.setTimeout(() => void retryRef.current(), Math.max(backoff, quietUntil.current - Date.now()));
    const onOnline = () => {
      if (Date.now() >= quietUntil.current) void retryRef.current();
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [awaitingRetry, verifyFailures]);

  // Borra SÓLO la identidad local (IndexedDB) y cierra la sesión en memoria; el
  // backend no se toca. true = borrada (lo usa también el modo mantenimiento).
  const reset = async () => {
    setBusy(true);
    try {
      await clockDeviceStorage.clear();
      clockDeviceSession.end();
      identityRef.current = null;
      setIdentity(null); setDevice(null); setPairing(null); setCredentialLost(false); setConfirmingReset(false); setError("");
      return true;
    } catch {
      setError("No pudimos borrar la configuración local. Intentá nuevamente.");
      return false;
    } finally { setBusy(false); }
  };

  // Foco (sólo presentación): al abrir la confirmación el botón que la abrió
  // desaparece; el foco pasa a "Cancelar" (la opción segura) y, si se cancela,
  // vuelve al botón que la abrió.
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmWasOpen = useRef(false);
  useEffect(() => {
    if (confirmingReset) confirmCancelRef.current?.focus();
    else if (confirmWasOpen.current) resetTriggerRef.current?.focus();
    confirmWasOpen.current = confirmingReset;
  }, [confirmingReset]);

  // Modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md): sólo con
  // la sesión operativa abierta. Revocar o perder la credencial lo desmonta.
  if (device?.status === "ACTIVE" && !credentialLost) return <ClockMaintenanceMode onReconfigure={reset}>{children}</ClockMaintenanceMode>;

  const revoked = device?.status === "REVOKED";
  const pending = device?.status === "PENDING";
  // Hay identidad guardada pero todavía no hay un estado confirmado por el
  // servidor: al abrir, mientras se reintenta o tras NOT_ACTIVE. Nunca se
  // muestra como "configurar" (la identidad existe) ni como habilitado.
  const unverified = Boolean(identity && !device && !credentialLost);
  // El reintento en curso conserva la pantalla de error con "Verificando…".
  const transientError = unverified && Boolean(error || busy);
  const verifying = loading || (unverified && !transientError);
  const setup = !verifying && !identity;
  const danger = revoked || credentialLost;
  const view = verifying ? GATE_VIEWS.verifying
    : revoked ? GATE_VIEWS.revoked
      : credentialLost ? GATE_VIEWS.lost
        : pending ? (pairing ? GATE_VIEWS.pending : GATE_VIEWS.pendingWithoutCode)
          : transientError ? GATE_VIEWS.transient
            : GATE_VIEWS.setup;

  const busyLabel = (text: string) => <><span className="kiosk-spinner" aria-hidden="true" />{text}</>;

  return <div className="device-gate">
    <header className="device-gate-top"><Brand /></header>
    <main className={`device-gate-body${verifying ? " is-single" : ""}`} aria-labelledby="device-gate-title">
      <div className="device-gate-lead">
        <span className={`device-gate-tile ${view.tone}`} aria-hidden="true">{verifying ? <span className="kiosk-spinner device-gate-tile-spinner" /> : <view.Icon strokeWidth={1.75} />}</span>
        <h1 id="device-gate-title">{view.title}</h1>
        <p className="device-gate-desc" role={verifying ? "status" : undefined}>{view.description}</p>
      </div>

      {verifying ? null : <div className="device-gate-main">
        {pending && pairing ? <section className="pairing" aria-labelledby="pairing-label">
          <p id="pairing-label" className="pairing-label">Código de vinculación</p>
          {/* El lector de pantalla recibe el código deletreado; la vista, en casillas. */}
          <p className="sr-only">{spellPairingCode(pairing.code)}</p>
          <p className="pairing-code" aria-hidden="true">{pairingCodeParts(pairing.code)}</p>
          <p className="pairing-expiry"><Clock3 size={16} strokeWidth={2} aria-hidden="true" />Vence a las {formatTime(pairing.expiresAt)}</p>
          <p className="pairing-renew">{PAIRING_RENEW_HINT}</p>
        </section> : null}
        {pending && !pairing ? <div className="device-gate-note" role="note"><KeyRound size={20} strokeWidth={1.75} aria-hidden="true" /><p>La identidad está guardada. Generá un código nuevo para continuar la aprobación.</p></div> : null}
        {/* La aprobación llega por la consulta periódica que ya hace el Gate. */}
        {pending && pollFailures < POLL_FAILURES_BEFORE_NOTICE ? <p className="device-gate-waiting" role="status"><span className="device-gate-waiting-dot" aria-hidden="true" />Se habilita sola cuando RRHH lo apruebe</p> : null}
        {/* F6-07: la consulta falló varias veces seguidas; el código y la espera se conservan. */}
        {pending && pollFailures >= POLL_FAILURES_BEFORE_NOTICE ? <p className="device-gate-waiting is-interrupted" role="status"><WifiOff size={16} strokeWidth={2} aria-hidden="true" />{POLL_INTERRUPTED_MESSAGE}</p> : null}
        {/* F6-06: el reintento automático corre solo; el botón queda para adelantarlo. */}
        {transientError ? <p className="device-gate-waiting" role="status"><span className="device-gate-waiting-dot" aria-hidden="true" />{AUTO_RETRY_MESSAGE}</p> : null}

        <div className="device-gate-stack">
          {/* F10: instalar antes de configurar (la configuración del navegador no pasa al ícono en iOS). */}
          {setup ? <DeviceInstallHint stage="setup" /> : null}
          {error ? <p className="error device-gate-error" role="alert"><AlertCircle size={20} strokeWidth={2} aria-hidden="true" /><span>{error}</span></p> : null}
          {setup ? <button className="button primary device-gate-action" disabled={busy} aria-busy={busy || undefined} onClick={() => void configure()}>{busy ? busyLabel("Configurando…") : "Configurar dispositivo"}</button> : null}
          {setup ? <DeviceSetupChecklist /> : null}
          {pending ? <button className={`button ${pairing ? "subtle" : "primary"} device-gate-action`} disabled={busy} aria-busy={busy || undefined} onClick={() => void refreshPairing()}>{busy ? busyLabel("Generando…") : <><RefreshCw aria-hidden="true" />Generar código nuevo</>}</button> : null}
          {pending ? <DeviceInstallHint stage="pending" /> : null}
          {transientError ? <button className="button primary device-gate-action" disabled={busy} aria-busy={busy || undefined} onClick={() => void retry()}>{busy ? busyLabel("Verificando…") : "Reintentar"}</button> : null}
          {danger && !confirmingReset ? <button ref={resetTriggerRef} className="button subtle device-gate-action" onClick={() => setConfirmingReset(true)}>{revoked ? "Configurar como nuevo dispositivo" : "Reconfigurar dispositivo"}</button> : null}
          {danger && confirmingReset ? <div className="device-confirm" role="alertdialog" aria-label="Confirmar reconfiguración" aria-describedby="device-confirm-text">
            <p id="device-confirm-text"><strong>¿Borrar la configuración de este equipo?</strong> Se elimina la identidad guardada y vas a tener que generar un código nuevo para que RRHH lo apruebe otra vez.</p>
            <div className="device-confirm-actions">
              <button ref={confirmCancelRef} className="button subtle" disabled={busy} onClick={() => setConfirmingReset(false)}>Cancelar</button>
              <button className="button danger" disabled={busy} aria-busy={busy || undefined} onClick={() => void reset()}>{busy ? busyLabel("Borrando…") : "Borrar y configurar"}</button>
            </div>
          </div> : null}
        </div>
      </div>}
    </main>
  </div>;
}

type GateView = { title: string; description: string; Icon: LucideIcon; tone: "" | "is-danger" | "is-neutral" };

/** Textos e íconos de cada estado del Gate (el estado lo decide el servidor). */
const GATE_VIEWS = {
  verifying: { title: "Verificando dispositivo", description: "Un momento.", Icon: Tablet, tone: "is-neutral" },
  setup: { title: "Configurar este dispositivo", description: "Este equipo debe vincularse con Gestión Personal antes de mostrar el fichador.", Icon: Tablet, tone: "" },
  pending: { title: "Esperando aprobación", description: "Pedile a RRHH que ingrese este código en Gestión Personal.", Icon: Tablet, tone: "" },
  pendingWithoutCode: { title: "Esperando aprobación", description: "Este equipo ya está registrado y espera la aprobación de RRHH.", Icon: Tablet, tone: "" },
  transient: { title: "No pudimos verificar el dispositivo", description: "Revisá la conexión a Internet. La configuración de este equipo se conserva.", Icon: WifiOff, tone: "is-neutral" },
  revoked: { title: "Dispositivo deshabilitado", description: "Este dispositivo fue deshabilitado por RRHH. No se puede usar para fichar.", Icon: ShieldAlert, tone: "is-danger" },
  lost: { title: "Autorización perdida", description: "Este dispositivo perdió su autorización. Volvé a configurarlo.", Icon: KeyRound, tone: "is-danger" },
} satisfies Record<string, GateView>;

/** Casillas del código tal como lo emite el backend ("ABCD-2345"): un carácter por casilla, el guion como separador. */
function pairingCodeParts(code: string) {
  return Array.from(code).map((char, index) => (char === "-"
    ? <span key={index} className="pairing-sep">-</span>
    : <span key={index} className="pairing-char">{char}</span>));
}

/** "ABCD-2345" → "A B C D, 2 3 4 5": se lee carácter por carácter. */
function spellPairingCode(code: string) {
  return code.split("-").map((group) => Array.from(group).join(" ")).join(", ");
}
