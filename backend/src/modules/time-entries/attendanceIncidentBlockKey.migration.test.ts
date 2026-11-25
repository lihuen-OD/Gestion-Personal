import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas estáticas de R4.3a (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.4):
 * incidentes de inactividad identificables por bloque, sobre una tabla con
 * datos históricos. El comportamiento real (unicidad por día y por bloque,
 * preservación del historial con hashes, idempotencia de createMany con
 * Prisma, rollback) se validó contra PostgreSQL 18 local (ADR §25.4).
 */
const MIGRATION = "20261121090000_attendance_incident_block_key";
const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const withoutComments = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("--"))
    .join("\n");

const sql = withoutComments(read(`prisma/migrations/${MIGRATION}/migration.sql`));
const rollback = withoutComments(read(`prisma/rollbacks/${MIGRATION}.down.sql`));
const schema = read("prisma/schema.prisma");
const model = schema.match(/^model AttendanceInactivityIncident \{[\s\S]*?^\}/m)?.[0] ?? "";

const NEW_INDEX = `CREATE UNIQUE INDEX "AttendanceInactivityIncident_block_key" ON "AttendanceInactivityIncident"("employeeId", "operationalDate", COALESCE("scheduledStartAt", '-infinity'::timestamptz));`;
const OLD_INDEX = "AttendanceInactivityIncident_employeeId_operationalDate_key";

describe(`migración ${MIGRATION}`, () => {
  it("bloquea la tabla y verifica precondiciones antes de cualquier cambio", () => {
    const lock = sql.indexOf(`LOCK TABLE "AttendanceInactivityIncident" IN ACCESS EXCLUSIVE MODE;`);
    const precondition = sql.indexOf("ya tiene la columna scheduledStartAt");
    const firstChange = sql.indexOf("ALTER TABLE");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(precondition);
    expect(precondition).toBeLessThan(firstChange);
    expect(sql).toMatch(/GROUP BY "employeeId", "operationalDate" HAVING count\(\*\) > 1/);
  });

  it("agrega scheduledStartAt nullable, sin default ni backfill", () => {
    const addColumn = sql.match(/ALTER TABLE "AttendanceInactivityIncident" ADD COLUMN[^;]*;/g);
    expect(addColumn).toHaveLength(1);
    expect(addColumn![0]).toMatch(/ADD COLUMN\s+"scheduledStartAt" TIMESTAMPTZ\(3\);$/);
    expect(addColumn![0]).not.toMatch(/NOT NULL|DEFAULT/);
  });

  it("nueva unicidad por día o por bloque (índice de expresión) creada ANTES de quitar la anterior", () => {
    expect(sql).toContain(NEW_INDEX);
    expect(sql).toContain(`DROP INDEX "${OLD_INDEX}";`);
    expect(sql.indexOf(NEW_INDEX)).toBeLessThan(sql.indexOf(`DROP INDEX "${OLD_INDEX}"`));
  });

  it("ninguna fila se modifica: sin UPDATE, INSERT, DELETE ni TRUNCATE; sólo se quita el índice anterior", () => {
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE|TRUNCATE)\b/im);
    expect(sql.match(/\bDROP\b[^;]*/g)).toEqual([`DROP INDEX "${OLD_INDEX}"`]);
  });

  it("postcondición: sin filas con bloque, unicidad por (empleado, fecha) intacta e índices esperados", () => {
    expect(sql).toMatch(/IF with_block > 0 OR total <> pairs THEN/);
    expect(sql).toContain(`to_regclass('public."AttendanceInactivityIncident_block_key"') IS NULL`);
    expect(sql).toContain(`to_regclass('public."${OLD_INDEX}"') IS NOT NULL`);
    expect(sql.lastIndexOf("RAISE EXCEPTION")).toBeGreaterThan(sql.indexOf(`DROP INDEX "${OLD_INDEX}"`));
  });
});

describe("schema.prisma", () => {
  it("columna nullable y sin @@unique por día (la unicidad vive en el índice de expresión, documentado en el modelo)", () => {
    expect(model).toMatch(/scheduledStartAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
    expect(model).not.toMatch(/@@unique\(\[employeeId, operationalDate\]\)/);
    expect(model).not.toMatch(/@@unique/);
    expect(schema).toContain(`UNIQUE ("employeeId", "operationalDate", COALESCE("scheduledStartAt", '-infinity'))`);
    expect(model).toMatch(/@@index\(\[status, operationalDate\]\)/);
    expect(model).toMatch(/@@index\(\[employeeId, status\]\)/);
  });
});

describe(`rollback ${MIGRATION}`, () => {
  it("una transacción con la tabla bloqueada que aborta si hay incidentes por bloque, antes de cualquier cambio", () => {
    expect(rollback).toMatch(/^BEGIN;/m);
    expect(rollback).toMatch(/COMMIT;\s*$/);
    expect(rollback).toContain(`LOCK TABLE "AttendanceInactivityIncident" IN ACCESS EXCLUSIVE MODE;`);
    expect(rollback).toContain(`WHERE "scheduledStartAt" IS NOT NULL;`);
    expect(rollback.indexOf("RAISE EXCEPTION")).toBeLessThan(rollback.indexOf("CREATE UNIQUE INDEX"));
  });

  it("restaura la unicidad anterior ANTES de quitar la nueva y luego la columna", () => {
    const restore = rollback.indexOf(`CREATE UNIQUE INDEX "${OLD_INDEX}" ON "AttendanceInactivityIncident"("employeeId", "operationalDate");`);
    const dropNew = rollback.indexOf(`DROP INDEX "AttendanceInactivityIncident_block_key";`);
    const dropColumn = rollback.indexOf(`ALTER TABLE "AttendanceInactivityIncident" DROP COLUMN "scheduledStartAt";`);
    expect(restore).toBeGreaterThan(0);
    expect(restore).toBeLessThan(dropNew);
    expect(dropNew).toBeLessThan(dropColumn);
  });

  it("no toca filas de incidentes: el único DELETE es su propia fila de _prisma_migrations (P3012); sin UPDATE, TRUNCATE ni CASCADE", () => {
    expect(rollback.match(/^\s*DELETE\b.*$/gim)).toEqual([`DELETE FROM "_prisma_migrations" WHERE migration_name = '${MIGRATION}';`]);
    expect(rollback).not.toMatch(/^\s*(UPDATE|TRUNCATE)\b/im);
    expect(rollback).not.toMatch(/CASCADE/i);
  });
});
