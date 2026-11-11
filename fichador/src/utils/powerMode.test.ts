import { describe, expect, it } from "vitest";
import { POWER_MODE_STORAGE_KEY, applyPowerMode, resolvePowerMode } from "./powerMode";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("resolvePowerMode", () => {
  it("usa normal por defecto en equipos sin pistas de hardware modesto", () => {
    expect(resolvePowerMode("", memoryStorage(), { deviceMemory: 8, hardwareConcurrency: 8 })).toBe("normal");
    expect(resolvePowerMode("", memoryStorage(), {})).toBe("normal");
  });

  it("arranca en bajo consumo con poca memoria o pocos núcleos", () => {
    expect(resolvePowerMode("", memoryStorage(), { deviceMemory: 2, hardwareConcurrency: 8 })).toBe("low");
    expect(resolvePowerMode("", memoryStorage(), { deviceMemory: 8, hardwareConcurrency: 2 })).toBe("low");
  });

  it("el parámetro de la URL manda y queda recordado en el equipo", () => {
    const storage = memoryStorage();
    expect(resolvePowerMode("?consumo=bajo", storage, { deviceMemory: 8 })).toBe("low");
    expect(storage.data.get(POWER_MODE_STORAGE_KEY)).toBe("low");
    expect(resolvePowerMode("", storage, { deviceMemory: 8 })).toBe("low");
    expect(resolvePowerMode("?consumo=normal", storage, { deviceMemory: 1 })).toBe("normal");
    expect(resolvePowerMode("", storage, { deviceMemory: 1 })).toBe("normal");
  });

  it("ignora valores desconocidos y tolera un almacenamiento que falla", () => {
    const broken = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
    expect(resolvePowerMode("?consumo=turbo", broken, {})).toBe("normal");
    expect(resolvePowerMode("?consumo=bajo", broken, {})).toBe("low");
    expect(resolvePowerMode("", null, { hardwareConcurrency: 1 })).toBe("low");
  });

  it("applyPowerMode marca el documento", () => {
    window.localStorage.removeItem(POWER_MODE_STORAGE_KEY);
    applyPowerMode(document, window);
    expect(["low", "normal"]).toContain(document.documentElement.dataset.power);
  });
});
