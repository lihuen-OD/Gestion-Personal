import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FaceHud, type CapturePhase } from "./FaceHud";

describe("FaceHud", () => {
  const box = { left: 30, top: 20, width: 40, height: 50 };

  it("es decorativo y sin texto: la única señal escrita del estado es el panel de la captura", () => {
    const phases: CapturePhase[] = ["preparing", "live", "submitting", "off"];
    for (const phase of phases) {
      for (const view of [null, box]) {
        const { container, unmount } = render(<FaceHud phase={phase} view={view} />);
        expect(container.textContent).toBe("");
        for (const element of Array.from(container.children)) expect(element).toHaveAttribute("aria-hidden", "true");
        unmount();
      }
    }
  });

  it("dibuja la malla sólo cuando hay un rostro ubicado", () => {
    const { container, rerender } = render(<FaceHud phase="live" view={null} />);
    expect(container.querySelector(".face-mesh")).toBeNull();
    rerender(<FaceHud phase="live" view={box} />);
    const mesh = container.querySelector<HTMLElement>(".face-mesh");
    expect(mesh).not.toBeNull();
    expect(mesh?.style.left).not.toBe("");
  });

  it("muestra el progreso sólo mientras se envía", () => {
    const { container, rerender } = render(<FaceHud phase="live" view={box} />);
    expect(container.querySelector(".face-busy")).toBeNull();
    rerender(<FaceHud phase="submitting" view={box} />);
    expect(container.querySelector(".face-busy")).not.toBeNull();
  });
});
