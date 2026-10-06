import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, MonitorSmartphone, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { ApiError, getUserErrorMessage } from "../../services/api/apiClient";
import { clockDeviceApiService, type ClockDeviceState } from "../../services/api/clockDeviceApiService";
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

export function ClockDeviceGate({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<StoredClockDeviceIdentity | null>(null);
  const [device, setDevice] = useState<ClockDeviceState | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    clockDeviceStorage.get().then(async (stored) => {
      if (!alive.current) return;
      setIdentity(stored || null);
      if (stored) {
        try { setDevice(await clockDeviceApiService.status(stored)); }
        catch (statusError) { setError(getUserErrorMessage(statusError, "No pudimos verificar este dispositivo.")); }
      }
    }).catch(() => setError("No pudimos acceder al almacenamiento seguro del dispositivo.")).finally(() => setLoading(false));
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!identity || device?.status !== "PENDING") return;
    const poll = window.setInterval(async () => {
      try {
        const next = await clockDeviceApiService.status(identity);
        setDevice(next); setError("");
      } catch (pollError) { if (pollError instanceof ApiError && pollError.code === "CLOCK_DEVICE_INVALID_CREDENTIAL") setError(pollError.message); }
    }, POLL_MS);
    return () => window.clearInterval(poll);
  }, [identity, device?.status]);

  const configure = async () => {
    setBusy(true); setError("");
    try {
      const result = await registerWithCrossTabLock();
      setIdentity(result.identity); setDevice(result.device);
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

  const reset = async () => { await clockDeviceStorage.clear(); setIdentity(null); setDevice(null); setPairing(null); setError(""); };

  if (device?.status === "ACTIVE") return <>{children}</>;

  return <main className="device-gate"><section className="device-gate-card">
    <div className={`device-gate-icon ${device?.status === "REVOKED" ? "danger" : ""}`}>{device?.status === "REVOKED" ? <ShieldAlert /> : loading ? <RefreshCw className="spin" /> : <MonitorSmartphone />}</div>
    <p className="eyebrow">FICHADOR STANDALONE</p>
    <h1>{loading ? "Verificando dispositivo" : device?.status === "PENDING" ? "Esperando aprobación" : device?.status === "REVOKED" ? "Dispositivo revocado" : "Configurar este dispositivo"}</h1>
    <p className="muted">{device?.status === "PENDING" ? "Pedile a RRHH que ingrese este código en Gestión Personal. Esta pantalla se habilitará automáticamente." : device?.status === "REVOKED" ? "RRHH revocó el acceso de este equipo. No se puede usar para fichar." : "Este equipo debe vincularse con Gestión Personal antes de mostrar el fichador."}</p>
    {!standaloneMode() && !loading ? <div className="device-policy"><WifiOff size={17} /><span>Para uso operativo, instalá la PWA en la pantalla de inicio. En desarrollo local podés continuar desde el navegador.</span></div> : null}
    {device?.status === "PENDING" && pairing ? <div className="pairing-code" aria-label={`Código ${pairing.code}`}><small>CÓDIGO DE VINCULACIÓN</small><strong>{pairing.code}</strong><span>Vence a las {new Date(pairing.expiresAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span></div> : null}
    {device?.status === "PENDING" && !pairing ? <div className="device-policy"><CheckCircle2 size={17} /><span>La identidad está guardada. Generá un código nuevo para continuar la aprobación.</span></div> : null}
    {error ? <p className="error">{error}</p> : null}
    {!loading && !identity ? <button className="button primary" disabled={busy} onClick={() => void configure()}>{busy ? "Configurando…" : "Configurar dispositivo"}</button> : null}
    {device?.status === "PENDING" ? <button className="button subtle" disabled={busy} onClick={() => void refreshPairing()}>{busy ? "Generando…" : "Generar código nuevo"}</button> : null}
    {(device?.status === "REVOKED" || (identity && error)) ? <button className="table-link" onClick={() => void reset()}>Borrar configuración local</button> : null}
  </section></main>;
}
