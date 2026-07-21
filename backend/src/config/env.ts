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
  JSON_BODY_LIMIT: z.string().default("40mb"),
  STORAGE_PROVIDER: z.enum(["local", "cloudinary", "google_drive"]).default("local"),
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
  ATTENDANCE_INACTIVITY_CHECK_HOUR: z.coerce.number().int().min(0).max(23).default(4),
  ATTENDANCE_INACTIVITY_CHECK_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid backend environment configuration");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Invalid backend environment configuration");
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
