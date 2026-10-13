import { describe, expect, it } from "vitest";
import { failedAttemptResponse, failedAttemptRetryAfterSeconds } from "./clockAttemptErrorMeta";

describe("clockAttemptErrorMeta (F7.1)", () => {
  it("guarda sólo retryAfterSeconds, bajo `error`, y se relee igual", () => {
    const stored = failedAttemptResponse({ retryAfterSeconds: 42 });
    expect(stored).toEqual({ error: { retryAfterSeconds: 42 } });
    expect(failedAttemptRetryAfterSeconds(stored as never)).toBe(42);
  });

  it("no guarda nada si el error no trae un retryAfterSeconds válido", () => {
    expect(failedAttemptResponse({})).toBeUndefined();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 2.5]) expect(failedAttemptResponse({ retryAfterSeconds: value })).toBeUndefined();
  });

  it("allowlist: cualquier otra propiedad del error (p. ej. details) nunca llega a la metadata", () => {
    expect(failedAttemptResponse({ retryAfterSeconds: 5, details: { internal: true } } as never)).toEqual({ error: { retryAfterSeconds: 5 } });
  });

  it.each([
    ["null", null],
    ["resultado de un COMPLETED", { workShift: { id: "shift-1" } }],
    ["array", [1, 2]],
    ["error no objeto", { error: 42 }],
    ["valor inválido", { error: { retryAfterSeconds: "42" } }],
  ])("una forma ajena (%s) se relee como sin metadata", (_label, response) => {
    expect(failedAttemptRetryAfterSeconds(response as never)).toBeUndefined();
  });
});
