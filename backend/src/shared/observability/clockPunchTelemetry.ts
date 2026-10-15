type ClockPunchMetric = {
  requestId: string;
  phase: string;
  durationMs: number;
  bytes?: number;
  provider?: string;
  result?: "success" | "error";
};

export function clockPunchMetric(input: ClockPunchMetric) {
  console.info(JSON.stringify({
    level: "info",
    event: "clock_punch_timing",
    requestId: input.requestId,
    phase: input.phase,
    durationMs: Math.max(0, Number(input.durationMs.toFixed(1))),
    ...(input.bytes === undefined ? {} : { bytes: input.bytes }),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.result ? { result: input.result } : {}),
  }));
}

export async function measureClockPunchPhase<T>(input: Omit<ClockPunchMetric, "durationMs" | "result">, operation: () => Promise<T>) {
  const startedAt = performance.now();
  try {
    const result = await operation();
    clockPunchMetric({ ...input, durationMs: performance.now() - startedAt, result: "success" });
    return result;
  } catch (error) {
    clockPunchMetric({ ...input, durationMs: performance.now() - startedAt, result: "error" });
    throw error;
  }
}
