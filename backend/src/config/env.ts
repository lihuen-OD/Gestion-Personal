import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  return value;
}, z.boolean());

const envSchema = z.object({
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  NODE_ENV: z.enum(["development", "test", "demo", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4001),
  API_PREFIX: z.string().default("/api"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 characters"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 characters"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  CLOCK_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  CLOCK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  CLOCK_DEVICE_TOKEN: z.string().min(16).optional(),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  REFRESH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  JSON_BODY_LIMIT: z.string().default("40mb"),
  STORAGE_PROVIDER: z.enum(["local", "cloudinary", "google_drive"]).default("local"),
  // Etapa 15D.2 (docs/decisions/STORAGE_UPLOAD_POLICY_15D2.md): opcionales,
  // sin default — sólo afectan qué provider recibe un upload NUEVO por
  // módulo/propósito. Cadena de resolución: la variable específica del
  // propósito -> DEFAULT_STORAGE_PROVIDER -> STORAGE_PROVIDER (arriba). Un
  // .env que sólo define STORAGE_PROVIDER sigue comportándose exactamente
  // igual que antes de esta etapa. La lectura/eliminación de archivos ya
  // existentes nunca usa estas variables — sigue resolviendo por
  // StorageFile.storageProvider persistido (Etapa 15D.1).
  DEFAULT_STORAGE_PROVIDER: z.enum(["local", "cloudinary", "google_drive"]).optional(),
  DOCUMENT_STORAGE_PROVIDER: z.enum(["local", "cloudinary", "google_drive"]).optional(),
  PUNCH_PHOTO_STORAGE_PROVIDER: z.enum(["local", "cloudinary", "google_drive"]).optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default("gestion-personal"),
  GOOGLE_DRIVE_ENABLED: envBoolean.default(false),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().optional(),
  GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_DRIVE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_DRIVE_PROJECT_ID: z.string().optional(),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().positive().default(10),
  MAX_PUNCH_PHOTO_SIZE_MB: z.coerce.number().positive().default(2),
  CLOCK_ATTEMPT_PROCESSING_TTL_MS: z.coerce.number().int().positive().default(60_000),
  CLOCK_ATTEMPT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  CLOCK_ATTEMPT_MAINTENANCE_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  ATTENDANCE_INACTIVITY_CHECK_HOUR: z.coerce.number().int().min(0).max(23).default(1),
  ATTENDANCE_INACTIVITY_CHECK_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  // Etapa 15M.19A (docs/decisions/DURABLE_ATTENDANCE_INACTIVITY_SCHEDULER_15M19A.md):
  // tope de fechas operativas que el catch-up procesa en un mismo tick del
  // scheduler de 60s. 14 (dos semanas) cubre cualquier fin de semana/feriado
  // largo real en una sola pasada; una caída más extensa simplemente sigue
  // drenándose en los ticks siguientes (cada 60s), sin bloquear el event
  // loop con una corrida sin límite.
  ATTENDANCE_INACTIVITY_MAX_CATCHUP_DATES: z.coerce.number().int().positive().default(14),
  // Etapa 15M.19A: sólo aplica la PRIMERA vez que corre (todavía no existe
  // fila en JobCheckpoint). Sin configurar, el bootstrap inicializa el
  // checkpoint en "ayer" y no reprocesa historia (ver docs/decisions/
  // DURABLE_ATTENDANCE_INACTIVITY_SCHEDULER_15M19A.md §Bootstrap). Formato
  // "YYYY-MM-DD" — nunca hardcodear una fecha en el código.
  ATTENDANCE_INACTIVITY_BOOTSTRAP_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ATTENDANCE_INACTIVITY_BOOTSTRAP_DATE must be YYYY-MM-DD").optional(),
  // Etapa 14B.2 — logging seguro de performance (ver docs/decisions/PERFORMANCE_LOGGING_14B2.md).
  // PERFORMANCE_LOGGING_ENABLED sin valor explícito: activo fuera de production,
  // apagado por defecto en production (opt-in explícito requerido ahí).
  PERFORMANCE_LOGGING_ENABLED: envBoolean.optional(),
  PERFORMANCE_LOGGING_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  PERFORMANCE_SLOW_REQUEST_MS: z.coerce.number().int().positive().default(1000),
  PERFORMANCE_VERY_SLOW_REQUEST_MS: z.coerce.number().int().positive().default(3000),
  PERFORMANCE_LOG_INCLUDE_QUERY_METRICS: envBoolean.default(true),
});

const envSchemaWithRefinements = envSchema.refine(
  (data) => data.PERFORMANCE_VERY_SLOW_REQUEST_MS >= data.PERFORMANCE_SLOW_REQUEST_MS,
  {
    message: "PERFORMANCE_VERY_SLOW_REQUEST_MS must be >= PERFORMANCE_SLOW_REQUEST_MS",
    path: ["PERFORMANCE_VERY_SLOW_REQUEST_MS"],
  },
);

const parsed = envSchemaWithRefinements.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid backend environment configuration");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Invalid backend environment configuration");
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";

/**
 * Etapa 14B.2 — helpers leídos en cada llamada (no cacheados en una const de
 * módulo) a propósito, para que los tests puedan mutar `env.*` en caliente,
 * mismo patrón ya usado por `clockDeviceAuth.ts` con `env.NODE_ENV`/
 * `env.CLOCK_DEVICE_TOKEN`.
 */
export function isPerformanceLoggingEnabled(): boolean {
  return env.PERFORMANCE_LOGGING_ENABLED ?? env.NODE_ENV !== "production";
}

export function shouldRecordQueryMetrics(): boolean {
  return isPerformanceLoggingEnabled() && env.PERFORMANCE_LOG_INCLUDE_QUERY_METRICS;
}
