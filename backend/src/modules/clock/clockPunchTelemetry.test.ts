import { afterEach, describe, expect, it, vi } from "vitest";
import { clockPunchMetric, measureClockPunchPhase } from "../../shared/observability/clockPunchTelemetry";

describe("clock punch telemetry", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emite JSON estructurado con allowlist y sin contenido sensible", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    clockPunchMetric({ requestId: "req-safe", phase: "primary_upload", durationMs: 12.34, bytes: 36000, provider: "google_drive", result: "success" });
    const entry = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(entry).toEqual({ level: "info", event: "clock_punch_timing", requestId: "req-safe", phase: "primary_upload", durationMs: 12.3, bytes: 36000, provider: "google_drive", result: "success" });
    expect(JSON.stringify(entry)).not.toMatch(/authorization|base64|token|secret|signed/i);
  });

  it("registra success y error sin tragarse la excepción", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(measureClockPunchPhase({ requestId: "ok", phase: "context" }, async () => 7)).resolves.toBe(7);
    await expect(measureClockPunchPhase({ requestId: "fail", phase: "context" }, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(info.mock.calls.map(([line]) => JSON.parse(String(line)).result)).toEqual(["success", "error"]);
  });
});
