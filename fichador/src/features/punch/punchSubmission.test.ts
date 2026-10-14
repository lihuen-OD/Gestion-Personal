import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../../services/api/apiClient";
import type { ClockAttemptState, ClockPhotoPunchInput, ClockPunchResult } from "../../services/api/timeClockApiService";
import { MAX_RESENDS, RECOVERY_POLL_DELAYS_MS, isUncertainPunchError, submitPunch, type PunchStage } from "./punchSubmission";

// F8: recuperación de una fichada con resultado incierto. Sin timers reales:
// `sleep` se inyecta y resuelve al instante, pero registra cada espera.
const input: ClockPhotoPunchInput = {
  requestId: "11111111-1111-4111-8111-111111111111",
  employeeId: "employee-1",
  punchType: "IN",
  photo: "data:image/jpeg;base64,AAAA",
  faceValidationStatus: "VALID",
};
const result: ClockPunchResult = { employee: { id: "employee-1", legajo: "100", dniSuffix: "456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" }, workShift: { id: "shift-1", startAt: "2026-10-13T11:01:00.000Z" } };
const attempt = (status: ClockAttemptState["status"], extra: Partial<ClockAttemptState> = {}): ClockAttemptState => ({ requestId: input.requestId, status, response: null, error: null, ...extra });
const notFound = () => new ApiError("No se encontró el intento de fichada.", "CLOCK_ATTEMPT_NOT_FOUND", 404);

function setup() {
  const api = { photoPunch: vi.fn(), attemptStatus: vi.fn() };
  const sleep = vi.fn().mockResolvedValue(undefined);
  const stages: PunchStage[] = [];
  const deps = { api, sleep, onStage: (stage: PunchStage) => stages.push(stage) };
  const requestIdsSent = () => [...api.photoPunch.mock.calls.map(([sent]) => (sent as ClockPhotoPunchInput).requestId), ...api.attemptStatus.mock.calls.map(([requestId]) => requestId as string)];
  return { api, sleep, stages, deps, requestIdsSent };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

describe("submitPunch — resultado cierto", () => {
  it("201 → éxito, sin consultar el intento", async () => {
    ctx.api.photoPunch.mockResolvedValue(result);
    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "success", result });
    expect(ctx.api.attemptStatus).not.toHaveBeenCalled();
    expect(ctx.stages).toEqual(["sending"]);
  });

  it.each([
    ["negocio", new ApiError("Ya existe un ingreso abierto para este empleado.", "CLOCK_ALREADY_OPEN", 409)],
    ["cooldown", new ApiError("Ya registraste una fichada hace instantes.", "CLOCK_PUNCH_COOLDOWN", 409, 42)],
    ["dispositivo revocado", new ApiError("Este dispositivo fue deshabilitado por RRHH.", "CLOCK_DEVICE_REVOKED", 403)],
    ["rate limit", new ApiError("Hay demasiados intentos seguidos desde este dispositivo.", "API_ERROR", 429)],
    ["fallo propio del backend (5xx con código CLOCK_)", new ApiError("No pudimos completar la fichada.", "CLOCK_TEMPORARY_FAILURE", 503)],
  ])("error definitivo (%s) → se devuelve tal cual, sin recuperar ni reintentar", async (_label, error) => {
    ctx.api.photoPunch.mockRejectedValue(error);
    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "failed", error });
    expect(ctx.api.photoPunch).toHaveBeenCalledTimes(1);
    expect(ctx.api.attemptStatus).not.toHaveBeenCalled();
  });
});

