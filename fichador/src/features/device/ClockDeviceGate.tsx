import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, KeyRound, MonitorSmartphone, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { ApiError, getUserErrorMessage } from "../../services/api/apiClient";
import { clockDeviceApiService, type ClockDeviceState } from "../../services/api/clockDeviceApiService";
import { clockDeviceSession, type ClockDeviceAuthFailure } from "../../services/api/clockDeviceSession";
import { clockDeviceStorage, type StoredClockDeviceIdentity } from "./clockDeviceStorage";

const POLL_MS = 7_500;
let registrationPromise: ReturnType<typeof clockDeviceApiService.register> | null = null;

function standaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

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

  // La sesión operativa se abre en el mismo paso que el estado ACTIVE, antes
  // de que el fichador se monte, y se cierra con cualquier otro estado.
  const applyDevice = useCallback((owner: StoredClockDeviceIdentity, next: ClockDeviceState) => {
    if (next.status === "ACTIVE") clockDeviceSession.start(owner);
    else clockDeviceSession.end();
    setDevice(next);
    setCredentialLost(false);
    setError("");
  }, []);

  const verify = useCallback(async (owner: StoredClockDeviceIdentity) => {
    try {
      const next = await clockDeviceApiService.status(owner);
      if (alive.current) applyDevice(owner, next);
    } catch (statusError) {
      if (!alive.current) return;
      clockDeviceSession.end();
      if (isInvalidCredential(statusError)) { setDevice(null); setCredentialLost(true); }
      else setError(getUserErrorMessage(statusError, "No pudimos verificar este dispositivo."));
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

  useEffect(() => {
    if (!identity || device?.status !== "PENDING") return;
    const poll = window.setInterval(async () => {
      try { applyDevice(identity, await clockDeviceApiService.status(identity)); }
      catch (pollError) { if (isInvalidCredential(pollError)) { setDevice(null); setCredentialLost(true); } }
    }, POLL_MS);
    return () => window.clearInterval(poll);
  }, [identity, device?.status, applyDevice]);

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
    if (!identity) return;
    setBusy(true); setError("");
    try { await verify(identity); } finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await clockDeviceStorage.clear();
      clockDeviceSession.end();
      identityRef.current = null;
      setIdentity(null); setDevice(null); setPairing(null); setCredentialLost(false); setConfirmingReset(false); setError("");
    } catch { setError("No pudimos borrar la configuración local. Intentá nuevamente."); }
    finally { setBusy(false); }
  };

  if (device?.status === "ACTIVE" && !credentialLost) return <>{children}</>;

  const revoked = device?.status === "REVOKED";
  const pending = device?.status === "PENDING";
  const transientError = Boolean(identity && error && !device && !credentialLost);
  const title = loading ? "Verificando dispositivo"
    : revoked ? "Dispositivo deshabilitado"
      : credentialLost ? "Autorización perdida"
        : pending ? "Esperando aprobación"
          : transientError ? "No pudimos verificar el dispositivo"
            : "Configurar este dispositivo";
  const description = revoked ? "Este dispositivo fue deshabilitado por RRHH. No se puede usar para fichar."
    : credentialLost ? "Este dispositivo perdió su autorización. Volvé a configurarlo."
      : pending ? "Pedile a RRHH que ingrese este código en Gestión Personal. Esta pantalla se habilitará automáticamente."
        : transientError ? "Revisá la conexión a Internet. La configuración de este equipo se conserva."
          : "Este equipo debe vincularse con Gestión Personal antes de mostrar el fichador.";
  const danger = revoked || credentialLost;

  return <main className="device-gate"><section className="device-gate-card">
    <div className={`device-gate-icon ${danger ? "danger" : ""}`}>{revoked ? <ShieldAlert /> : credentialLost ? <KeyRound /> : loading ? <RefreshCw className="spin" /> : <MonitorSmartphone />}</div>
    <p className="eyebrow">FICHADOR STANDALONE</p>
    <h1>{title}</h1>
    <p className="muted">{description}</p>
    {!standaloneMode() && !loading && !danger ? <div className="device-policy"><WifiOff size={17} /><span>Para uso operativo, instalá la PWA en la pantalla de inicio. En desarrollo local podés continuar desde el navegador.</span></div> : null}
    {pending && pairing ? <div className="pairing-code" aria-label={`Código ${pairing.code}`}><small>CÓDIGO DE VINCULACIÓN</small><strong>{pairing.code}</strong><span>Vence a las {new Date(pairing.expiresAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span></div> : null}
    {pending && !pairing ? <div className="device-policy"><CheckCircle2 size={17} /><span>La identidad está guardada. Generá un código nuevo para continuar la aprobación.</span></div> : null}
    {error ? <p className="error">{error}</p> : null}
    {!loading && !identity ? <button className="button primary" disabled={busy} onClick={() => void configure()}>{busy ? "Configurando…" : "Configurar dispositivo"}</button> : null}
    {pending ? <button className="button subtle" disabled={busy} onClick={() => void refreshPairing()}>{busy ? "Generando…" : "Generar código nuevo"}</button> : null}
    {transientError ? <button className="button primary" disabled={busy} onClick={() => void retry()}>{busy ? "Verificando…" : "Reintentar"}</button> : null}
    {danger && !confirmingReset ? <button className="button subtle" onClick={() => setConfirmingReset(true)}>{revoked ? "Configurar como nuevo dispositivo" : "Reconfigurar dispositivo"}</button> : null}
    {danger && confirmingReset ? <div className="device-confirm" role="alertdialog" aria-label="Confirmar reconfiguración">
      <p><strong>¿Borrar la configuración de este equipo?</strong> Se elimina la identidad guardada y vas a tener que generar un código nuevo para que RRHH lo apruebe otra vez.</p>
      <div className="device-confirm-actions">
        <button className="button subtle" disabled={busy} onClick={() => setConfirmingReset(false)}>Cancelar</button>
        <button className="button danger" disabled={busy} onClick={() => void reset()}>{busy ? "Borrando…" : "Borrar y configurar"}</button>
      </div>
    </div> : null}
  </section></main>;
}
