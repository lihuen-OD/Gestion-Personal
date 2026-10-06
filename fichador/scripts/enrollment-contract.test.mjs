import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("F5 — compuerta de enrolamiento del fichador", () => {
  it("persiste id y secreto sólo en IndexedDB, nunca localStorage", () => {
    const storage = source("../src/features/device/clockDeviceStorage.ts");
    expect(storage).toContain("indexedDB.open");
    expect(storage).not.toMatch(/localStorage|sessionStorage/);
  });

  it("no registra automáticamente: el alta sólo sale del botón Configurar", () => {
    const gate = source("../src/features/device/ClockDeviceGate.tsx");
    const initialEffect = gate.slice(gate.indexOf("useEffect(() =>"), gate.indexOf("const configure"));
    expect(initialEffect).not.toContain("clockDeviceApiService.register");
    expect(gate).toContain("Configurar dispositivo");
    expect(gate).toContain("fichador-device-registration");
  });

  it("PENDING consulta estado entre 5 y 10 segundos; ACTIVE libera y REVOKED bloquea", () => {
    const gate = source("../src/features/device/ClockDeviceGate.tsx");
    expect(gate).toContain("const POLL_MS = 7_500");
    expect(gate).toContain('device?.status === "ACTIVE"');
    expect(gate).toContain('device?.status === "REVOKED"');
  });
});
