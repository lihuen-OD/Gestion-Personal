import { describe, expect, it } from "vitest";
import { bodyParserError } from "../errors/bodyParserErrors";
import { CLOCK_PHOTO_PUNCH_BODY_LIMIT_BYTES, EMPLOYEE_DOCUMENT_BODY_LIMIT_BYTES, largeBodyRoutes } from "./bodyLimits";

// F11 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §30). Los límites en sí
// se prueban sobre la app real en app.bodyLimits.test.ts.
const routes = largeBodyRoutes("/api");
const limitFor = (method: string, path: string) => routes.find((route) => route.method === method && route.path.test(path))?.limit ?? null;

describe("largeBodyRoutes — qué rutas parsean su propio body grande", () => {
  it.each([
    ["POST", "/api/clock/photo-punch", CLOCK_PHOTO_PUNCH_BODY_LIMIT_BYTES],
    ["POST", "/api/clock/photo-punch/", CLOCK_PHOTO_PUNCH_BODY_LIMIT_BYTES],
    ["POST", "/API/Clock/Photo-Punch", CLOCK_PHOTO_PUNCH_BODY_LIMIT_BYTES],
    ["POST", "/api/employees/11111111-1111-4111-8111-111111111111/documents", EMPLOYEE_DOCUMENT_BODY_LIMIT_BYTES],
    ["POST", "/api/employees/x/documents/", EMPLOYEE_DOCUMENT_BODY_LIMIT_BYTES],
  ])("%s %s → límite propio (Express rutea sin distinguir mayúsculas ni barra final)", (method, path, limit) => {
    expect(limitFor(method, path)).toBe(limit);
  });

  it.each([
    ["GET", "/api/clock/photo-punch"],
    ["PUT", "/api/employees/x/documents"],
    ["POST", "/api/clock/photo-punch/extra"],
    ["POST", "/api/clock/status"],
    ["POST", "/api/time-entries/clock/photo-punch"],
    ["POST", "/api/employees/x/documents/y"],
    ["POST", "/api/employees/x/y/documents"],
    ["POST", "/apixclock/photo-punch"],
    ["POST", "/clock/photo-punch"],
  ])("%s %s → límite general", (method, path) => {
    expect(limitFor(method, path)).toBeNull();
  });

  it("escapa el prefijo de la API", () => {
    const dotted = largeBodyRoutes("/v1.api/");
    expect(dotted.some((route) => route.path.test("/v1.api/clock/photo-punch"))).toBe(true);
    expect(dotted.some((route) => route.path.test("/v1xapi/clock/photo-punch"))).toBe(false);
  });
});

describe("bodyParserError — errores de body como 4xx con el contrato de la API", () => {
  it.each([
    ["entity.too.large", 413, "PAYLOAD_TOO_LARGE"],
    ["entity.parse.failed", 400, "INVALID_JSON"],
    ["request.size.invalid", 400, "INVALID_REQUEST_BODY"],
    ["request.aborted", 400, "INVALID_REQUEST_BODY"],
    ["encoding.unsupported", 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["charset.unsupported", 415, "UNSUPPORTED_MEDIA_TYPE"],
  ])("%s → %i %s, sin el body recibido", (type, statusCode, code) => {
    const error = Object.assign(new Error("detalle"), { type, body: '{"photo":"data:image/jpeg;base64,AAAA' });
    const mapped = bodyParserError(error);
    expect(mapped).toMatchObject({ statusCode, code });
    expect(JSON.stringify(mapped)).not.toContain("base64");
  });

  it("cualquier otro error sigue siendo un error del servidor", () => {
    expect(bodyParserError(new Error("boom"))).toBeNull();
    expect(bodyParserError(Object.assign(new Error("x"), { type: "stream.not.readable" }))).toBeNull();
    expect(bodyParserError(null)).toBeNull();
  });
});
