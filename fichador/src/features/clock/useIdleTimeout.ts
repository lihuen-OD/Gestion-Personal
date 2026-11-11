import { useEffect, useRef } from "react";

/**
 * Interacciones reales de quien usa el kiosco: tocar o hacer clic, teclear y
 * cambiar un campo. No cuentan el movimiento del puntero, el foco, el reloj,
 * las respuestas de la API, la detección del rostro ni los re-renderizados:
 * ninguno dispara estos eventos (y el fichador nunca los despacha por código).
 */
export const ACTIVITY_EVENTS = ["pointerdown", "keydown", "input", "change", "click"] as const;

/**
 * Etapa 6B-3 (AUDITORIA_6A F6-03 / P2): llama a `onIdle` cuando pasan
 * `timeoutMs` sin interacción real mientras `enabled` sea true. Cada
 * interacción reinicia el plazo; deshabilitarlo o desmontar lo cancela.
 *
 * El plazo se mide contra el reloj: si el sistema congeló los temporizadores
 * (pantalla bloqueada, app en segundo plano), al volver a primer plano se
 * resuelve en el acto con el tiempo realmente transcurrido.
 */
export function useIdleTimeout(enabled: boolean, timeoutMs: number, onIdle: () => void) {
  const callback = useRef(onIdle);
  useEffect(() => {
    callback.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return undefined;
    let timer = 0;
    let deadline = 0;
    const fire = () => {
      timer = 0;
      callback.current();
    };
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fire, Math.max(0, ms));
    };
    const restart = () => {
      deadline = Date.now() + timeoutMs;
      schedule(timeoutMs);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && timer) schedule(deadline - Date.now());
    };
    restart();
    for (const type of ACTIVITY_EVENTS) document.addEventListener(type, restart, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS) document.removeEventListener(type, restart, { capture: true });
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, timeoutMs]);
}
