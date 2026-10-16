import { afterEach, describe, expect, it, vi } from "vitest";
import { countClockPunchQuery, emitClockPunchQueryBudget, markClockPunchQueryPhase, runWithClockPunchQueryBudget } from "./clockPunchQueryBudget";

describe("PERF-5A — presupuesto de queries de la fichada por fase", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cuenta por fase dentro del request y emite sólo contadores, sin SQL ni datos", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await runWithClockPunchQueryBudget("req-1", async () => {
      countClockPunchQuery();
      await Promise.all([Promise.resolve().then(countClockPunchQuery), Promise.resolve().then(countClockPunchQuery)]);
      markClockPunchQueryPhase("tx");
      countClockPunchQuery();
      markClockPunchQueryPhase("post");
      countClockPunchQuery();
      emitClockPunchQueryBudget("success");
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(info.mock.calls[0]![0] as string)).toEqual({ level: "info", event: "clock_punch_query_budget", requestId: "req-1", pre: 3, tx: 1, post: 1, total: 5, result: "success" });
  });

  it("fuera de un request de fichada no hace nada", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    countClockPunchQuery();
    markClockPunchQueryPhase("tx");
    emitClockPunchQueryBudget("success");
    expect(info).not.toHaveBeenCalled();
  });
});
