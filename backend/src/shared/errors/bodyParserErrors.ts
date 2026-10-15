import { AppError } from "./AppError";

/**
 * Errores de `express.json` (body-parser) traducidos al contrato de error de
 * la API (F11). Sin esto, el errorHandler los convertía en 500 INTERNAL_ERROR:
 * un body demasiado grande o un JSON mal formado son errores del cliente.
 * Nunca se devuelve ni se registra el body recibido.
 */
const CLIENT_BODY_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  "entity.too.large": { status: 413, code: "PAYLOAD_TOO_LARGE", message: "El contenido enviado supera el tamaño permitido." },
  "entity.parse.failed": { status: 400, code: "INVALID_JSON", message: "El contenido enviado no es un JSON válido." },
  "request.size.invalid": { status: 400, code: "INVALID_REQUEST_BODY", message: "El contenido enviado no coincide con su tamaño declarado." },
  "request.aborted": { status: 400, code: "INVALID_REQUEST_BODY", message: "La solicitud se interrumpió antes de terminar de enviarse." },
  "encoding.unsupported": { status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: "La codificación del contenido no está soportada." },
  "charset.unsupported": { status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: "El juego de caracteres del contenido no está soportado." },
};

export function bodyParserError(error: unknown): AppError | null {
  const type = typeof error === "object" && error !== null && "type" in error ? (error as { type: unknown }).type : undefined;
  const known = typeof type === "string" ? CLIENT_BODY_ERRORS[type] : undefined;
  return known ? new AppError(known.message, known.status, known.code) : null;
}
