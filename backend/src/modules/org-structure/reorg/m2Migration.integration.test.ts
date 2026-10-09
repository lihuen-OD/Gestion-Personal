/**
 * Concurrencia de la migración M2 (20261009150000_org_location_contract_m2) contra PostgreSQL REAL.
 *
 * Riesgo: la guarda lee Employee/User/ClockDevice.sectorId ANTES de que los ALTER TABLE tomen su
 * bloqueo. Una escritura concurrente confirmada entre la guarda y el DROP se perdería en silencio.
 * La migración bloquea las tablas (ACCESS EXCLUSIVE) antes de la guarda: la guarda espera y la ve.
 *
 * Opt-in: sólo corre con `REORG_IT_M2_DATABASE_URL` → `localhost`, base `reorg_it_m2*`, migrada
 * HASTA ANTES de M2 (`prisma migrate deploy` sin la carpeta de M2). Vacía la base al empezar. La
 * migración se ejecuta en una transacción que SIEMPRE se revierte: el esquema queda pre-M2.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env.REORG_IT_M2_DATABASE_URL;
const MIGRATION = join(__dirname, "..", "..", "..", "..", "prisma", "migrations", "20261009150000_org_location_contract_m2", "migration.sql");
class Rollback extends Error {}

/** Sentencias de nivel superior (respeta bloques $$ … $$; descarta comentarios). */
function statements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let inDollar = false;
  for (const line of sql.split("\n")) {
    if (!inDollar && line.trimStart().startsWith("--")) continue;
    current += `${line}\n`;
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trimEnd().endsWith(";")) { out.push(current.trim()); current = ""; }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe.skipIf(!url)("M2 — concurrencia entre la guarda y el DROP (PostgreSQL local)", () => {
  let a: PrismaClient;
  let b: PrismaClient;
  const all = statements(readFileSync(MIGRATION, "utf8"));
  const withoutLock = all.filter((statement) => !statement.startsWith("LOCK TABLE"));

  /** Aplica las sentencias en una transacción y la revierte siempre; resuelve con el error que la cortó. */
  const runM2 = (stmts: string[]) => a.$transaction(async (tx) => {
    for (const statement of stmts) await tx.$executeRawUnsafe(statement);
    throw new Rollback("M2 completa (revertida)");
  }, { timeout: 30_000, maxWait: 10_000 }).then(() => null, (error: unknown) => error as Error);

  /** Otra sesión escribe Employee.sectorId y confirma recién después de `holdMs`. */
  const concurrentWrite = (holdMs: number) => b.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`UPDATE "Employee" SET "sectorId" = 's1' WHERE id = 'e1'`);
    await sleep(holdMs);
  }, { timeout: 30_000 });

  const sectorIdColumn = async () => (await b.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'Employee' AND column_name = 'sectorId'`))[0]!.n;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("reorg_it_m2")) throw new Error("REORG_IT_M2_DATABASE_URL debe ser localhost/reorg_it_m2*.");
    a = new PrismaClient({ datasourceUrl: url });
    b = new PrismaClient({ datasourceUrl: url });
    if (!(await sectorIdColumn())) throw new Error("La base ya tiene M2: migrarla sólo hasta antes de M2.");
    const tables = await b.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await b.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    await b.$transaction([
      b.$executeRawUnsafe(`INSERT INTO "Company"(id,name,code,"updatedAt") VALUES ('c1','C','C',now())`),
      b.$executeRawUnsafe(`INSERT INTO "BusinessUnit"(id,name,code,"companyId","updatedAt") VALUES ('b1','B','B','c1',now())`),
      b.$executeRawUnsafe(`INSERT INTO "Sector"(id,name,code,"businessUnitId","isLegacy","updatedAt") VALUES ('s1','S','S','b1',false,now())`),
      b.$executeRawUnsafe(`INSERT INTO "Employee"(id,legajo,cuil,dni,"firstName","lastName","updatedAt") VALUES ('e1','1','20-1','1','A','B',now())`),
    ]);
  }, 60_000);

  beforeEach(async () => { await b.$executeRawUnsafe(`UPDATE "Employee" SET "sectorId" = NULL WHERE id = 'e1'`); });

  afterAll(async () => { await a?.$disconnect(); await b?.$disconnect(); });

  it("el archivo bloquea las seis tablas antes de la guarda", () => {
    expect(all[0]).toMatch(/^LOCK TABLE "Employee", "User", "ClockDevice", "Sector", "Area", "Establishment" IN ACCESS EXCLUSIVE MODE;$/);
    expect(all[1]).toMatch(/^DO \$\$/);
  });

  it("sin concurrencia y con datos limpios, la migración completa pasa (revertida)", async () => {
    expect((await runM2(all))?.message).toBe("M2 completa (revertida)");
    expect(await sectorIdColumn()).toBe(1);
  }, 60_000);

  it("una escritura de Employee.sectorId confirmada mientras M2 espera: la guarda la ve y M2 aborta sin perderla", async () => {
    const writer = concurrentWrite(1500);
    await sleep(300); // la sesión B ya tiene la fila bloqueada
    const error = await runM2(all);
    await writer;
    expect(error?.message).toContain("M2 no se aplica: Employee.sectorId con valor: 1");
    expect(await sectorIdColumn()).toBe(1);
    expect((await b.$queryRawUnsafe<Array<{ sectorId: string | null }>>(`SELECT "sectorId" FROM "Employee" WHERE id = 'e1'`))[0]!.sectorId).toBe("s1");
  }, 60_000);

  it("control: la misma carrera SIN el bloqueo previo pasa la guarda y llega al DROP (el valor se habría perdido)", async () => {
    const writer = concurrentWrite(1500);
    await sleep(300);
    const error = await runM2(withoutLock);
    await writer;
    expect(error?.message).toBe("M2 completa (revertida)");
  }, 60_000);
});
