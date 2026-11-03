import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useLongPress } from "./useLongPress";

/** Modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md): el gesto oculto. */
function Target({ onLongPress, enabled = true }: { onLongPress: () => void; enabled?: boolean }) {
  const handlers = useLongPress(onLongPress, { durationMs: 5_000, enabled });
  return <h1 {...handlers}>Fichador de personal</h1>;
}

const heading = () => screen.getByText("Fichador de personal");
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLongPress — presión sostenida de 5 s", () => {
  it.each(["touch", "mouse", "pen"])("con %s dispara una sola vez a los 5 s, nunca antes", async (pointerType) => {
    const onLongPress = vi.fn();
    render(<Target onLongPress={onLongPress} />);
    fireEvent.pointerDown(heading(), { pointerType, button: 0, clientX: 10, clientY: 10 });
    await advance(4_999);
    expect(onLongPress).not.toHaveBeenCalled();
    await advance(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it.each(["pointerUp", "pointerLeave", "pointerCancel"] as const)("%s antes de los 5 s lo cancela", async (event) => {
    const onLongPress = vi.fn();
    render(<Target onLongPress={onLongPress} />);
    fireEvent.pointerDown(heading(), { pointerType: "touch", clientX: 10, clientY: 10 });
    await advance(3_000);
    fireEvent[event](heading(), { pointerType: "touch" });
    await advance(5_000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("un arrastre (más de 10 px) es un desplazamiento y lo cancela; un temblor mínimo no", async () => {
    const onLongPress = vi.fn();
    render(<Target onLongPress={onLongPress} />);
    fireEvent.pointerDown(heading(), { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerMove(heading(), { pointerType: "touch", clientX: 104, clientY: 103 });
    await advance(5_000);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(heading(), { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerMove(heading(), { pointerType: "touch", clientX: 100, clientY: 130 });
    await advance(5_000);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("el botón derecho del mouse no cuenta y el menú contextual no se abre", async () => {
    const onLongPress = vi.fn();
    render(<Target onLongPress={onLongPress} />);
    fireEvent.pointerDown(heading(), { pointerType: "mouse", button: 2 });
    await advance(6_000);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(fireEvent.contextMenu(heading())).toBe(false);
  });

  it("deshabilitado no dispara; deshabilitarlo en medio de la presión la corta", async () => {
    const onLongPress = vi.fn();
    const { rerender } = render(<Target onLongPress={onLongPress} enabled={false} />);
    fireEvent.pointerDown(heading(), { pointerType: "touch" });
    await advance(6_000);
    expect(onLongPress).not.toHaveBeenCalled();

    rerender(<Target onLongPress={onLongPress} enabled />);
    fireEvent.pointerDown(heading(), { pointerType: "touch" });
    await advance(2_000);
    rerender(<Target onLongPress={onLongPress} enabled={false} />);
    await advance(6_000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("desmontar en medio de la presión no deja timers ni dispara después", async () => {
    const onLongPress = vi.fn();
    const { unmount } = render(<Target onLongPress={onLongPress} />);
    fireEvent.pointerDown(heading(), { pointerType: "touch" });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(6_000);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
