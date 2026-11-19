/**
 * Guardas de los diagnósticos de SÓLO LECTURA de turnos (Etapa R1,
 * docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §19).
 *
 * Tres capas, independientes entre sí:
 *   1. Argumentos: lista blanca cerrada. Un flag de aplicación/escritura (o
 *      cualquier flag que no esté en la lista) aborta antes de conectar.
 *   2. Destino: el destino se declara (`--env-file` + `--expected-host`); un
 *      destino declarado production exige `--production-read-authorized` y uno
 *      remoto no declarado production exige `--confirm-non-production`.
 *   3. Ejecución: todo corre en una transacción `READ ONLY` verificada con
 *      `SHOW transaction_read_only` (Postgres rechaza cualquier escritura) y el
 *      cliente que recibe el diagnóstico es un proxy que sólo expone
 *      operaciones de lectura de los modelos.
 *
 * NO agregar acá operaciones de escritura: este archivo y el script que lo usa
 * están cubiertos por un test que falla si aparecen (readOnlyDiagnostic.test.ts).
 */
import type { PrismaClient } from "@prisma/client";

export const READ_ONLY_DIAGNOSTIC_MODE = "READ ONLY DIAGNOSTIC";

// ── 1. Argumentos ───────────────────────────────────────────────────────────

export type DiagnosticArgs = {
  envFile: string;
  expectedHost: string;
  from: string | null;
  to: string | null;
  json: boolean;
  confirmNonProduction: boolean;
  productionReadAuthorized: boolean;
};

const VALUE_FLAGS = new Set(["env-file", "expected-host", "from", "to"]);
const BOOLEAN_FLAGS = new Set(["json", "confirm-non-production", "production-read-authorized"]);
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export class DiagnosticUsageError extends Error {}

export function parseDiagnosticArgs(argv: string[]): DiagnosticArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (const raw of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(raw);
    if (!match) throw new DiagnosticUsageError(`Argumento no reconocido: "${raw}". Este diagnóstico no acepta argumentos posicionales.`);
    const [, name, value] = match as unknown as [string, string, string | undefined];
    if (VALUE_FLAGS.has(name)) {
      if (!value) throw new DiagnosticUsageError(`--${name} requiere un valor (--${name}=...).`);
      values.set(name, value);
    } else if (BOOLEAN_FLAGS.has(name) && value === undefined) {
      flags.add(name);
    } else {
      throw new DiagnosticUsageError(`Flag no permitido: --${name}. Este diagnóstico es de SÓLO LECTURA y no tiene modos de escritura.`);
    }
  }
  const envFile = values.get("env-file");
  const expectedHost = values.get("expected-host");
  if (!envFile) throw new DiagnosticUsageError("Falta --env-file=<archivo>: el destino nunca se toma implícitamente del .env habitual.");
  if (!expectedHost) throw new DiagnosticUsageError("Falta --expected-host=<host>: el destino debe declararse explícitamente.");
  const from = values.get("from") ?? null;
  const to = values.get("to") ?? null;
  for (const [name, value] of [["from", from], ["to", to]] as const) {
    if (value !== null && (!DATE_KEY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) {
      throw new DiagnosticUsageError(`--${name} debe ser una fecha YYYY-MM-DD válida.`);
    }
  }
  if (from && to && to < from) throw new DiagnosticUsageError("--to no puede ser anterior a --from.");
  return {
    envFile,
    expectedHost,
    from,
    to,
    json: flags.has("json"),
    confirmNonProduction: flags.has("confirm-non-production"),
    productionReadAuthorized: flags.has("production-read-authorized"),
  };
}

// ── 2. Destino ──────────────────────────────────────────────────────────────

