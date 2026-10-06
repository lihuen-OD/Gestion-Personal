import { describe, expect, it, vi } from "vitest";
import { createKioskUpdater } from "./kioskUpdates";

function fakeTimers() {
  let callback: (() => void) | undefined;
  return {
    setTimer: vi.fn((fn: () => void) => { callback = fn; return 1; }),
    clearTimer: vi.fn(() => { callback = undefined; }),
    tick: () => callback?.(),
  };
}

// F3 — una versión nueva de la app se aplica sola, pero sólo con el kiosco
// ocioso: nunca en medio de una fichada.
describe("createKioskUpdater", () => {
  it("con el kiosco ocioso aplica la actualización enseguida", () => {
    const applyUpdate = vi.fn();
    const timers = fakeTimers();
    createKioskUpdater({ isIdle: () => true, applyUpdate, ...timers }).notifyUpdateReady();

    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(timers.setTimer).not.toHaveBeenCalled();
  });

  it("con el kiosco ocupado espera y la aplica en el primer chequeo ocioso", () => {
    let idle = false;
    const applyUpdate = vi.fn();
    const timers = fakeTimers();
    createKioskUpdater({ isIdle: () => idle, applyUpdate, ...timers }).notifyUpdateReady();

    expect(applyUpdate).not.toHaveBeenCalled();
    timers.tick();
    expect(applyUpdate).not.toHaveBeenCalled();
    idle = true;
    timers.tick();
    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(timers.clearTimer).toHaveBeenCalled();
  });

  it("la aplica una sola vez aunque el aviso llegue repetido", () => {
    const applyUpdate = vi.fn();
    const updater = createKioskUpdater({ isIdle: () => true, applyUpdate, ...fakeTimers() });
    updater.notifyUpdateReady();
    updater.notifyUpdateReady();

    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("stop cancela la espera", () => {
    const applyUpdate = vi.fn();
    const timers = fakeTimers();
    const updater = createKioskUpdater({ isIdle: () => false, applyUpdate, ...timers });
    updater.notifyUpdateReady();
    updater.stop();
    timers.tick();

    expect(timers.clearTimer).toHaveBeenCalled();
    expect(applyUpdate).not.toHaveBeenCalled();
  });
});
