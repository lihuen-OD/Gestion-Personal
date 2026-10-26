import { useCallback, useEffect, useMemo, useRef, type MouseEvent, type PointerEvent } from "react";

/** Desplazamiento que cancela la presión: un dedo que arrastra está desplazando, no esperando. */
const MOVE_TOLERANCE_PX = 10;

/**
 * Presión sostenida con dedo, mouse o lápiz (Pointer Events). Dispara una sola
 * vez si se mantiene `durationMs` sin soltar ni mover; soltar, salir del
 * elemento, cancelar (el navegador toma el gesto) o deshabilitarlo la corta.
 * No da señal visual: el modo mantenimiento no se anuncia a quien ficha.
 */
export function useLongPress(onLongPress: () => void, { durationMs, enabled = true }: { durationMs: number; enabled?: boolean }) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const callback = useRef(onLongPress);
  useEffect(() => {
    callback.current = onLongPress;
  }, [onLongPress]);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = null;
  }, []);

  // Desmontar o deshabilitar en medio de una presión nunca dispara después.
  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);

  return useMemo(() => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!enabled || (event.pointerType === "mouse" && event.button !== 0)) return;
      cancel();
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        origin.current = null;
        callback.current();
      }, durationMs);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = origin.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    // Una presión larga en touch abre el menú contextual del navegador.
    onContextMenu(event: MouseEvent<HTMLElement>) {
      event.preventDefault();
    },
  }), [enabled, durationMs, cancel]);
}
