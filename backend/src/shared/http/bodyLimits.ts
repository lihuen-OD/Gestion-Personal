import express, { type Request, type RequestHandler } from "express";
import { AppError } from "../errors/AppError";

/**
 * Límites de tamaño del body JSON (F11, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §30).
 *
 * Hasta F11 había un único `express.json({ limit: "40mb" })` global: cualquier
 * ruta, autenticada o no, parseaba hasta 40 MB antes de llegar a su guarda.
 * Ahora:
 *
 * - El body normal se parsea globalmente con DEFAULT (1 MiB). El body legítimo
 *   más grande fuera de las dos rutas de abajo son las operaciones masivas
 *   (≤ 1000 ids, ~100 KB): 1 MiB deja ~10× de margen.
 * - Sólo dos rutas aceptan más, y su body se parsea DENTRO de la ruta,
 *   después de autenticar y autorizar (el parser global las saltea):
 *   - POST /clock/photo-punch: el schema acepta foto ≤ 4.500.000 caracteres
 *     y miniatura ≤ 600.000 (≈ 5,1 MB con los demás campos); el límite es el
 *     del schema más margen, así el parser nunca rechaza algo que el schema
 *     acepta. Lo real es mucho menos: JPEG de 800 px a calidad 0,84 (en
 *     staging, foto ≤ 53 KB y miniatura ≤ 7 KB; < 100 KB en base64 juntas).
 *   - POST /employees/:id/documents: archivo ≤ 25 MiB, en base64 ≤ 35 MiB
 *     (`fileBase64` del schema) más los metadatos.
 * - Antes de cualquier parser, un `Content-Length` declarado por encima del
 *   límite de su ruta se rechaza con 413 sin leer el body y se cierra la
 *   conexión. Es una defensa adicional: un request sin Content-Length
 *   (chunked) lo frena el límite propio del parser.
 *
 * Si una ruta figura acá pero no monta `jsonBody`, su body queda sin parsear y
 * su validación falla con 400; si monta `jsonBody` pero no figura acá, el
 * parser global ya la cortó en 1 MiB. Las dos desincronizaciones fallan
 * cerradas; bodyLimits.test.ts y los tests de ruta fijan que coincidan.
 */
const MIB = 1024 * 1024;
export const DEFAULT_JSON_BODY_LIMIT_BYTES = 1 * MIB;
export const CLOCK_PHOTO_PUNCH_BODY_LIMIT_BYTES = 6 * MIB;
export const EMPLOYEE_DOCUMENT_BODY_LIMIT_BYTES = 36 * MIB;

type LargeBodyRoute = { method: string; path: RegExp; limit: number };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Insensible a mayúsculas y a la barra final, igual que el routing de Express
// (caseSensitive y strict en false).
export function largeBodyRoutes(apiPrefix: string): LargeBodyRoute[] {
  const prefix = escapeRegExp(apiPrefix.replace(/\/+$/, ""));
  return [
    { method: "POST", path: new RegExp(`^${prefix}/clock/photo-punch/?$`, "i"), limit: CLOCK_PHOTO_PUNCH_BODY_LIMIT_BYTES },
    { method: "POST", path: new RegExp(`^${prefix}/employees/[^/]+/documents/?$`, "i"), limit: EMPLOYEE_DOCUMENT_BODY_LIMIT_BYTES },
  ];
}

export function payloadTooLargeError() {
  return new AppError("El contenido enviado supera el tamaño permitido.", 413, "PAYLOAD_TOO_LARGE");
}

/**
 * Middlewares globales, en este orden: guarda de Content-Length y parser JSON
 * por defecto (que saltea las rutas de body grande).
 */
export function requestBodyLimits(apiPrefix: string): RequestHandler[] {
  const routes = largeBodyRoutes(apiPrefix);
  const largeRouteLimit = (req: Request) => routes.find((route) => route.method === req.method && route.path.test(req.path))?.limit ?? null;
  const defaultParser = express.json({ limit: DEFAULT_JSON_BODY_LIMIT_BYTES });

  const contentLengthGuard: RequestHandler = (req, res, next) => {
    const declared = Number(req.headers["content-length"]);
    const limit = largeRouteLimit(req) ?? DEFAULT_JSON_BODY_LIMIT_BYTES;
    if (Number.isFinite(declared) && declared > limit) {
      // No se lee el body: se responde y se cierra la conexión.
      res.setHeader("Connection", "close");
      return next(payloadTooLargeError());
    }
    return next();
  };

  const defaultJsonParser: RequestHandler = (req, res, next) => (largeRouteLimit(req) === null ? defaultParser(req, res, next) : next());

  return [contentLengthGuard, defaultJsonParser];
}

/** Parser JSON propio de una ruta de body grande; se monta después de sus guardas. */
export function jsonBody(limit: number): RequestHandler {
  return express.json({ limit });
}
