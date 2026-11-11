import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ClockDeviceGate, PAIRING_RENEW_HINT } from "./ClockDeviceGate";
import { clockDeviceStorage } from "./clockDeviceStorage";
import { clockDeviceApiService } from "../../services/api/clockDeviceApiService";
import { clockDeviceSession } from "../../services/api/clockDeviceSession";

/**
 * Etapa 6B-5 (AUDITORIA_6A F6-08): el código de vinculación muestra la hora
 * de vencimiento que da el servidor y qué hacer si ya pasó, sin cuenta
 * regresiva con el reloj del equipo ni códigos generados solos.
 */
vi.mock("./clockDeviceStorage", () => ({ clockDeviceStorage: { get: vi.fn(), set: vi.fn(), clear: vi.fn() } }));
vi.mock("../../services/api/clockDeviceApiService", () => ({ clockDeviceApiService: { register: vi.fn(), status: vi.fn(), refreshPairing: vi.fn() } }));

const IDENTITY = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: "s".repeat(43) };
const NOW = new Date("2026-11-11T18:00:00.000Z"); // 15:00 en Argentina
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function pendingWithCode(expiresAt: string) {
  vi.mocked(clockDeviceApiService.register).mockResolvedValue({ identity: IDENTITY, device: { id: IDENTITY.id, name: null, status: "PENDING", pairingCode: "K7Q4-M2XB", pairingExpiresAt: expiresAt } });
  render(<ClockDeviceGate><h1>Fichador de personal</h1></ClockDeviceGate>);
  await advance(0);
  fireEvent.click(screen.getByRole("button", { name: "Configurar dispositivo" }));
  await advance(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  vi.mocked(clockDeviceStorage.get).mockResolvedValue(undefined);
  vi.mocked(clockDeviceApiService.status).mockResolvedValue({ id: IDENTITY.id, name: null, status: "PENDING" });
});

afterEach(() => {
  clockDeviceSession.end();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("F6-08 — código de vinculación y su vencimiento", () => {
  it("muestra la hora del servidor y qué hacer si ya pasó, sin cuenta regresiva", async () => {
    await pendingWithCode("2026-11-11T18:10:00.000Z");
    expect(screen.getByText("Vence a las 15:10")).toBeInTheDocument();
    expect(screen.getByText(PAIRING_RENEW_HINT)).toBeInTheDocument();
    expect(document.querySelector(".pairing")!.textContent).not.toMatch(/\d+:\d{2}\s*(min|restan|quedan)|quedan|restan|vigente/i);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("aunque el reloj del equipo diga que ya pasó, no lo afirma ni genera otro código solo; la acción manual sigue disponible", async () => {
    await pendingWithCode("2026-11-11T18:10:00.000Z");
    await advance(30 * 60_000); // pasan 30 min según el equipo
    expect(screen.getByText("Vence a las 15:10")).toBeInTheDocument();
    expect(screen.getByText(PAIRING_RENEW_HINT)).toBeInTheDocument();
    expect(screen.queryByText(/venció|vencido|expir/i)).not.toBeInTheDocument();
    expect(clockDeviceApiService.refreshPairing).not.toHaveBeenCalled();
    expect(clockDeviceApiService.register).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Generar código nuevo" })).toBeEnabled();
  });

  it("generar un código nuevo reemplaza la hora por la que informa el servidor", async () => {
    vi.mocked(clockDeviceApiService.refreshPairing).mockResolvedValue({ pairingCode: "P3X9-D6WR", pairingExpiresAt: "2026-11-11T18:40:00.000Z" });
    await pendingWithCode("2026-11-11T18:10:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "Generar código nuevo" }));
    await advance(0);
    expect(screen.getByText("Vence a las 15:40")).toBeInTheDocument();
    expect(screen.getByText(PAIRING_RENEW_HINT)).toBeInTheDocument();
    expect(clockDeviceApiService.refreshPairing).toHaveBeenCalledTimes(1);
  });

  it("sin código a la vista (equipo ya registrado), no se muestra la indicación de vencimiento", async () => {
    vi.mocked(clockDeviceStorage.get).mockResolvedValue(IDENTITY);
    render(<ClockDeviceGate><h1>Fichador de personal</h1></ClockDeviceGate>);
    await advance(0);
    expect(screen.getByRole("heading", { name: "Esperando aprobación" })).toBeInTheDocument();
    expect(screen.queryByText(PAIRING_RENEW_HINT)).not.toBeInTheDocument();
  });
});
