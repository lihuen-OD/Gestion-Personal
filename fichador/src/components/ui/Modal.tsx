import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Copia de frontend/src/components/ui/Modal.tsx (mismo markup y clases). El
// portal a document.body se conserva: el backdrop `position: fixed` cubre
// todo el viewport sin depender de los contenedores de la página.
// `className` (opcional) va en el backdrop: permite una composición propia por
// pantalla (p. ej. la captura facial, Etapa 3) sin tocar las demás.
//
// Etapa 6B-2 (AUDITORIA_6A F6-04 / P4) — diálogo modal accesible:
// - Foco inicial dentro del diálogo: el control con `data-autofocus` (la
//   opción segura que elige cada diálogo), si no el primero disponible, si no
//   el propio diálogo.
// - Tab y Shift+Tab recorren sólo los controles disponibles del diálogo; la
//   lista se calcula en cada pulsación (controles que aparecen, desaparecen o
//   se deshabilitan).
// - El resto de la página queda `inert` mientras está abierto: ni teclado, ni
//   toques, ni lectores de pantalla llegan al fondo.
// - Escape hace lo mismo que "Cerrar", con la misma política: con
//   `closeDisabled` (una fichada enviándose, un código verificándose) no cierra.
//   No hay cierre por toque fuera del diálogo.
// - Al cerrar, el foco vuelve al control que lo abrió si sigue disponible; si
//   no, a `returnFocus()`; si tampoco, no se enfoca nada (p. ej. el Gate ya
//   reemplazó la pantalla).
// Sin bloqueos de scroll: el fondo inerte no recibe interacción y el backdrop
// ya se desplaza solo cuando el diálogo no entra.

const TABBABLE = "a[href], button, input:not([type='hidden']), select, textarea, summary, [tabindex]";

function isAvailable(element: HTMLElement) {
  if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[inert], [hidden]")) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

const tabbables = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(isAvailable);

function canReceiveFocus(element: Element | null | undefined): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected && element !== document.body && !element.matches(":disabled") && !element.closest("[inert]");
}

// Último control enfocado fuera de un diálogo. Es el activador cuando el foco
// ya se perdió al abrir (p. ej. "Marcar ingreso" se deshabilita en el mismo
// paso en que abre la cámara).
let lastFocused: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement && !event.target.closest(".modal-backdrop")) lastFocused = event.target;
  });
}

// Diálogos abiertos, el último arriba: sólo ése responde al teclado.
const openDialogs: symbol[] = [];

export function Modal({ title, subtitle, close, children, closeDisabled = false, className, returnFocus }: {
  title: string;
  subtitle?: string;
  close: () => void;
  children: ReactNode;
  closeDisabled?: boolean;
  className?: string;
  /** Destino del foco al cerrar si el control que abrió el diálogo ya no está disponible. */
  returnFocus?: () => HTMLElement | null;
}) {
  const titleId = useId();
  const subtitleId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<symbol | null>(null);
  // Se fija una sola vez por diálogo (también con el doble montaje de StrictMode).
  const openerRef = useRef<HTMLElement | null | undefined>(undefined);
  const latest = useRef({ close, closeDisabled, returnFocus });
  latest.current = { close, closeDisabled, returnFocus };

  useEffect(() => {
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;
    if (!backdrop || !dialog) return undefined;
    const token = Symbol("modal");
    tokenRef.current = token;
    openDialogs.push(token);
    const isTop = () => openDialogs[openDialogs.length - 1] === token;

    if (openerRef.current === undefined) {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body && !backdrop.contains(active) ? active : lastFocused;
    }

    const inerted = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== backdrop && !node.hasAttribute("inert"));
    inerted.forEach((node) => node.setAttribute("inert", ""));

    if (!dialog.contains(document.activeElement)) {
      const preferred = dialog.querySelector<HTMLElement>("[data-autofocus]");
      ((preferred && isAvailable(preferred) ? preferred : tabbables(dialog)[0]) ?? dialog).focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop() || event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (latest.current.closeDisabled) return;
        event.preventDefault();
        latest.current.close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = tabbables(dialog);
      if (!items.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const current = document.activeElement;
      const known = current instanceof HTMLElement && items.includes(current);
      const edge = event.shiftKey ? items[0] : items[items.length - 1];
      if (!known || current === edge) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0])!.focus();
      }
    };
    // Si algo enfoca el fondo igual (navegador sin `inert`), el foco vuelve al diálogo.
    const onFocusIn = (event: FocusEvent) => {
      if (!isTop() || !(event.target instanceof Node) || backdrop.contains(event.target)) return;
      (tabbables(dialog)[0] ?? dialog).focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      openDialogs.splice(openDialogs.indexOf(token), 1);
      inerted.forEach((node) => node.removeAttribute("inert"));
      // Sólo si el foco quedó en el diálogo o se perdió: nunca se le quita a otra pantalla.
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected && !backdrop.contains(active)) return;
      const target = [openerRef.current, latest.current.returnFocus?.()].find(canReceiveFocus);
      target?.focus({ preventScroll: true });
    };
  }, []);

  // El control enfocado se deshabilitó (p. ej. "Confirmar" al empezar el envío)
  // o el foco se perdió: pasa al diálogo, sin activar ningún otro control.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || openDialogs[openDialogs.length - 1] !== tokenRef.current) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || (active instanceof HTMLElement && dialog.contains(active) && active.matches(":disabled"));
    if (lost) dialog.focus({ preventScroll: true });
  });

  return createPortal(
    <div ref={backdropRef} className={className ? `modal-backdrop ${className}` : "modal-backdrop"}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subtitle ? subtitleId : undefined} tabIndex={-1}>
        <div className="modal-head">
          <div className="modal-head-text">
            <h3 id={titleId}>{title}</h3>
            {subtitle ? <p id={subtitleId}>{subtitle}</p> : null}
          </div>
          <button className="icon-button" onClick={close} disabled={closeDisabled} aria-label="Cerrar"><X /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
