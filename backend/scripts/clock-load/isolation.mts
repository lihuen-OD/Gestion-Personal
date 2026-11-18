/**
 * Guardas y backend aislado de las pruebas de carga del fichador (§33 de
 * docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md).
 *
 * - La base es SIEMPRE PostgreSQL local, con nombre `clock_load*`; cualquier
 *   otra URL aborta antes de conectar.
 * - El backend bajo prueba se lanza con un entorno MÍNIMO y explícito (nunca
 *   hereda el `.env` del repo ni variables del proceso: corre en un directorio
 *   de trabajo propio, sin `.env`), con fotos en almacenamiento local dentro de
 *   ese directorio, sin schedulers salvo el worker del post-proceso, y con
 *   secretos JWT efímeros.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BACKEND_DIR = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertLoadDatabaseUrl(raw: string | undefined): string {
  if (!raw) throw new Error("CLOCK_LOAD_DATABASE_URL es obligatoria (PostgreSQL local, base clock_load*).");
  const url = new URL(raw);
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error(`Abortado: la base de carga debe ser local (recibido host ${url.hostname}).`);
  const database = url.pathname.slice(1);
  if (!/^clock_load[a-z0-9_]*$/.test(database)) throw new Error(`Abortado: la base de carga debe llamarse clock_load* (recibido "${database}").`);
  return raw;
}

export function assertLocalBaseUrl(raw: string) {
  const url = new URL(raw);
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error(`Abortado: el backend bajo prueba debe ser local (recibido ${url.hostname}).`);
}

export type IsolatedBackend = {
  baseUrl: string;
  pid: number;
  logPath: string;
  uploadsDir: string;
  stop: () => Promise<void>;
};

export async function startIsolatedBackend(options: { databaseUrl: string; port: number; workDir: string; extraEnv?: Record<string, string>; backendDir?: string }): Promise<IsolatedBackend> {
  const backendDir = options.backendDir ?? BACKEND_DIR;
  mkdirSync(options.workDir, { recursive: true });
  if (existsSync(join(options.workDir, ".env"))) throw new Error("Abortado: el directorio de trabajo del backend de carga no puede tener .env.");
  const logPath = join(options.workDir, `backend-${Date.now()}.log`);
  const log = createWriteStream(logPath);
  const env: Record<string, string> = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: process.env.HOME || options.workDir,
    TZ: "UTC",
    APP_ENV: "local",
    NODE_ENV: "development",
    PORT: String(options.port),
    API_PREFIX: "/api",
    CORS_ORIGIN: "http://localhost:5199",
    DATABASE_URL: options.databaseUrl,
    JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
    JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
    // El cliente simulado manda X-Forwarded-For: una IP pública distinta por red.
    TRUST_PROXY_HOPS: "1",
    STORAGE_PROVIDER: "local",
    DEFAULT_STORAGE_PROVIDER: "local",
    PUNCH_PHOTO_STORAGE_PROVIDER: "local",
    DOCUMENT_STORAGE_PROVIDER: "local",
    GOOGLE_DRIVE_ENABLED: "false",
    AUTOMATIC_JOBS_ENABLED: "false",
    CLOCK_POSTPROCESS_WORKER_ENABLED: "true",
    // Como production por defecto: sin el log de rendimiento por request.
    PERFORMANCE_LOGGING_ENABLED: "false",
    ...options.extraEnv,
  };
  const loader = `file://${join(backendDir, "node_modules", "tsx", "dist", "loader.mjs")}`;
  const child: ChildProcess = spawn(process.execPath, ["--import", loader, join(backendDir, "src", "server.ts")], { cwd: options.workDir, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  const baseUrl = `http://127.0.0.1:${options.port}/api`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`El backend de carga terminó al arrancar (ver ${logPath}).`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) break;
    } catch {
      // todavía arrancando
    }
    if (Date.now() > deadline) {
      child.kill("SIGTERM");
      throw new Error(`El backend de carga no respondió /health en 60 s (ver ${logPath}).`);
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  return {
    baseUrl,
    pid: child.pid!,
    logPath,
    uploadsDir: join(options.workDir, "uploads"),
    stop: () => new Promise<void>((done) => {
      if (child.exitCode !== null) return done();
      child.once("exit", () => done());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }),
  };
}

/** CPU (%) y memoria residente (MB) del proceso, con `ps`. */
export function processUsage(pid: number): { cpu: number; rssMb: number } | null {
  try {
    const [cpu, rss] = execFileSync("ps", ["-o", "%cpu=,rss=", "-p", String(pid)], { encoding: "utf8" }).trim().split(/\s+/);
    return { cpu: Number(cpu), rssMb: Number(rss) / 1024 };
  } catch {
    return null;
  }
}

export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}
