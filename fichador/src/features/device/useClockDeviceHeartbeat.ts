import { useEffect } from "react";
import { ApiError } from "../../services/api/apiClient";
import { isClockDeviceAuthFailure } from "../../services/api/clockDeviceSession";
import { timeClockApiService } from "../../services/api/timeClockApiService";

/** F9: cada cuánto avisa el equipo que sigue encendido y conectado. */
export const HEARTBEAT_INTERVAL_MS = 60_000;
/**
 * Separación mínima entre dos heartbeats: volver a primer plano justo después
 * de un tick (o un tick justo después de volver) no manda una ráfaga.
 */
export const HEARTBEAT_MIN_GAP_MS = 15_000;

/**
 * F9 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §28): heartbeat del
 * dispositivo. Lo monta ClockDeviceGate sólo con el equipo ACTIVE y la sesión
 * abierta; no tiene UI.
 *
 * - Uno al habilitarse, uno por minuto y uno al volver a primer plano: iOS
 *   suspende el JS de una PWA en segundo plano, así que el intervalo no es
 *   confiable y el estado "en línea" del panel es best-effort.
 * - Nunca dos a la vez, y corre independiente de la fichada: no la bloquea ni
 *   toca su requestId.
 * - Error de red, timeout, 5xx o 429: silencio. El panel lo verá "sin
 *   conexión" y la fichada sin red ya está bloqueada por su propio flujo (F8).
 * - 401/403 del dispositivo: clockDeviceRequest ya cerró la sesión y avisó al
 *   Gate (F6), que desmonta el fichador. Acá sólo se deja de mandar.
 * - `serverTime` llega pero no ajusta ningún reloj: el del equipo nunca es
 *   autoridad y la hora oficial de una fichada ya la da el backend (F8).
 */
export function useClockDeviceHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let inFlight = false;
    let lastSentAt = Number.NEGATIVE_INFINITY;
    let timer = 0;

    const stop = () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };

    const send = async () => {
      if (stopped || inFlight || Date.now() - lastSentAt < HEARTBEAT_MIN_GAP_MS) return;
      inFlight = true;
      lastSentAt = Date.now();
      try {
        await timeClockApiService.heartbeat();
      } catch (error) {
        if (isClockDeviceAuthFailure(error) || (error instanceof ApiError && error.code === "CLOCK_DEVICE_SESSION_MISSING")) stop();
      } finally {
        inFlight = false;
      }
    };

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void send();
    }

    timer = window.setInterval(() => void send(), HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void send();
    return stop;
  }, [enabled]);
}
