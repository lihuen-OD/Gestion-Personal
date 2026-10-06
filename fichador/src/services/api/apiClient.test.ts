import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError, apiRequest, formatClockErrorMessage, getUserErrorMessage } from "./apiClient";
import { clockDeviceSession } from "./clockDeviceSession";
import { timeClockApiService } from "./timeClockApiService";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const IDENTITY = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret: "s".repeat(43) };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clockDeviceSession.end();
});

describe("apiClient del fichador — errores para la persona que ficha", () => {
  it.each([
    [401, "CLOCK_DEVICE_INVALID_CREDENTIAL", "Este dispositivo perdió su autorización. Volvé a configurarlo."],
    [403, "CLOCK_DEVICE_NOT_ACTIVE", "Este dispositivo todavía no fue aprobado por RRHH."],
    [403, "CLOCK_DEVICE_REVOKED", "Este dispositivo fue deshabilitado por RRHH."],
  ])("%i %s: mensaje humano, nunca el texto técnico del backend", async (status, code, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, { error: { code, message: "Invalid device credentials" } })));
    await expect(apiRequest("/time-entries/clock/status")).rejects.toMatchObject({ name: "ApiError", status, code, message });
  });

  it("429 (cuerpo de texto del rate limiter): pide esperar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Too many requests, please try again later.", { status: 429 })));
    await expect(apiRequest("/time-entries/clock/employees?search=go")).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/demasiados intentos/) });
  });

  it("409 de negocio CLOCK_*: usa el mensaje del backend (ya escrito para el kiosco)", () => {
    expect(formatClockErrorMessage(409, { error: { code: "CLOCK_ALREADY_OPEN", message: "Ya existe un ingreso abierto para este empleado." } })).toBe("Ya existe un ingreso abierto para este empleado.");
  });

  it("403 sin código del fichador: mensaje genérico", () => {
    expect(formatClockErrorMessage(403, { error: { code: "FORBIDDEN", message: "You do not have permission to perform this action" } })).toBe("No pudimos completar la operación. Intentá nuevamente.");
  });

  it("5xx sin código del fichador: servicio no disponible, nunca el texto técnico", () => {
    expect(formatClockErrorMessage(500, { error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } })).toMatch(/no está disponible/);
    expect(formatClockErrorMessage(502, {})).toMatch(/no está disponible/);
  });

  it("backend apagado / sin Internet: NetworkError (no ApiError, para que la verificación del intento siga)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = await apiRequest("/time-entries/clock/status").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(getUserErrorMessage(error, "x")).toMatch(/No hay conexión con el servidor/);
  });

  it("timeout: el error de AbortSignal se propaga tal cual (mismo comportamiento que el admin)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(apiRequest("/time-entries/clock/photo-punch", { method: "POST", body: {} })).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("un error desconocido nunca se muestra crudo", () => {
    expect(getUserErrorMessage(new Error("TypeError: cannot read properties of undefined"), "No se pudo buscar empleados.")).toBe("No se pudo buscar empleados.");
  });
});

describe("timeClockApiService del fichador — sólo los cuatro endpoints, sin JWT", () => {
  it("autentica con la identidad individual del equipo, nunca con Bearer ni con el token compartido retirado", async () => {
    vi.stubEnv("VITE_CLOCK_DEVICE_TOKEN", "temporary-shared-token");
    clockDeviceSession.start(IDENTITY);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await timeClockApiService.searchEmployees(" Gomez ");

    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers((init as RequestInit).headers);
    expect(String(url)).toMatch(/\/time-entries\/clock\/employees\?search=Gomez$/);
    expect(headers.get("authorization")).toBe(`ClockDevice ${IDENTITY.id}.${IDENTITY.secret}`);
    expect(headers.get("x-clock-app-version")).toBeTruthy();
    expect(headers.has("x-clock-device-token")).toBe(false);
    expect(JSON.stringify([...headers])).not.toContain("temporary-shared-token");
  });

  it("usa exactamente los endpoints vigentes de F0, todos con la credencial del equipo", async () => {
    clockDeviceSession.start(IDENTITY);
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, { data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await timeClockApiService.status("employee-1");
    await timeClockApiService.photoPunch({ requestId: "r-1", employeeId: "employee-1", punchType: "IN", photo: "data:image/jpeg;base64,AA", faceValidationStatus: "VALID" });
    await timeClockApiService.attemptStatus("r-1", "employee-1");

    const calls = fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit).method} ${String(url).replace(/^.*\/api/, "")}`);
    expect(calls).toEqual([
      "POST /time-entries/clock/status",
      "POST /time-entries/clock/photo-punch",
      "GET /time-entries/clock/attempts/r-1?employeeId=employee-1",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers((init as RequestInit).headers).get("authorization")).toBe(`ClockDevice ${IDENTITY.id}.${IDENTITY.secret}`);
    }
  });
});
