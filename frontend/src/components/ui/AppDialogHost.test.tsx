import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppDialogHost } from "./AppDialogHost";
import { confirmAction } from "../../services/appDialog";

// Etapa 13J.3 — bug real diagnosticado: <AppDialogHost/> se monta en
// main.tsx ANTES que <App/>. Sin portal, su <Modal> renderiza en ese lugar
// del árbol — un hijo TEMPRANO del <body>. Si confirmAction() se dispara
// desde DENTRO de otro modal ya abierto (ej. "Finalizar vigencia" en el
// modal de Régimen Laboral), ambos .modal-backdrop comparten el mismo
// z-index (80) — con la misma especificidad, gana el que está MÁS TARDE en
// el DOM. El modal que ya estaba abierto (parte del árbol de <App/>, que
// viene después) tapaba a la confirmación por completo: no se veía, no se
// podía tocar "Finalizar vigencia" — la causa real reportada de "finalizar
// vigencia no funciona". createPortal(..., document.body) saca el diálogo
// de ese árbol y lo inserta como último hijo de <body> en el momento en que
// se abre, ganando el empate de z-index de forma confiable.
describe("AppDialogHost — Etapa 13J.3 (portal, para no quedar detrás de un modal ya abierto)", () => {
  it("renderiza el diálogo de confirmación FUERA de cualquier contenedor local (portal a document.body), no anidado dentro de un modal que ya estaba abierto", async () => {
    render(
      <div data-testid="fake-open-modal" className="modal-backdrop">
        <div className="modal">Modal principal ya abierto (simula WorkRegimesPage)</div>
      </div>,
    );
    render(<AppDialogHost />);

    void confirmAction("¿Querés finalizar la vigencia?", { title: "Finalizar asignación de régimen", confirmLabel: "Finalizar vigencia" });

    const dialogHeading = await screen.findByRole("heading", { name: "Finalizar asignación de régimen" });
    const fakeModal = screen.getByTestId("fake-open-modal");

    // El diálogo no es descendiente del "modal principal" simulado...
    expect(fakeModal.contains(dialogHeading)).toBe(false);
    // ...y su .modal-backdrop es un hijo directo de <body> (portal), no un
    // nieto de <div id="root"> escondido detrás del modal que ya existía.
    const dialogBackdrop = dialogHeading.closest(".modal-backdrop");
    expect(dialogBackdrop?.parentElement).toBe(document.body);
  });

  it("confirmar desde el diálogo (ya sin quedar tapado) resuelve la promesa en true", async () => {
    render(<AppDialogHost />);
    const user = userEvent.setup();

    const resultPromise = confirmAction("¿Confirmar?", { title: "Confirmar acción", confirmLabel: "Confirmar" });
    await screen.findByRole("heading", { name: "Confirmar acción" });
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await resultPromise).toBe(true);
  });

  it("cancelar desde el diálogo resuelve la promesa en false", async () => {
    render(<AppDialogHost />);
    const user = userEvent.setup();

    const resultPromise = confirmAction("¿Confirmar?", { title: "Confirmar acción" });
    await screen.findByRole("heading", { name: "Confirmar acción" });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await resultPromise).toBe(false);
  });
});
