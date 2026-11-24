import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shiftAlertTypeSchema } from "./shiftAlert.schemas";

/**
 * Guardas estáticas de la migración de R4.5 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md
 * §25.7). El comportamiento real (historial completo en base limpia sin
 * diferencias, rollback que aborta con filas que usan los valores nuevos y que
 * sin ellas vuelve exactamente al schema anterior, re-aplicación) se validó
 * contra PostgreSQL 18 local (ADR §25.7).
 */
const MIGRATION = "20261124120000_shift_alert_unscheduled_work_types";
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
const enumValues = (schema.match(/^enum ShiftAlertType \{([\s\S]*?)^\}/m)?.[1] ?? "")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("//"));

describe(`migración ${MIGRATION}`, () => {
  it("sólo agrega los dos valores nuevos al enum, sin tocar filas ni otras estructuras", () => {
    expect(sql.split("\n")).toEqual([
      `ALTER TYPE "ShiftAlertType" ADD VALUE 'TRABAJO_NO_PROGRAMADO';`,
      `ALTER TYPE "ShiftAlertType" ADD VALUE 'INGRESO_FUERA_DE_VENTANA';`,
    ]);
  });

  it("schema.prisma y el schema Zod de la API declaran los mismos valores, los nuevos al final", () => {
    expect(enumValues.slice(-2)).toEqual(["TRABAJO_NO_PROGRAMADO", "INGRESO_FUERA_DE_VENTANA"]);
    expect([...shiftAlertTypeSchema.options].sort()).toEqual([...enumValues].sort());
  });

  it("rollback: una transacción, tabla bloqueada y aborta si alguna alerta usa los valores nuevos (nunca las borra)", () => {
    expect(rollback.startsWith("BEGIN;")).toBe(true);
    expect(rollback.trim().endsWith("COMMIT;")).toBe(true);
    const lock = rollback.indexOf(`LOCK TABLE "ShiftAlert" IN ACCESS EXCLUSIVE MODE;`);
    const guard = rollback.indexOf("RAISE EXCEPTION");
    const rename = rollback.indexOf(`ALTER TYPE "ShiftAlertType" RENAME`);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(guard);
    expect(guard).toBeLessThan(rename);
    expect(rollback).not.toMatch(/DELETE FROM "ShiftAlert"/);
    expect(rollback).toContain(`DELETE FROM "_prisma_migrations" WHERE "migration_name" = '${MIGRATION}';`);
  });

  it("rollback: recrea el tipo con exactamente los valores previos, en el orden del historial", () => {
    const created = rollback.match(/CREATE TYPE "ShiftAlertType" AS ENUM \(([\s\S]*?)\);/)?.[1] ?? "";
    const previous = created.split(",").map((value) => value.trim().replace(/'/g, "")).filter(Boolean);
    expect(previous).toEqual(enumValues.slice(0, -2));
    expect(rollback).toContain(`ALTER TABLE "ShiftAlert" ALTER COLUMN "type" TYPE "ShiftAlertType" USING ("type"::text::"ShiftAlertType");`);
  });
});
