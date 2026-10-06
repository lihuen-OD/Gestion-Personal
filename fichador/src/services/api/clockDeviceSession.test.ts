import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "./apiClient";
import { clockDeviceRequest, clockDeviceSession } from "./clockDeviceSession";
import { timeClockApiService } from "./timeClockApiService";

const IDENTITY = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: "s".repeat(43) };
const AUTHORIZATION = `ClockDevice ${IDENTITY.id}.${IDENTITY.secret}`;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function authorizationOf(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  return new Headers((fetchMock.mock.calls[call]![1] as RequestInit).headers).get("authorization");
}

afterEach(() => {
  vi.unstubAllGlobals();
  clockDeviceSession.end();
});

describe("clockDeviceSession — credencial individual del fichador (F6)", () => {
  it("sin identidad activa no sale a la red", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(timeClockApiService.searchEmployees("ana")).rejects.toMatchObject({ name: "ApiError", code: "CLOCK_DEVICE_SESSION_MISSING", status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("los reintentos (verificación de un mismo requestId) conservan la misma credencial", async () => {
    clockDeviceSession.start(IDENTITY);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: { code: "CLOCK_ATTEMPT_NOT_FOUND", message: "No se encontró el intento de fichada." } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { requestId: "r-1", status: "COMPLETED", response: null, error: null } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(timeClockApiService.attemptStatus("r-1", "employee-1")).rejects.toMatchObject({ status: 404 });
    await timeClockApiService.attemptStatus("r-1", "employee-1");

    expect(authorizationOf(fetchMock, 0)).toBe(AUTHORIZATION);
    expect(authorizationOf(fetchMock, 1)).toBe(AUTHORIZATION);
    expect(clockDeviceSession.isActive()).toBe(true);
  });

  it.each([
    [403, "CLOCK_DEVICE_REVOKED"],
    [403, "CLOCK_DEVICE_NOT_ACTIVE"],
    [401, "CLOCK_DEVICE_INVALID_CREDENTIAL"],
  ])("un %i %s cierra la sesión, avisa una vez y el siguiente request ya no sale", async (status, code) => {
    clockDeviceSession.start(IDENTITY);
    const listener = vi.fn();
    const unsubscribe = clockDeviceSession.onAuthFailure(listener);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, { error: { code, message: "rechazado" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(timeClockApiService.photoPunch({ requestId: "r-1", employeeId: "employee-1", punchType: "IN", photo: "data:image/jpeg;base64,AA", faceValidationStatus: "VALID" }))
      .rejects.toMatchObject({ code });
    await expect(timeClockApiService.attemptStatus("r-1", "employee-1")).rejects.toMatchObject({ code: "CLOCK_DEVICE_SESSION_MISSING" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(code);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(clockDeviceSession.isActive()).toBe(false);
    unsubscribe();
  });

  it.each([
    ["503 del servidor", () => Promise.resolve(jsonResponse(503, { error: { code: "CLOCK_TEMPORARY_FAILURE", message: "x" } })), ApiError],
    ["sin red", () => Promise.reject(new TypeError("Failed to fetch")), NetworkError],
  ])("%s no cierra la sesión ni avisa: la identidad se conserva", async (_label, respond, errorType) => {
    clockDeviceSession.start(IDENTITY);
    const listener = vi.fn();
    const unsubscribe = clockDeviceSession.onAuthFailure(listener);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(respond));

    await expect(clockDeviceRequest("/time-entries/clock/status", { method: "POST", body: {} })).rejects.toBeInstanceOf(errorType);

    expect(listener).not.toHaveBeenCalled();
    expect(clockDeviceSession.isActive()).toBe(true);
    unsubscribe();
  });
});
