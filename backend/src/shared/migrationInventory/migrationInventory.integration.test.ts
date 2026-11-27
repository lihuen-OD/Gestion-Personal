/**
 * Inventario de conservación contra PostgreSQL REAL (§25.20) y ensayo local del
 * mecanismo de migración de R4.9: datos con historia → reversión de las 4
 * migraciones pendientes con sus rollbacks versionados → inventario "antes" →
 * `prisma migrate deploy` (el mismo comando que se usa en Neon) → inventario
 * "después" → comparación. También prueba que el inventario detecta un cambio y
 * que no contiene valores de filas.
 *
 * Opt-in: sólo corre con `MIGRATION_INVENTORY_IT_DATABASE_URL` → `localhost`,
 * base `clock_it*` PROPIA con el historial completo aplicado. VACÍA la base.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareInventories, R49_PENDING_MIGRATIONS_CONFIG } from "./migrationInventory";
import { takeInventory } from "./migrationInventory.reader";

const url = process.env.MIGRATION_INVENTORY_IT_DATABASE_URL;
const backendDir = path.resolve(__dirname, "../../..");
const PENDING = [
  "20261120180000_replace_rotation_slots_with_days",
  "20261121090000_attendance_incident_block_key",
  "20261124120000_shift_alert_unscheduled_work_types",
  "20261125120000_work_shift_template_rules_snapshot",
];
const PERSONAL_MARKERS = ["Inventario-Apellido-Unico", "20-99887766-1"];

const prismaCli = (args: string[]) =>
  execFileSync("npx", ["prisma", ...args], { cwd: backendDir, env: { ...process.env, DATABASE_URL: url! }, stdio: "pipe" }).toString();
/** `migrate status` sale con 1 cuando hay migraciones pendientes: se lee su salida igual. */
const migrateStatus = () => {
  try {
    return prismaCli(["migrate", "status"]);
  } catch (error) {
    return String((error as { stdout?: Buffer }).stdout ?? "");
  }
};

describe.skipIf(!url)("Inventario de conservación + ensayo local de las migraciones de R4.9", { timeout: 180_000 }, () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("MIGRATION_INVENTORY_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    prisma = new PrismaClient({ datasourceUrl: url });
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`Conectado a ${connected?.db}: se aborta.`);
    expect(migrateStatus()).toContain("Database schema is up to date");
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);

    // Historia mínima con las relaciones que tocan las migraciones (columnas nuevas en NULL).
    const employee = await prisma.employee.create({ data: { legajo: "INV-1", cuil: PERSONAL_MARKERS[1], dni: "99887766", firstName: "Prueba", lastName: PERSONAL_MARKERS[0]! } });
    const template = await prisma.shiftTemplate.create({ data: { code: "INV-07-15", name: "INV", startTime: "07:00", endTime: "15:00" } });
    await prisma.shiftAssignment.create({ data: { employeeId: employee.id, shiftTemplateId: template.id, effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), weekdays: [1, 2, 3, 4, 5] } });
    const start = new Date("2026-10-05T10:00:00.000Z");
    const end = new Date("2026-10-05T18:00:00.000Z");
    const inPunch = await prisma.attendancePunch.create({ data: { employeeId: employee.id, type: "INGRESO", timestamp: start } });
    const outPunch = await prisma.attendancePunch.create({ data: { employeeId: employee.id, type: "SALIDA", timestamp: end } });
    const shift = await prisma.workShift.create({ data: { employeeId: employee.id, shiftTemplateId: template.id, source: "PUBLIC_CLOCK_PHOTO", status: "PROCESADO", startAt: start, endAt: end, startPunchId: inPunch.id, endPunchId: outPunch.id, totalMinutes: 480 } });
    await prisma.shiftAlert.create({ data: { employeeId: employee.id, workShiftId: shift.id, type: "INGRESO_TARDE", severity: "ADVERTENCIA", actualAt: start, differenceMinutes: 12 } });
    for (const [day, status] of [["2026-10-06", "PENDIENTE"], ["2026-10-07", "RESUELTA"]] as const) {
      await prisma.attendanceInactivityIncident.create({ data: { employeeId: employee.id, operationalDate: new Date(`${day}T00:00:00.000Z`), observation: "histórico", status } });
    }

    // Estado previo a R4.9 (78 migraciones): rollbacks versionados en orden inverso.
    for (const name of [...PENDING].reverse()) prismaCli(["db", "execute", "--schema", "prisma/schema.prisma", "--file", `prisma/rollbacks/${name}.down.sql`]);
    expect(migrateStatus()).toContain("Following migrations have not yet been applied");
  });

  afterAll(async () => {
    // Deja la base como la encontró (historial completo), aunque un caso falle.
    try { prismaCli(["migrate", "deploy"]); } catch { /* el caso ya reportó el error */ }
    await prisma?.$disconnect();
  });

  it("inventario determinístico, de sólo lectura y sin valores de filas", async () => {
    const first = await takeInventory(prisma, R49_PENDING_MIGRATIONS_CONFIG);
    const second = await takeInventory(prisma, R49_PENDING_MIGRATIONS_CONFIG);
    expect(first.meta.readOnly).toBe(true);
    expect({ ...second, meta: undefined }).toEqual({ ...first, meta: undefined });
    const text = JSON.stringify(first);
    for (const marker of PERSONAL_MARKERS) expect(text).not.toContain(marker);
    expect(first.structuralTables).toEqual({ ShiftRotationSlot: 0, ShiftRotationDay: "ABSENT", ShiftRotationBlock: "ABSENT" });
    expect(first.newColumnValues).toEqual({ "AttendanceInactivityIncident.scheduledStartAt": "ABSENT", "WorkShift.templateRulesSnapshot": "ABSENT" });
  });

  it("migrate deploy de las 4 pendientes conserva toda la historia; un cambio posterior se detecta", async () => {
    const before = await takeInventory(prisma, R49_PENDING_MIGRATIONS_CONFIG);
    prismaCli(["migrate", "deploy"]);
    const after = await takeInventory(prisma, R49_PENDING_MIGRATIONS_CONFIG);
    const result = compareInventories(before, after, R49_PENDING_MIGRATIONS_CONFIG);
    expect(result).toMatchObject({ ok: true, migrationsAdded: PENDING, changedTables: [], previousMigrationsAltered: [], failedMigrationsAfter: [] });
    expect(after.structuralTables).toEqual({ ShiftRotationSlot: "ABSENT", ShiftRotationDay: 0, ShiftRotationBlock: 0 });
    expect(after.newColumnValues).toEqual({ "AttendanceInactivityIncident.scheduledStartAt": 0, "WorkShift.templateRulesSnapshot": 0 });
    expect(after.tables.WorkShift).toMatchObject({ rows: 1 });
    expect(after.tables.AttendanceInactivityIncident).toMatchObject({ rows: 2 });

    await prisma.workShift.updateMany({ data: { totalMinutes: 479 } });
    const tampered = compareInventories(before, await takeInventory(prisma, R49_PENDING_MIGRATIONS_CONFIG), R49_PENDING_MIGRATIONS_CONFIG);
    expect(tampered.ok).toBe(false);
    expect(tampered.changedTables.map((item) => item.table)).toEqual(["WorkShift"]);
  });
});