describe("submitPunch — resultado incierto: se recupera con el MISMO requestId", () => {
  it("red → intento 404, 404 → reenvía el MISMO POST → 201", async () => {
    ctx.api.photoPunch.mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(result);
    ctx.api.attemptStatus.mockRejectedValueOnce(notFound()).mockRejectedValueOnce(notFound());

    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "success", result });

    expect(ctx.api.photoPunch).toHaveBeenCalledTimes(2);
    expect(ctx.api.photoPunch.mock.calls[1]![0]).toBe(input); // mismo payload, mismo requestId
    expect(new Set(ctx.requestIdsSent())).toEqual(new Set([input.requestId]));
  });

  it("red → PROCESSING → COMPLETED: éxito normal con el resultado guardado", async () => {
    ctx.api.photoPunch.mockRejectedValue(new NetworkError());
    ctx.api.attemptStatus.mockResolvedValueOnce(attempt("PROCESSING")).mockResolvedValueOnce(attempt("COMPLETED", { response: result }));

    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "success", result });

    expect(ctx.api.photoPunch).toHaveBeenCalledTimes(1);
    expect(ctx.stages).toEqual(["sending", "verifying", "confirming"]);
  });

  it("red → FAILED por cooldown: el error guardado vuelve con su retryAfterSeconds original", async () => {
    ctx.api.photoPunch.mockRejectedValue(new NetworkError());
    ctx.api.attemptStatus.mockResolvedValueOnce(attempt("FAILED", { error: { code: "CLOCK_PUNCH_COOLDOWN", message: "Ya registraste una fichada hace instantes.", httpStatus: 409, retryAfterSeconds: 42 } }));

    const outcome = await submitPunch(input, ctx.deps);

    expect(outcome).toMatchObject({ kind: "failed", error: { code: "CLOCK_PUNCH_COOLDOWN", status: 409, retryAfterSeconds: 42 } });
  });

  it("timeout del cliente (AbortSignal) → COMPLETED: el timeout no significa que la fichada falló", async () => {
    ctx.api.photoPunch.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    ctx.api.attemptStatus.mockResolvedValueOnce(attempt("COMPLETED", { response: result }));
    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "success", result });
  });

  it("502 del proxy (sin código propio) → se trata como incierto y se verifica", async () => {
    ctx.api.photoPunch.mockRejectedValue(new ApiError("El servicio no está disponible.", "API_ERROR", 502));
    ctx.api.attemptStatus.mockResolvedValueOnce(attempt("COMPLETED", { response: result }));
    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "success", result });
  });

  it("el reenvío responde CLOCK_ATTEMPT_PROCESSING → sigue consultando hasta COMPLETED", async () => {
    ctx.api.photoPunch.mockRejectedValueOnce(new NetworkError()).mockRejectedValueOnce(new ApiError("La fichada todavía se está procesando.", "CLOCK_ATTEMPT_PROCESSING", 409));
    ctx.api.attemptStatus.mockRejectedValueOnce(notFound()).mockRejectedValueOnce(notFound()).mockResolvedValueOnce(attempt("COMPLETED", { response: result }));

    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "success", result });
    expect(ctx.api.photoPunch).toHaveBeenCalledTimes(2);
  });

  it("el reenvío choca con CLOCK_IDEMPOTENCY_KEY_REUSED → se abandona ese intento, nunca se genera otro requestId", async () => {
    const reused = new ApiError("No pudimos recuperar esta fichada. Volvé a iniciar el proceso.", "CLOCK_IDEMPOTENCY_KEY_REUSED", 409);
    ctx.api.photoPunch.mockRejectedValueOnce(new NetworkError()).mockRejectedValueOnce(reused);
    ctx.api.attemptStatus.mockRejectedValue(notFound());

    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "failed", error: reused });
    expect(new Set(ctx.requestIdsSent())).toEqual(new Set([input.requestId]));
  });

  it("revocación en medio de la verificación → corta con el error del dispositivo", async () => {
    const revoked = new ApiError("Este dispositivo fue deshabilitado por RRHH.", "CLOCK_DEVICE_REVOKED", 403);
    ctx.api.photoPunch.mockRejectedValue(new NetworkError());
    ctx.api.attemptStatus.mockRejectedValueOnce(revoked);
    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "failed", error: revoked });
    expect(ctx.api.attemptStatus).toHaveBeenCalledTimes(1);
  });
});

describe("submitPunch — límites de la recuperación", () => {
  it("404 permanente: reenvía como máximo MAX_RESENDS veces y termina sin confirmar", async () => {
    ctx.api.photoPunch.mockRejectedValue(new NetworkError());
    ctx.api.attemptStatus.mockRejectedValue(notFound());

    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "unconfirmed" });

    expect(ctx.api.photoPunch).toHaveBeenCalledTimes(1 + MAX_RESENDS);
    expect(ctx.api.attemptStatus).toHaveBeenCalledTimes(RECOVERY_POLL_DELAYS_MS.length);
    expect(new Set(ctx.requestIdsSent())).toEqual(new Set([input.requestId]));
  });

  it("sin red durante toda la verificación: presupuesto acotado (~44,5 s, ≤ 14 consultas) y sin confirmar", async () => {
    ctx.api.photoPunch.mockRejectedValue(new NetworkError());
    ctx.api.attemptStatus.mockRejectedValue(new NetworkError());

    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "unconfirmed" });

    const waited = ctx.sleep.mock.calls.reduce((total, [ms]) => total + (ms as number), 0);
    expect(waited).toBe(44_500);
    expect(ctx.api.attemptStatus).toHaveBeenCalledTimes(14);
    expect(ctx.api.photoPunch).toHaveBeenCalledTimes(1); // sin 404 no se reenvía a ciegas
  });

  it("PROCESSING eterno: deja de consultar al agotar el presupuesto (el backend lo vence por TTL)", async () => {
    ctx.api.photoPunch.mockRejectedValue(new NetworkError());
    ctx.api.attemptStatus.mockResolvedValue(attempt("PROCESSING"));
    await expect(submitPunch(input, ctx.deps)).resolves.toEqual({ kind: "unconfirmed" });
    expect(ctx.api.attemptStatus).toHaveBeenCalledTimes(RECOVERY_POLL_DELAYS_MS.length);
  });

  it("si la página se desmontó (revocación, navegación) deja de consultar", async () => {
    ctx.api.photoPunch.mockRejectedValue(new NetworkError());
    let cancelled = false;
    ctx.api.attemptStatus.mockImplementation(async () => {
      cancelled = true;
      return attempt("PROCESSING");
    });
    await expect(submitPunch(input, { ...ctx.deps, isCancelled: () => cancelled })).resolves.toEqual({ kind: "unconfirmed" });
    expect(ctx.api.attemptStatus).toHaveBeenCalledTimes(1);
  });
});

describe("isUncertainPunchError", () => {
  it.each([
    [new NetworkError(), true],
    [new DOMException("timeout", "TimeoutError"), true],
    [new DOMException("aborted", "AbortError"), true],
    [new ApiError("x", "API_ERROR", 504), true],
    [new ApiError("x", "CLOCK_ATTEMPT_PROCESSING", 409), true],
    [new ApiError("x", "CLOCK_TEMPORARY_FAILURE", 503), false],
    [new ApiError("x", "CLOCK_PUNCH_COOLDOWN", 409), false],
    [new ApiError("x", "CLOCK_DEVICE_INVALID_CREDENTIAL", 401), false],
  ])("%s → %s", (error, expected) => {
    expect(isUncertainPunchError(error)).toBe(expected);
  });
});
