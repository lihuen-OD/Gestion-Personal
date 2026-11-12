import { useEffect } from "react";

/**
 * Teclado virtual (iOS Safari y Chrome móvil): ninguno achica el viewport de
 * layout ni `100dvh` al abrir el teclado; sólo se achica el visualViewport.
 * Sin esta medida la página no reserva lugar para el teclado y los últimos
 * resultados de la búsqueda quedan debajo de él.
 *
 * Publica en <html> la variable CSS `--keyboard-inset`: la parte del viewport
 * de layout que tapa el teclado (0 con el teclado cerrado o en escritorio).
 * screens/kiosk.css la suma al relleno inferior del kiosco. Sólo presentación.
 */
export const KEYBOARD_INSET_VAR = "--keyboard-inset";

type ViewportLike = Pick<VisualViewport, "height" | "offsetTop" | "scale">;

export function keyboardInset(layoutHeight: number, viewport: ViewportLike | null | undefined) {
  // Con zoom de pellizco el visualViewport también se achica: no es el teclado.
  if (!viewport || viewport.scale > 1.01) return 0;
  return Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
}

export function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    const apply = () => {
      frame = 0;
      root.style.setProperty(KEYBOARD_INSET_VAR, `${keyboardInset(window.innerHeight, viewport)}px`);
    };
    // Un cálculo por cuadro: resize y scroll del visualViewport llegan en ráfagas mientras el teclado anima.
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    apply();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      root.style.removeProperty(KEYBOARD_INSET_VAR);
    };
  }, []);
}
