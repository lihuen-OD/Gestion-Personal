/**
 * R8 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §26): ensayo local de la
 * migración `20261126120000_add_user_shift_group_scopes` con el inventario de
 * conservación. Historia con usuarios, supervisión, grupos y rotaciones →
 * rollback versionado → inventario "antes" → `prisma migrate deploy` →
 * inventario "después" → comparación. También prueba que el rollback se niega
 * a correr con alcances cargados.
 *
 * Opt-in: sólo corre con `R8_MIGRATION_IT_DATABASE_URL` → `localhost`, base
 * `clock_it*` PROPIA con el historial completo aplicado. VACÍA la base.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareInventories, R8_PENDING_MIGRATIONS_CONFIG } from "./migrationInventory";
import { takeInventory } from "./migrationInventory.reader";

const url = process.env.R8_MIGRATION_IT_DATABASE_URL;
const backendDir = path.resolve(__dirname, "../../..");
const MIGRATION = "20261126120000_add_user_shift_group_scopes";
const ROLLBACK = `prisma/rollbacks/${MIGRATION}.down.sql`;

const prismaCli = (args: string[]) =>
  execFileSync("npx", ["prisma", ...args], { cwd: backendDir, env: { ...process.env, DATABASE_URL: url! }, stdio: "pipe" }).toString();
const migrateStatus = () => {
  try {
    return prismaCli(["migrate", "status"]);
  } catch (error) {
    return String((error as { stdout?: Buffer }).stdout ?? "");
  }
};
const rollback = () => prismaCli(["db", "execute", "--schema", "prisma/schema.prisma", "--file", ROLLBACK]);

describe.skipIf(!url)("R8 — inventario de conservación y rollback de UserShiftGroupScope", { timeout: 180_000 }, () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("R8_MIGRATION_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    prisma = new PrismaClient({ datasourceUrl: url });
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`Conectado a ${connected?.db}: se aborta.`);
    expect(migrateStatus()).toContain("Database schema is up to date");
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);

    // Historia que la migración no debe tocar.
    const n2 = await prisma.user.create({ data: { name: "N2 IT", email: "n2@inv.local", passwordHash: "x", role: "NIVEL_2_SUPERVISION" } });
    const n3 = await prisma.user.create({ data: { name: "N3 IT", email: "n3@inv.local", passwordHash: "x", role: "NIVEL_3_CARGA_HORARIA" } });
    await prisma.userSupervisionAssignment.create({ data: { supervisorUserId: n2.id, supervisedUserId: n3.id } });
    const group = await prisma.shiftGroup.create({ data: { code: "INV", name: "Inventario" } });
    const template = await prisma.shiftTemplate.create({ data: { code: "INV-07", name: "INV", startTime: "07:00", endTime: "15:00", shiftGroupId: group.id } });
    const rotation = await prisma.shiftRotation.create({ data: { code: "INV-ROT", name: "Rotación inventario", shiftGroupId: group.id, status: "INACTIVO" } });
    const crew = await prisma.shiftRotationCrew.create({ data: { rotationId: rotation.id, code: "A", name: "A" } });
    const version = await prisma.shiftRotationVersion.create({ data: { rotationId: rotation.id, cycleLengthWeeks: 1, anchorWeekStart: new Date("2027-01-04T00:00:00.000Z"), effectiveFrom: new Date("2027-01-04T00:00:00.000Z") } });
    const day = await prisma.shiftRotationDay.create({ data: { versionId: version.id, crewId: crew.id, cycleWeekIndex: 0, weekday: 1, kind: "SHIFT" } });
    await prisma.shiftRotationBlock.create({ data: { dayId: day.id, blockIndex: 0, shiftTemplateId: template.id } });

    // Estado previo a R8: la tabla vacía se revierte con su rollback versionado.
    rollback();
    expect(migrateStatus()).toContain(MIGRATION);
  });

  afterAll(async () => {
    try { prismaCli(["migrate", "deploy"]); } catch { /* el caso ya reportó el error */ }
    await prisma?.$disconnect();
  });

  it("migrate deploy crea la tabla vacía y conserva toda la historia; un cambio posterior se detecta", async () => {
    const before = await takeInventory(prisma, R8_PENDING_MIGRATIONS_CONFIG);
    expect(before.structuralTables).toEqual({ UserShiftGroupScope: "ABSENT" });
    prismaCli(["migrate", "deploy"]);
    const after = await takeInventory(prisma, R8_PENDING_MIGRATIONS_CONFIG);
    const result = compareInventories(before, after, R8_PENDING_MIGRATIONS_CONFIG);
    expect(result).toMatchObject({ ok: true, migrationsAdded: [MIGRATION], changedTables: [], previousMigrationsAltered: [], failedMigrationsAfter: [], createdTablesMissing: [] });
    expect(after.structuralTables).toEqual({ UserShiftGroupScope: 0 });
    expect(after.tables.UserSupervisionAssignment).toMatchObject({ rows: 1 });
    expect(after.tables.ShiftRotationBlock).toMatchObject({ rows: 1 });

    await prisma.userSupervisionAssignment.deleteMany({});
    const tampered = compareInventories(before, await takeInventory(prisma, R8_PENDING_MIGRATIONS_CONFIG), R8_PENDING_MIGRATIONS_CONFIG);
    expect(tampered.ok).toBe(false);
    expect(tampered.changedTables.map((item) => item.table)).toEqual(["UserSupervisionAssignment"]);
  });

  it("el rollback se niega a correr con alcances asignados y no cambia nada", async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: "n2@inv.local" } });
    const group = await prisma.shiftGroup.findFirstOrThrow({ where: { code: "INV" } });
    await prisma.userShiftGroupScope.create({ data: { userId: user.id, shiftGroupId: group.id } });
    expect(rollback).toThrow(/Rollback abortado/);
    expect(await prisma.userShiftGroupScope.count()).toBe(1);
    expect(migrateStatus()).toContain("Database schema is up to date");
  });
});