export type DatabaseTarget = {
  host: string;
  database: string;
  isLocal: boolean;
  appEnv: string | null;
  nodeEnv: string | null;
  declaredProduction: boolean;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Describe el destino SIN exponer usuario, contraseña ni parámetros de la conexión. */
export function describeDatabaseTarget(databaseUrl: string | undefined, envVars: Record<string, string | undefined>): DatabaseTarget {
  if (!databaseUrl) throw new DiagnosticUsageError("El archivo de entorno no define DATABASE_URL.");
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new DiagnosticUsageError("DATABASE_URL no es una URL válida (no se muestra su contenido).");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new DiagnosticUsageError("DATABASE_URL no es una conexión PostgreSQL.");
  const appEnv = envVars.APP_ENV?.trim() || null;
  const nodeEnv = envVars.NODE_ENV?.trim() || null;
  return {
    host: url.hostname,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "(sin nombre)",
    isLocal: LOCAL_HOSTS.has(url.hostname),
    appEnv,
    nodeEnv,
    declaredProduction: appEnv === "production" || nodeEnv === "production",
  };
}

export class DiagnosticTargetRefused extends Error {}

export function assertDiagnosticTargetAllowed(target: DatabaseTarget, args: Pick<DiagnosticArgs, "expectedHost" | "confirmNonProduction" | "productionReadAuthorized">) {
  if (target.host !== args.expectedHost) {
    throw new DiagnosticTargetRefused(`Destino inesperado: la conexión apunta a ${target.host} y se esperaba ${args.expectedHost}. No se ejecutó nada.`);
  }
  if (target.declaredProduction && !args.productionReadAuthorized) {
    throw new DiagnosticTargetRefused(
      `STOP: el destino se declara production (APP_ENV=${target.appEnv ?? "-"}, NODE_ENV=${target.nodeEnv ?? "-"}). ` +
        "Leer production requiere autorización explícita previa y el flag --production-read-authorized. No se ejecutó nada.",
    );
  }
  if (!target.isLocal && !target.declaredProduction && !args.confirmNonProduction && !args.productionReadAuthorized) {
    throw new DiagnosticTargetRefused(
      `STOP: ${target.host} es un destino remoto y su identidad no está verificada. ` +
        "Si se confirmó que NO es production, repetir con --confirm-non-production. No se ejecutó nada.",
    );
  }
}

export function diagnosticHeader(target: DatabaseTarget, range: { from: string; to: string; days: number }): string[] {
  return [
    `Mode: ${READ_ONLY_DIAGNOSTIC_MODE}`,
    `Host: ${target.host}${target.isLocal ? " (local)" : " (remoto, identidad no verificada)"}`,
    `Database: ${target.database}`,
    `Declared env: APP_ENV=${target.appEnv ?? "-"} NODE_ENV=${target.nodeEnv ?? "-"}`,
    `Range: ${range.from} → ${range.to} (${range.days} días)`,
  ];
}

// ── 3. Ejecución ────────────────────────────────────────────────────────────

const READ_OPERATIONS: ReadonlySet<string> = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

export class ReadOnlyViolationError extends Error {}

/**
 * Proxy de un cliente/transacción de Prisma que sólo deja usar operaciones de
 * lectura de los modelos. Cualquier otra (escrituras, `$`-métodos, raw) lanza
 * antes de llegar a la base.
 */
export function readOnlyClient<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (typeof property !== "string") return Reflect.get(target, property, receiver);
      if (property === "then") return undefined;
      if (property.startsWith("$")) throw new ReadOnlyViolationError(`Operación bloqueada en el diagnóstico de sólo lectura: ${property}.`);
      const delegate = Reflect.get(target, property, receiver) as unknown;
      if (!delegate || typeof delegate !== "object") throw new ReadOnlyViolationError(`Propiedad no permitida en el diagnóstico de sólo lectura: ${property}.`);
      return new Proxy(delegate as object, {
        get(model, operation, modelReceiver) {
          if (typeof operation !== "string" || !READ_OPERATIONS.has(operation)) {
            throw new ReadOnlyViolationError(`Operación bloqueada en el diagnóstico de sólo lectura: ${property}.${String(operation)}.`);
          }
          const fn = Reflect.get(model, operation, modelReceiver) as (...args: unknown[]) => unknown;
          return (...args: unknown[]) => fn.apply(model, args);
        },
      });
    },
    set() {
      throw new ReadOnlyViolationError("El cliente del diagnóstico es de sólo lectura.");
    },
  });
}

type ReadOnlyCapableClient = Pick<PrismaClient, "$transaction">;
type ReadOnlyTx = { $executeRaw: PrismaClient["$executeRaw"]; $queryRaw: PrismaClient["$queryRaw"] };

/**
 * Corre `operation` dentro de una transacción que Postgres marca READ ONLY.
 * Verifica el modo antes de leer nada; si no está activo, aborta.
 */
export async function runInReadOnlyTransaction<T>(prisma: ReadOnlyCapableClient, operation: (reader: never) => Promise<T>, timeout = 300_000): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const raw = tx as unknown as ReadOnlyTx;
      // Única sentencia no-SELECT del diagnóstico: activa la protección de Postgres.
      await raw.$executeRaw`SET TRANSACTION READ ONLY`;
      const [mode] = await raw.$queryRaw<Array<{ transaction_read_only: string }>>`SHOW transaction_read_only`;
      if (mode?.transaction_read_only !== "on") throw new ReadOnlyViolationError("La transacción no quedó en modo READ ONLY. No se leyó nada.");
      return operation(readOnlyClient(tx as object) as never);
    },
    { timeout, maxWait: 30_000 },
  );
}
