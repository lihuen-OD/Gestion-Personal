import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

/**
 * Etapa 6B-2 (AUDITORIA_6A F6-04 / P4): foco, teclado y fondo de los diálogos
 * modales del fichador. jsdom no aplica `inert` ni el orden de Tab real del
 * navegador: acá se prueba el contrato del componente; el recorrido real se
 * verifica en Chromium (QA de 6B-2).
 */
function Harness({ initiallyOpen = false, closeDisabled = false, withAutofocus = false, returnFocus, onClose = () => undefined }: {
  initiallyOpen?: boolean;
  closeDisabled?: boolean;
  withAutofocus?: boolean;
  returnFocus?: () => HTMLElement | null;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [extra, setExtra] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => { onClose(); setOpen(false); };
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <button>Fondo</button>
      {open ? (
        <Modal title="Diálogo de prueba" subtitle="Subtítulo" close={close} closeDisabled={closeDisabled} returnFocus={returnFocus}>
          <input aria-label="Campo" />
          <button data-autofocus={withAutofocus ? "" : undefined} onClick={() => setExtra(true)}>Agregar</button>
          {extra ? <button>Nuevo</button> : null}
          <button disabled>Deshabilitado</button>
          <button disabled={busy} onClick={() => setBusy(true)}>Último</button>
        </Modal>
      ) : null}
    </>
  );
}

const dialog = () => screen.getByRole("dialog", { name: "Diálogo de prueba" });
const focused = () => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") || document.activeElement?.textContent || document.activeElement?.tagName;

describe("Modal — foco inicial", () => {
  it("1a. entra al diálogo: el control marcado con data-autofocus", async () => {
    const user = userEvent.setup();
    render(<Harness withAutofocus />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.getByRole("button", { name: "Agregar" })).toHaveFocus();
  });

  it("1b. sin destino marcado: el primer control disponible del diálogo (nunca el fondo)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
  });

  it("1c. sin controles habilitados: el propio diálogo recibe el foco", async () => {
    const user = userEvent.setup();
    render(<Harness closeDisabled />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it("el diálogo se nombra y describe con su título y subtítulo", async () => {
    render(<Harness initiallyOpen />);
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(dialog()).toHaveAccessibleName("Diálogo de prueba");
    expect(dialog()).toHaveAccessibleDescription("Subtítulo");
  });
});

describe("Modal — Tab y Shift+Tab quedan dentro del diálogo", () => {
  it("2. Tab desde el último control vuelve al primero", async () => {
    const user = userEvent.setup();
    render(<Harness initiallyOpen />);
    screen.getByRole("button", { name: "Último" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
  });

  it("3. Shift+Tab desde el primero va al último", async () => {
    const user = userEvent.setup();
    render(<Harness initiallyOpen />);
    screen.getByRole("button", { name: "Cerrar" }).focus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Último" })).toHaveFocus();
  });

  it("4. el foco nunca llega al fondo: el fondo queda inerte y un foco que se escapa vuelve al diálogo", async () => {
    const user = userEvent.setup();
    render(<Harness initiallyOpen />);
    const background = screen.getByRole("button", { name: "Fondo" });
    expect(background.closest("[inert]")).not.toBeNull();
    expect(dialog().closest("[inert]")).toBeNull();
    const visited: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      await user.tab();
      expect(dialog().contains(document.activeElement)).toBe(true);
      visited.push(String(focused()));
    }
    expect(visited).not.toContain("Deshabilitado");
    act(() => { background.focus(); });
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it("9. controles que aparecen entran al recorrido; si el enfocado se deshabilita, el foco no se pierde", async () => {
    const user = userEvent.setup();
    render(<Harness initiallyOpen />);
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    screen.getByRole("button", { name: "Último" }).focus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Nuevo" })).toHaveFocus();

    screen.getByRole("button", { name: "Último" }).focus();
    await user.click(screen.getByRole("button", { name: "Último" })); // queda deshabilitado
    expect(screen.getByRole("button", { name: "Último" })).toBeDisabled();
    expect(dialog().contains(document.activeElement)).toBe(true);
  });
});

describe("Modal — Escape respeta la política de cierre", () => {
  it("5. con el cierre permitido, Escape hace lo mismo que Cerrar", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness initiallyOpen onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("6. con el cierre bloqueado (operación en curso), Escape no cierra", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness initiallyOpen closeDisabled onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it("con dos diálogos abiertos, Escape cierra sólo el de arriba", async () => {
    const user = userEvent.setup();
    const first = vi.fn(); const second = vi.fn();
    render(
      <>
        <Modal title="Primero" close={first}><button>Uno</button></Modal>
        <Modal title="Segundo" close={second}><button>Dos</button></Modal>
      </>,
    );
    await user.keyboard("{Escape}");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("Modal — restauración del foco", () => {
  it("7. al cerrar, el foco vuelve al control que abrió el diálogo", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.getByRole("button", { name: "Abrir" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Fondo" }).closest("[inert]")).toBeNull();
  });

  it("8a. si el activador quedó deshabilitado, va al destino alternativo seguro", async () => {
    const fallback = document.createElement("section");
    fallback.tabIndex = -1;
    document.body.appendChild(fallback);
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button disabled={open} onClick={() => setOpen(true)}>Activador</button>
          {open ? <Modal title="Diálogo de prueba" close={() => setOpen(false)} returnFocus={() => fallback}><button>Interno</button></Modal> : null}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Opener />);
    await user.click(screen.getByRole("button", { name: "Activador" }));
    // El activador vuelve a habilitarse al cerrar; mientras tanto se cierra con el teclado.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Activador" })).toHaveFocus();

    function DisabledAfter() {
      const [open, setOpen] = useState(false);
      const [used, setUsed] = useState(false);
      return (
        <>
          <button disabled={used} onClick={() => setOpen(true)}>Una vez</button>
          {open ? <Modal title="Diálogo de prueba" close={() => { setUsed(true); setOpen(false); }} returnFocus={() => fallback}><button>Interno</button></Modal> : null}
        </>
      );
    }
    render(<DisabledAfter />);
    await user.click(screen.getByRole("button", { name: "Una vez" }));
    await user.keyboard("{Escape}");
    expect(fallback).toHaveFocus();
    fallback.remove();
  });

  it("8b. si el activador ya no existe, no enfoca un nodo desmontado ni falla", async () => {
    function Unmounting() {
      const [open, setOpen] = useState(false);
      return (
        <>
          {!open ? <button onClick={() => setOpen(true)}>Me voy</button> : null}
          {open ? <Modal title="Diálogo de prueba" close={() => setOpen(false)}><button>Interno</button></Modal> : null}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Unmounting />);
    const opener = screen.getByRole("button", { name: "Me voy" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(opener.isConnected).toBe(false);
    expect(document.activeElement === opener).toBe(false);
  });
});

describe("Modal — desmontaje", () => {
  it("14. al desmontarse no deja el fondo inerte, ni listeners, ni cierra después", () => {
    const close = vi.fn();
    const view = render(<><button>Fondo</button><Modal title="Diálogo de prueba" close={close}><button>Interno</button></Modal></>);
    expect(screen.getByRole("button", { name: "Fondo" }).closest("[inert]")).not.toBeNull();
    view.unmount();
    expect(document.querySelector("[inert]")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });
});
