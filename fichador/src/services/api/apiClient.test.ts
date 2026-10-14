import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError, apiErrorFromStored, apiRequest, formatClockErrorMessage, getUserErrorMessage } from "./apiClient";
import { clockDeviceSession } from "./clockDeviceSession";
import { clockEndpoints, timeClockApiService } from "./timeClockApiService";

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
    await expect(apiRequest("/clock/status")).rejects.toMatchObject({ name: "ApiError", status, code, message });
  });

  it("429 (cuerpo de texto del rate limiter): pide esperar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Too many requests, please try again later.", { status: 429 })));
    await expect(apiRequest("/clock/employees?search=go")).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/demasiados intentos/) });
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
    const error = await apiRequest("/clock/status").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(getUserErrorMessage(error, "x")).toMatch(/No hay conexión con el servidor/);
  });

  it("timeout: el error de AbortSignal se propaga tal cual (mismo comportamiento que el admin)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(apiRequest("/clock/photo-punch", { method: "POST", body: {} })).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("un error desconocido nunca se muestra crudo", () => {
    expect(getUserErrorMessage(new Error("TypeError: cannot read properties of undefined"), "No se pudo buscar empleados.")).toBe("No se pudo buscar empleados.");
  });
});

describe("timeClockApiService del fichador — sólo los cuatro endpoints de /api/clock, sin JWT (F8)", () => {
  it("autentica con la identidad individual del equipo, nunca con Bearer ni con el token compartido retirado", async () => {
    vi.stubEnv("VITE_CLOCK_DEVICE_TOKEN", "temporary-shared-token");
    clockDeviceSession.start(IDENTITY);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await timeClockApiService.searchEmployees(" Gomez ");

    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers((init as RequestInit).headers);
    expect(String(url)).toMatch(/\/api\/clock\/employees\?search=Gomez$/);
    expect(headers.get("authorization")).toBe(`ClockDevice ${IDENTITY.id}.${IDENTITY.secret}`);
    expect(headers.get("x-clock-app-version")).toBeTruthy();
    expect(headers.has("x-clock-device-token")).toBe(false);
    expect(JSON.stringify([...headers])).not.toContain("temporary-shared-token");
  });

  it("usa exactamente los endpoints de /api/clock (F8), todos con la credencial del equipo y ninguno del namespace legacy", async () => {
    clockDeviceSession.start(IDENTITY);
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, { data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await timeClockApiService.status("employee-1");
    await timeClockApiService.photoPunch({ requestId: "r-1", employeeId: "employee-1", punchType: "IN", photo: "data:image/jpeg;base64,AA", faceValidationStatus: "VALID" });
    await timeClockApiService.attemptStatus("r-1", "employee-1");

    const calls = fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit).method} ${String(url).replace(/^.*\/api/, "")}`);
    expect(calls).toEqual([
      "POST /clock/status",
      "POST /clock/photo-punch",
      "GET /clock/attempts/r-1?employeeId=employee-1",
    ]);
    expect(fetchMock.mock.calls.map(([url]) => String(url)).join(" ")).not.toContain("time-entries");
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers((init as RequestInit).headers).get("authorization")).toBe(`ClockDevice ${IDENTITY.id}.${IDENTITY.secret}`);
    }
  });
});

describe("F8 — contrato del cliente con /api/clock", () => {
  it("las rutas operativas salen de una sola fuente y ninguna es legacy", () => {
    expect(clockEndpoints).toMatchObject({ employees: "/clock/employees", status: "/clock/status", photoPunch: "/clock/photo-punch" });
    expect(clockEndpoints.attempt("r-1")).toBe("/clock/attempts/r-1");
    expect(JSON.stringify(clockEndpoints)).not.toContain("time-entries");
  });

  it("photo-punch manda el payload tal cual: sin source ni deviceId, con el requestId de la intención", async () => {
    clockDeviceSession.start(IDENTITY);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { requestId: "11111111-1111-4111-8111-111111111111", employeeId: "employee-1", punchType: "OUT" as const, photo: "data:image/jpeg;base64,AA", thumbnail: "data:image/jpeg;base64,AA", faceValidationStatus: "VALID" as const, faceDetectionScore: 0.9, device: { platform: "iPad" } };

    await timeClockApiService.photoPunch(input);

    const sent = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;
    expect(sent).toEqual(input);
    expect(sent).not.toHaveProperty("source");
    expect(sent).not.toHaveProperty("deviceId");
    expect(sent).not.toHaveProperty("timestamp");
  });

  it("un 409 de cooldown conserva retryAfterSeconds en el ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { error: { code: "CLOCK_PUNCH_COOLDOWN", message: "Ya registraste una fichada hace instantes.", retryAfterSeconds: 42 } })));
    await expect(apiRequest("/clock/photo-punch", { method: "POST", body: {} })).rejects.toMatchObject({ code: "CLOCK_PUNCH_COOLDOWN", status: 409, retryAfterSeconds: 42 });
  });

  it.each([["texto", "42"], ["negativo", -1], ["decimal", 1.5]])("un retryAfterSeconds inválido (%s) se ignora", async (_label, value) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { error: { code: "CLOCK_PUNCH_COOLDOWN", message: "x", retryAfterSeconds: value } })));
    const error = await apiRequest("/clock/photo-punch", { method: "POST", body: {} }).catch((caught: unknown) => caught);
    expect((error as ApiError).retryAfterSeconds).toBeUndefined();
  });

  it("el error guardado de un intento (GET attempts) se rearma igual que la respuesta original", () => {
    const error = apiErrorFromStored({ code: "CLOCK_PUNCH_COOLDOWN", message: "Ya registraste una fichada hace instantes.", httpStatus: 409, retryAfterSeconds: 42 });
    expect(error).toMatchObject({ code: "CLOCK_PUNCH_COOLDOWN", status: 409, retryAfterSeconds: 42, message: "Ya registraste una fichada hace instantes." });
  });

  it("CLOCK_IDEMPOTENCY_KEY_REUSED: mensaje humano para volver a empezar, nunca el texto técnico", () => {
    expect(formatClockErrorMessage(409, { error: { code: "CLOCK_IDEMPOTENCY_KEY_REUSED", message: "La clave de fichada ya fue utilizada para otra operación." } }))
      .toBe("No pudimos recuperar esta fichada. Volvé a iniciar el proceso.");
  });
});
