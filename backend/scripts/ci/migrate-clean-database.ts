/**
 * Gate de migraciones (docs/GIT_WORKFLOW.md §5): aplica TODO el historial de
 * `prisma/migrations` sobre una base PostgreSQL VACÍA y verifica que el resultado sea
 * exactamente `prisma/schema.prisma` (`migrate status` al día y `migrate diff` vacío).
 *
 * `prisma migrate deploy` solo no alcanza: `20260824170000_normalize_hour_concepts` exige
 * la fila HC-NORMAL, que crea `prisma/seed.ts` y ninguna migración, y aborta en una base
 * vacía (documentado desde la Etapa 10D, docs/decisions/WORK_REGIME_SHIFT_ALERTS_10D.md).
 * Las migraciones ya aplicadas no se editan, así que el script aplica el historial hasta
 * la anterior, inserta esa única fila —la misma que tiene toda base real— y completa el
 * resto con `migrate deploy`, que reconoce las ya aplicadas por nombre y checksum.
 *
 * Uso (sólo PostgreSQL local o efímero, base vacía):
 *   DATABASE_URL=postgresql://<user>@localhost:5432/<base> npx tsx scripts/ci/migrate-clean-database.ts [--clone=a,b]
 * `--clone` crea, ya verificada, una copia por nombre (CREATE DATABASE … TEMPLATE): las
 * integraciones opt-in vacían su base al empezar y cada una necesita la suya.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const BOOTSTRAP_MIGRATION = "20260824170000_normalize_hour_concepts";
const BACKEND_DIR = join(__dirname, "..", "..");
const PRISMA_DIR = join(BACKEND_DIR, "prisma");
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];
const DATABASE_NAME = /^[a-z][a-z0-9_]*$/;

function runPrisma(args: string[], databaseUrl: string) {
  execFileSync("npx", ["prisma", ...args], { cwd: BACKEND_DIR, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "inherit" });
}

function parseLocalUrl(raw: string | undefined) {
  if (!raw) throw new Error("DATABASE_URL es obligatoria.");
  const url = new URL(raw);
  if (!LOCAL_HOSTS.includes(url.hostname)) throw new Error(`Sólo corre contra PostgreSQL local o efímero (DATABASE_URL apunta a ${url.hostname}).`);
  const database = url.pathname.slice(1);
  if (!DATABASE_NAME.test(database)) throw new Error(`Nombre de base inválido: "${database}".`);
  return url;
}

function urlForDatabase(url: URL, database: string) {
  const copy = new URL(url.toString());
  copy.pathname = `/${database}`;
  return copy.toString();
}

async function withClient<T>(databaseUrl: string, work: (db: PrismaClient) => Promise<T>) {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    return await work(db);
  } finally {
    await db.$disconnect();
  }
}

async function assertEmpty(databaseUrl: string) {
  const tables = await withClient(databaseUrl, (db) => db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`));
  if (tables[0]?.n) throw new Error(`La base no está vacía (${tables[0].n} tablas en public): el gate necesita una base limpia.`);
}

function applyHistoryBeforeBootstrap(databaseUrl: string) {
  const migrations = readdirSync(join(PRISMA_DIR, "migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (!migrations.includes(BOOTSTRAP_MIGRATION)) throw new Error(`No existe ${BOOTSTRAP_MIGRATION}: revisar este script.`);

  const dir = mkdtempSync(join(tmpdir(), "migrations-before-bootstrap-"));
  try {
    mkdirSync(join(dir, "migrations"));
    cpSync(join(PRISMA_DIR, "schema.prisma"), join(dir, "schema.prisma"));
    cpSync(join(PRISMA_DIR, "migrations", "migration_lock.toml"), join(dir, "migrations", "migration_lock.toml"));
    for (const name of migrations.filter((migration) => migration < BOOTSTRAP_MIGRATION)) {
      cpSync(join(PRISMA_DIR, "migrations", name), join(dir, "migrations", name), { recursive: true });
    }
    runPrisma(["migrate", "deploy", "--schema", join(dir, "schema.prisma")], databaseUrl);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Misma fila que crea prisma/seed.ts (upsert por code HC-NORMAL), con las columnas que
// tenía HourConcept justo antes de BOOTSTRAP_MIGRATION.
async function insertSeedNormalConcept(databaseUrl: string) {
  await withClient(databaseUrl, (db) =>
    db.$executeRawUnsafe(
      `INSERT INTO "HourConcept" ("id", "code", "name", "kind", "status", "countsAsWorked", "createdAt", "updatedAt")
       VALUES ('ci-bootstrap-hc-normal', 'HC-NORMAL', 'Hora normal', 'NORMAL', 'ACTIVO', TRUE, now(), now())`,
    ),
  );
}

function assertSchemaMatches(databaseUrl: string) {
  try {
    runPrisma(["migrate", "diff", "--from-url", databaseUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"], databaseUrl);
  } catch (error) {
    // --exit-code: 2 = hay diferencias. Se muestra el SQL que faltaría para diagnosticarlo.
    if ((error as { status?: number }).status === 2) {
      runPrisma(["migrate", "diff", "--from-url", databaseUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--script"], databaseUrl);
      throw new Error("Las migraciones no producen schema.prisma: falta una migración o hay un cambio sin versionar.");
    }
    throw error;
  }
}

async function cloneDatabase(url: URL, names: string[]) {
  const source = url.pathname.slice(1);
  await withClient(urlForDatabase(url, "postgres"), async (db) => {
    for (const name of names) {
      if (!DATABASE_NAME.test(name)) throw new Error(`Nombre de base inválido para --clone: "${name}".`);
      await db.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${source}"`);
      console.log(`Base ${name} creada desde ${source}.`);
    }
  });
}

async function main() {
  const url = parseLocalUrl(process.env.DATABASE_URL);
  const databaseUrl = url.toString();
  const clones = (process.argv.find((arg) => arg.startsWith("--clone="))?.slice("--clone=".length) ?? "").split(",").filter(Boolean);

  await assertEmpty(databaseUrl);
  applyHistoryBeforeBootstrap(databaseUrl);
  await insertSeedNormalConcept(databaseUrl);
  runPrisma(["migrate", "deploy"], databaseUrl);
  runPrisma(["migrate", "status"], databaseUrl);
  assertSchemaMatches(databaseUrl);
  console.log("Historial de migraciones completo aplicado sobre una base limpia: coincide con schema.prisma.");

  if (clones.length) await cloneDatabase(url, clones);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
