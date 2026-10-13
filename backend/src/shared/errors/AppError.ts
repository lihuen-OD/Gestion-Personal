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
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
