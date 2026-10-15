import { useEffect } from "react";

type ScreenWakeLockSentinel = { released: boolean; release: () => Promise<void>; addEventListener: (type: "release", listener: () => void) => void };
type ScreenWakeLock = { request: (type: "screen") => Promise<ScreenWakeLockSentinel> };

/**
 * F10 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §29): mantiene la
 * pantalla encendida mientras el fichador opera. Lo monta ClockDeviceGate con
 * la misma condición que el heartbeat (ACTIVE y sesión abierta); no tiene UI.
 *
 * Best-effort:
 * - Sin la API (navegadores viejos): no hace nada.
 * - Rechazado (batería baja, política del sistema): no reintenta en loop ni
 *   muestra errores; se vuelve a pedir la próxima vez que la app quede visible.
 * - El sistema libera el bloqueo al pasar a segundo plano (iOS siempre); al
 *   volver a primer plano se pide de nuevo.
 * - Nunca hay dos bloqueos a la vez; al deshabilitarse o desmontar se libera.
 *
 * Mantener la pantalla activa NO mantiene la cámara abierta: la cámara sólo se
 * usa durante una fichada.
 */
export function useClockWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return undefined;
    const wakeLock = (navigator as Navigator & { wakeLock?: ScreenWakeLock }).wakeLock;
    if (!wakeLock || typeof wakeLock.request !== "function") return undefined;

    let stopped = false;
    let pending = false;
    let sentinel: ScreenWakeLockSentinel | null = null;

    const acquire = async () => {
      if (stopped || pending || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      pending = true;
      try {
        const next = await wakeLock.request("screen");
        if (stopped) {
          await next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
        next.addEventListener("release", () => {
          if (sentinel === next) sentinel = null;
        });
      } catch (error) {
        if (import.meta.env.DEV) console.info("CLOCK_WAKE_LOCK_UNAVAILABLE", error instanceof Error ? error.name : "unknown");
      } finally {
        pending = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void acquire();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const current = sentinel;
      sentinel = null;
      void current?.release().catch(() => undefined);
    };
  }, [enabled]);
}
