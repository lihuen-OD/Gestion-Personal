/**
 * Único criterio de un `retryAfterSeconds` válido (entero finito >= 0). Lo
 * usan AppError y quien lo relea de una persistencia (JSON): un valor que no
 * cumple se descarta, nunca se publica.
 */
export function publicRetryAfterSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  /**
   * Segundos que el cliente debe esperar antes de reintentar. A diferencia de
   * `details` (que el errorHandler oculta en production), es un dato público
   * y acotado que se devuelve en todos los entornos.
   */
  readonly retryAfterSeconds?: number;

  constructor(message: string, statusCode = 500, code = "INTERNAL_ERROR", details?: unknown, options: { retryAfterSeconds?: number } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = publicRetryAfterSeconds(options.retryAfterSeconds);
  }
}
