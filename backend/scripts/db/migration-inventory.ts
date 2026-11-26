/**
 * Inventario de conservación de datos para migraciones (SHIFT_ROTATION_AUDIT_PLAN.md
 * §25.20; DATABASE_STANDARDS.md "Migrations"). SÓLO LECTURA sobre la base.
 *
 *   npx tsx scripts/db/migration-inventory.ts snapshot  --env-file=<archivo> --expected-host=<host> --out=<archivo.json>
 *   npx tsx scripts/db/migration-inventory.ts compare   --before=<antes.json> --after=<despues.json>
 *   npx tsx scripts/db/migration-inventory.ts checksums --env-file=<archivo> --expected-host=<host>
 *
 * - El destino nunca sale del `.env` implícito: `--env-file` explícito y su
 *   host debe coincidir con `--expected-host` (como los scripts org-reorg).
 * - `snapshot` corre en una transacción READ ONLY y guarda SÓLO agregados
 *   (conteos y md5): sin valores de filas ni datos personales. No pisa un
 *   archivo existente y lo deja con permisos 600.
 * - `compare` sale con código 1 si algo preexistente cambió o la estructura
 *   nueva no es la esperada.
 * - `checksums` compara `_prisma_migrations.checksum` con el sha256 de cada
 *   `prisma/migrations/<nombre>/migration.sql` (hallazgo B1, §25.20).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertExpectedHost } from "../../src/modules/org-structure/reorg/targetIdentity";
import { compareInventories, INVENTORY_CONFIGS, migrationChecksumDrift, type InventoryConfig, type InventorySnapshot } from "../../src/shared/migrationInventory/migrationInventory";
import { takeInventory } from "../../src/shared/migrationInventory/migrationInventory.reader";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const required = (name: string) => {
  const value = arg(name);
  if (!value) throw new Error(`Falta --${name}=…`);
  return value;
};

function connect() {
  const envFile = required("env-file");
  const databaseUrl = parse(readFileSync(envFile)).DATABASE_URL;
  if (!databaseUrl) throw new Error(`${envFile} no define DATABASE_URL.`);
  const host = assertExpectedHost(databaseUrl, required("expected-host"));
  return { prisma: new PrismaClient({ datasourceUrl: databaseUrl }), host };
}

function repoChecksums(): Record<string, string> {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const result: Record<string, string> = {};
  for (const name of readdirSync(dir).filter((entry) => /^\d{14}_/.test(entry)).sort()) {
    result[name] = createHash("sha256").update(readFileSync(path.join(dir, name, "migration.sql"))).digest("hex");
  }
  return result;
}

/** `--config=r49|r8` (default `r49`): qué migraciones pendientes describe el inventario. */
function inventoryConfig(): InventoryConfig {
  const key = arg("config") ?? "r49";
  const config = INVENTORY_CONFIGS[key];
  if (!config) throw new Error(`--config=${key} desconocida (opciones: ${Object.keys(INVENTORY_CONFIGS).join(", ")}).`);
  return config;
}

async function main() {
  const mode = process.argv[2];
  if (mode === "snapshot") {
    const out = required("out");
    if (existsSync(out)) throw new Error(`${out} ya existe: el inventario nunca pisa evidencia anterior.`);
    const { prisma, host } = connect();
    try {
      const snapshot = await takeInventory(prisma, inventoryConfig());
      writeFileSync(out, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
      const applied = snapshot.migrations.filter((row) => row.finished && !row.rolledBack).length;
      console.log(`Inventario (${host}, base ${snapshot.meta.database}, read_only=${snapshot.meta.readOnly}): ${applied} migraciones aplicadas, ${Object.keys(snapshot.tables).length} tablas → ${out}`);
    } finally {
      await prisma.$disconnect();
    }
    return;
  }
  if (mode === "compare") {
    const before = JSON.parse(readFileSync(required("before"), "utf8")) as InventorySnapshot;
    const after = JSON.parse(readFileSync(required("after"), "utf8")) as InventorySnapshot;
    const result = compareInventories(before, after, inventoryConfig());
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (mode === "checksums") {
    const { prisma, host } = connect();
    try {
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return tx.$queryRawUnsafe<Array<{ name: string; finished: boolean; rolledBack: boolean; checksum: string }>>(
          `SELECT migration_name AS "name", (finished_at IS NOT NULL) AS "finished", (rolled_back_at IS NOT NULL) AS "rolledBack", checksum FROM "_prisma_migrations"`,
        );
      });
      const drift = migrationChecksumDrift(rows, repoChecksums());
      console.log(JSON.stringify({ host, ...drift }, null, 2));
      if (drift.mismatched.length || drift.appliedWithoutFile.length) process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
    return;
  }
  throw new Error("Uso: snapshot|compare|checksums (ver encabezado del script).");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
