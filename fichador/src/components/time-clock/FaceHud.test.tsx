import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CaptureChecks, FaceHud, captureChecks, type CapturePhase } from "./FaceHud";

const states = (phase: CapturePhase, status: string) => Object.fromEntries(captureChecks(phase, status).map((check) => [check.label, check.state]));

describe("captureChecks: sólo refleja el estado real del detector", () => {
  it("preparando: la cámara está en curso y nada más se afirma", () => {
    expect(states("preparing", "LOADING")).toEqual({ "Cámara lista": "active", "Buena luz": "todo", "Un solo rostro": "todo", "Rostro en el recuadro": "todo" });
  });

  it("cámara sin imagen: la cámara queda para revisar", () => {
    expect(states("off", "CAMERA_ERROR")["Cámara lista"]).toBe("bad");
  });

  it("cada estado del detector marca el control que corresponde", () => {
    expect(states("live", "LOADING")).toMatchObject({ "Cámara lista": "ok", "Buena luz": "active", "Un solo rostro": "todo" });
    expect(states("live", "LOW_LIGHT")).toMatchObject({ "Buena luz": "bad", "Un solo rostro": "todo", "Rostro en el recuadro": "todo" });
    expect(states("live", "NO_FACE")).toMatchObject({ "Buena luz": "ok", "Un solo rostro": "active", "Rostro en el recuadro": "bad" });
    expect(states("live", "MULTIPLE_FACES")).toMatchObject({ "Un solo rostro": "bad", "Rostro en el recuadro": "todo" });
    expect(states("live", "FACE_TOO_SMALL")).toMatchObject({ "Un solo rostro": "ok", "Rostro en el recuadro": "bad" });
    expect(states("live", "VALID")).toEqual({ "Cámara lista": "ok", "Buena luz": "ok", "Un solo rostro": "ok", "Rostro en el recuadro": "ok" });
  });

  it("la lista se anuncia con su estado para lectores de pantalla", () => {
    render(<CaptureChecks phase="live" status="MULTIPLE_FACES" />);
    const list = screen.getByRole("list", { name: "Controles de la captura" });
    expect(list).toHaveTextContent("Un solo rostro: revisar");
    expect(list).toHaveTextContent("Cámara lista: listo");
  });
});

describe("FaceHud", () => {
  const box = { left: 30, top: 20, width: 40, height: 50 };

  it("es decorativo y nunca afirma una identidad ni un porcentaje", () => {
    const phases: CapturePhase[] = ["preparing", "live", "submitting", "off"];
    for (const phase of phases) {
      for (const valid of [false, true]) {
        const { container, unmount } = render(<FaceHud phase={phase} valid={valid} view={box} />);
        expect(container.textContent ?? "").not.toMatch(/identidad|verificad|reconoc|coincid|match|%/i);
        for (const element of Array.from(container.children)) expect(element).toHaveAttribute("aria-hidden", "true");
        unmount();
      }
    }
  });

  it("dibuja la malla sólo cuando hay un rostro ubicado", () => {
    const { container, rerender } = render(<FaceHud phase="live" valid={false} view={null} />);
    expect(container.querySelector(".face-mesh")).toBeNull();
    rerender(<FaceHud phase="live" valid view={box} />);
    const mesh = container.querySelector<HTMLElement>(".face-mesh");
    expect(mesh).not.toBeNull();
    expect(mesh?.style.left).not.toBe("");
    expect(container.textContent).toContain("En posición");
  });

  it("muestra el progreso sólo mientras se envía", () => {
    const { container, rerender } = render(<FaceHud phase="live" valid view={box} />);
    expect(container.querySelector(".face-busy")).toBeNull();
    rerender(<FaceHud phase="submitting" valid view={box} />);
    expect(container.querySelector(".face-busy")).not.toBeNull();
    expect(container.textContent).toContain("Foto tomada");
  });
});
