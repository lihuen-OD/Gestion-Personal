/**
 * Respaldo lógico completo (SÓLO LECTURA) de una base declarada, en el mismo
 * formato del respaldo D5 (`kind: "logical-json-full"`): metadatos de columna
 * y TODAS las filas por tabla, más el estado de `_prisma_migrations`.
 *
 *   npx tsx scripts/a8-3-logical-backup.ts --env-file=<archivo> --expected-host=<host> --out=<archivo.json>
 *
 * Escribe además `<archivo>.sha256` (SHA-256 de los bytes del archivo, formato
 * `hash  nombre`). El destino sale SIEMPRE de `--env-file` (nunca del `.env`
 * habitual) y su host debe coincidir con `--expected-host` antes de leer nada.
 * La salida no contiene credenciales; contiene IDs y legajos, así que el
 * archivo se guarda fuera del repositorio.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { arg, connectTarget, quoteIdent, readOnly } from "./org-reorg/lib";

interface ColumnMeta {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
}

async function main() {
  const out = arg("out");
  if (!out) throw new Error("Falta --out=<archivo.json> (fuera del repositorio).");
  const target = await connectTarget();
  try {
    const dump = await readOnly(target.prisma, async (tx) => {
      const tables = await tx.$queryRawUnsafe<Array<{ table_name: string }>>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
      );
      const migrations = await tx.$queryRawUnsafe<Array<{ migration_name: string; finished_at: unknown; rolled_back_at: unknown }>>(
        'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at',
      );
      const result: Record<string, { columns: ColumnMeta[]; rows: Array<Record<string, unknown>> }> = {};
      for (const { table_name: table } of tables) {
        const columns = await tx.$queryRawUnsafe<ColumnMeta[]>(
          "SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
          table,
        );
        const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM ${quoteIdent(table)}`);
        result[table] = { columns, rows };
      }
      return { migrations, tables: result };
    });
    const json = JSON.stringify({ takenAt: new Date().toISOString(), host: target.host, kind: "logical-json-full", ...dump }, null, 2);
    writeFileSync(out, json);
    const sha256 = createHash("sha256").update(json, "utf8").digest("hex");
    writeFileSync(`${out}.sha256`, `${sha256}  ${basename(out)}\n`);
    const rows = Object.values(dump.tables).reduce((sum, table) => sum + table.rows.length, 0);
    console.log(JSON.stringify({ host: target.host, identidadNeon: target.identity.status, migraciones: dump.migrations.length, tablas: Object.keys(dump.tables).length, filas: rows, sha256, out }, null, 2));
  } finally {
    await target.prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
