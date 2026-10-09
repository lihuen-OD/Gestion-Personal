/**
 * Integración REAL de captura, retiro y restauración (A8 §12.4, §12.9.7):
 * corre `runCleanup` y `runRestore` —las mismas funciones que invocan
 * `scripts/org-reorg-cleanup.ts` y `org-reorg-restore.ts` DESPUÉS de su
 * compuerta D-0— contra una base PostgreSQL LOCAL desechable, con el
 * inventario congelado por las lecturas reales (clases + ampliación).
 *
 * Opt-in: sólo corre con `REORG_IT_DATABASE_URL` apuntando a `localhost` y a
 * una base cuyo nombre empiece con `reorg_it`, ya migrada con
 * `prisma migrate deploy` (ver docs/decisions/A8_M2_PREPARATION.md §12.14).
 * BORRA todos los datos de esa base al empezar. En CI no hay base: se omite.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { amplifyInventory, captureRowManifest, loadInventory, type EngineEvaluator, type Tx } from "./catalogReads";
import type { CleanupBackup, CleanupDeps, CleanupInput } from "./cleanupTransaction";
import type { FrozenInventory } from "./cleanupPlan";
import { verifyV1, type RowManifest } from "./manifest";
import type { RestoreBackup } from "./restoreTransaction";
import { rulePopulationAt, type PopulationReader } from "./rulePopulation";

const url = process.env.REORG_IT_DATABASE_URL;

function assertLocalThrowaway(value: string) {
  const parsed = new URL(value);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)) throw new Error(`REORG_IT_DATABASE_URL debe ser local (es ${parsed.hostname}).`);
  if (!parsed.pathname.replace("/", "").startsWith("reorg_it")) throw new Error("La base de integración debe llamarse reorg_it*: se vacía al empezar.");
}

const FIXTURE = `
INSERT INTO "User"(id,name,email,"passwordHash",role,"updatedAt") VALUES ('u-rrhh','RRHH Integración','rrhh@it.local','x','NIVEL_1_RRHH',now());
INSERT INTO "Company"(id,name,code,"updatedAt") VALUES ('comp-1','LOSOD','LOSOD',now());
INSERT INTO "BusinessUnit"(id,name,code,"companyId","updatedAt") VALUES ('bu-old','UN vieja','UNV','comp-1',now()), ('bu-old-2','UN vieja 2','UNV2','comp-1',now()), ('bu-new','UN nueva','UNN','comp-1',now());
INSERT INTO "Zone"(id,name,code,"updatedAt") VALUES ('z1','Zona Norte','ZN',now());
INSERT INTO "Establishment"(id,name,code,"companyId","businessUnitId","isLegacy","updatedAt") VALUES ('est-old','Est viejo','E1','comp-1','bu-old',true,now());
INSERT INTO "Establishment"(id,name,code,"zoneId","isLegacy","updatedAt") VALUES ('est-new','Est nuevo','E1','z1',false,now());
INSERT INTO "Area"(id,name,code,"establishmentId","isLegacy","updatedAt") VALUES ('area-old','Area vieja','AV','est-old',true,now());
INSERT INTO "Sector"(id,name,code,"areaId","isLegacy","updatedAt") VALUES ('sec-old-1','Cocina','SV1','area-old',true,now()), ('sec-old-2','Limpieza','SV2','area-old',true,now());
INSERT INTO "Sector"(id,name,code,"businessUnitId","isLegacy","updatedAt") VALUES ('sec-new','Cocina nueva','SN','bu-new',false,now());
INSERT INTO "Area"(id,name,code,"sectorId","isLegacy","updatedAt") VALUES ('area-new','Area nueva','AN','sec-new',false,now());
INSERT INTO "Position"(id,code,name,"sectorId","updatedAt") VALUES ('pos-old-1','PV1','Cocinero','sec-old-1',now()), ('pos-old-2','PV2','Limpiador','sec-old-2',now());
INSERT INTO "Position"(id,code,name,"updatedAt") VALUES ('pos-new','PN','Cocinero nuevo',now());
INSERT INTO "PositionOrgScope"(id,"positionId",level,"sectorId") VALUES ('ps-1','pos-new','SECTOR','sec-new');
INSERT INTO "PositionOrgScope"(id,"positionId",level,"businessUnitId") VALUES ('ps-2','pos-new','BUSINESS_UNIT','bu-old'), ('ps-3','pos-new','BUSINESS_UNIT','bu-old-2');
INSERT INTO "PositionOrgScope"(id,"positionId",level,"companyId") VALUES ('ps-4','pos-new','COMPANY','comp-1');
INSERT INTO "Employee"(id,legajo,cuil,dni,"firstName","lastName","positionId","sectorId","updatedAt") VALUES ('e1','01','20-1-1','1','Ana','Uno','pos-old-1','sec-old-1',now());
INSERT INTO "Employee"(id,legajo,cuil,dni,"firstName","lastName","positionId","updatedAt") VALUES ('e2','02','20-2-2','2','Beto','Dos','pos-new',now());
INSERT INTO "EmployeeCompany"("employeeId","companyId") VALUES ('e1','comp-1');
INSERT INTO "EmployeePositionPeriod"(id,"employeeId","positionId","effectiveFrom",reason,"updatedAt") VALUES ('h-epp-1','e1','pos-old-1','2026-01-01','Alta','2026-01-01T00:00:00Z'), ('h-epp-2','e2','pos-new','2026-09-01','Alta','2026-09-01T00:00:00Z');
INSERT INTO "EmployeeLegacySectorPeriod"(id,"employeeId","sectorId","effectiveFrom",reason,"updatedAt") VALUES ('h-elsp-1','e1','sec-old-1','2026-01-01','Alta','2026-01-01T00:00:00Z');
INSERT INTO "EmployeeEmployerPeriod"(id,"employeeId","effectiveFrom",reason,"updatedAt") VALUES ('h-eep-1','e1','2026-01-01','Alta','2026-01-01T00:00:00Z');
INSERT INTO "EmployeeEmployerPeriodCompany"("periodId","companyId") VALUES ('h-eep-1','comp-1');
INSERT INTO "PositionOrgScopePeriod"(id,"positionId","effectiveFrom",reason,"updatedAt") VALUES ('h-posp-1','pos-new','2026-09-01','Alta','2026-09-01T00:00:00Z');
INSERT INTO "PositionOrgScopePeriodNode"(id,"periodId",level,"sectorId") VALUES ('h-node-1','h-posp-1','SECTOR','sec-new');
INSERT INTO "PositionOrgScopePeriodNode"(id,"periodId",level,"businessUnitId") VALUES ('h-node-2','h-posp-1','BUSINESS_UNIT','bu-old');
INSERT INTO "CostCenter"(id,name,code,"updatedAt") VALUES ('cc-1','Cocina','CC1',now());
INSERT INTO "CostCenterSector"("costCenterId","sectorId") VALUES ('cc-1','sec-old-2');
INSERT INTO "CostCenterArea"("costCenterId","areaId") VALUES ('cc-1','area-old');
INSERT INTO "CostCenterBusinessUnit"("costCenterId","businessUnitId") VALUES ('cc-1','bu-old-2');
INSERT INTO "SalaryCategory"(id,name,"order","updatedAt") VALUES ('sc-1','Cat A',1,now());
INSERT INTO "PositionSalaryCategory"("positionId","salaryCategoryId") VALUES ('pos-old-2','sc-1');
INSERT INTO "DoubleHourRule"(id,name,"recurrenceType","fromDate",reason,"positionId","updatedAt") VALUES ('rule-1','x2 Cocina','SEMANAL','2026-01-01','Prueba','pos-old-1',now());
`;

describe.skipIf(!url)("A8 — captura, retiro y restauración contra PostgreSQL local (integración)", () => {
  let prisma: PrismaClient;
  let deps: CleanupDeps;
  let runCleanup: typeof import("./cleanupTransaction").runCleanup;
  let runRestore: typeof import("./restoreTransaction").runRestore;
  let restoreAudit: Parameters<typeof import("./restoreTransaction").runRestore>[3];
  let frozen: FrozenInventory;
  let baseline: RowManifest;
  let backup: CleanupBackup | undefined;
  const decisions: CleanupInput["decisions"] = [{ ruleId: "rule-1", treatment: "R3", approvedBy: "integración local" }];
  // Dos resoluciones de la MISMA tabla/columna con destinos distintos y un destino repetido.
  const classFour: CleanupInput["classFour"] = [
    { table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", retain: [], retire: ["bu-old-2", "bu-old"] },
    { table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", retain: ["bu-old"], retire: ["bu-old"] },
  ];
  const input = (overrides: Partial<CleanupInput>): CleanupInput => ({ companyMode: "C1", frozen, decisions, classFour, acceptedEngineChanges: new Set(), actorUserId: "u-rrhh", apply: false, host: "localhost", ...overrides });
  const readOnly = <T>(operation: (tx: Tx) => Promise<T>) => prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return operation(tx as Tx); });
  const count = async (sql: string) => (await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${sql}`))[0]!.n;

  beforeAll(async () => {
    assertLocalThrowaway(url!);
    // Los módulos de la app (motor, auditoría) se importan con DATABASE_URL ya
    // fijada a la base local: nunca pueden caer en el .env habitual. Sólo usan
    // el cliente de la transacción que se les pasa.
    process.env.DATABASE_URL = url;
    prisma = new PrismaClient({ datasourceUrl: url });
    const [migrated] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE migration_name = '20261008150000_org_catalog_archive_classification' AND finished_at IS NOT NULL`);
    if (!migrated!.n) throw new Error("La base de integración no tiene las migraciones del repo (prisma migrate deploy).");
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    await prisma.$transaction(FIXTURE.trim().split(";\n").filter(Boolean).map((statement) => prisma.$executeRawUnsafe(statement)));
    const engine = await import("../../time-entries/timeEntries.repository");
    const { auditService } = await import("../../audit/audit.service");
    const { loadEmployeeReferences } = await import("../../../shared/audit/employeeReference");
    ({ runCleanup } = await import("./cleanupTransaction"));
    ({ runRestore } = await import("./restoreTransaction"));
    deps = { evaluate: engine.evaluateSpecialHourRulesByDate as unknown as EngineEvaluator, audit: auditService.registerWithin as never, loadEmployeeReferences: loadEmployeeReferences as never };
    restoreAudit = { audit: auditService.registerWithin as never };
    frozen = (await readOnly(async (tx) => amplifyInventory(tx, await loadInventory(tx, "C1")))).inventory;
    baseline = await readOnly((tx) => captureRowManifest(tx, "localhost"));
  }, 60_000);

  afterAll(async () => { await prisma?.$disconnect(); });

  it("bloqueos de Legajos: con la empresa/puesto bloqueados (FOR SHARE) por la revalidación, el UPDATE de archivo concurrente espera; sin bloqueo pasa", async () => {
    const { employeesRepository } = await import("../../employees/employees.repository");
    const other = new PrismaClient({ datasourceUrl: url });
    const tryArchive = (table: "Company" | "Position", id: string) => other.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '300ms'");
      await tx.$executeRawUnsafe(`UPDATE "${table}" SET "archivedAt" = now() WHERE id = $1`, id);
      throw new Error("ROLLBACK_CONTROL"); // nunca deja nada escrito
    });
    try {
      for (const [table, id, check] of [
        ["Company", "comp-1", (tx: unknown) => employeesRepository.findArchivedCompanyNamesWithin(tx as never, ["comp-1"])],
        ["Position", "pos-new", (tx: unknown) => employeesRepository.findPositionForAssignmentWithin(tx as never, "pos-new")],
      ] as const) {
        // Control: sin la revalidación abierta, el archivo concurrente llega a escribir (se revierte igual).
        await expect(tryArchive(table, id)).rejects.toThrow("ROLLBACK_CONTROL");
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const holder = prisma.$transaction(async (tx) => { await check(tx); await held; }, { timeout: 10_000 });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await expect(tryArchive(table, id)).rejects.toThrow(/lock timeout|55P03/);
        release();
        await holder;
      }
      expect(await count(`"Company" WHERE "archivedAt" IS NOT NULL`)).toBe(0);
      expect(await count(`"Position" WHERE "archivedAt" IS NOT NULL`)).toBe(0);
    } finally {
      await other.$disconnect();
    }
  }, 60_000);

  it("el manifiesto por fila no depende del TimeZone de la sesión y repone la zona previa", async () => {
    const at = (zone: string) => prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${zone}'`);
      const manifest = await captureRowManifest(tx as Tx, "localhost");
      const [row] = await tx.$queryRawUnsafe<Array<{ timezone: string }>>("SELECT current_setting('TimeZone') AS timezone");
      return { manifest, timezone: row!.timezone };
    });
    const [utc, cordoba] = [await at("UTC"), await at("America/Argentina/Cordoba")];
    expect(cordoba.timezone).toBe("America/Argentina/Cordoba");
    expect(verifyV1(utc.manifest, cordoba.manifest, { deleted: {}, nullified: {}, ruleChanges: {}, newRows: {}, newAuditRows: 0 })).toEqual([]);
  }, 60_000);

  it("hallazgo 3: población de R2 con el cargador REAL de historia del motor (WITHIN y LEGACY_SECTOR, faltantes informados)", async () => {
    const base = { id: "tmp", name: "tmp", kind: "ESPECIAL", companyId: null, costCenterId: null, positionId: null, employees: [] };
    const classification = async (id: string) => prisma.sector.findUniqueOrThrow({ where: { id }, select: { isLegacy: true } });
    const within = await readOnly(async (tx) => rulePopulationAt(tx as unknown as PopulationReader, { ...base, sectorId: "sec-new", sector: await classification("sec-new") }, "2026-10-09"));
    expect(within).toMatchObject({ sectorSemantics: "WITHIN", employeeIds: ["e2"], missing: [{ employeeId: "e1", dimensions: ["POSITION_SCOPE"] }] });
    const legacy = await readOnly(async (tx) => rulePopulationAt(tx as unknown as PopulationReader, { ...base, sectorId: "sec-old-1", sector: await classification("sec-old-1") }, "2026-10-09"));
    expect(legacy).toMatchObject({ sectorSemantics: "LEGACY_SECTOR", employeeIds: ["e1"], missing: [{ employeeId: "e2", dimensions: ["LEGACY_SECTOR"] }] });
    // Antes de la vigencia del alcance (2026-09-01) el puesto nuevo no tiene alcance registrado: falta evidencia, no "no cumple".
    const before = await readOnly(async (tx) => rulePopulationAt(tx as unknown as PopulationReader, { ...base, sectorId: "sec-new", sector: await classification("sec-new") }, "2026-08-15"));
    expect(before.employeeIds).toEqual([]);
    expect(before.missing).toEqual([{ employeeId: "e1", dimensions: ["POSITION_SCOPE"] }, { employeeId: "e2", dimensions: ["POSITION"] }]);
  }, 60_000);

  it("inventario real: empresa conservada, ampliación de nuevos y raíces históricas", () => {
    expect(frozen.records.Company).toEqual([expect.objectContaining({ id: "comp-1", class: "conservada" })]);
    expect(frozen.records.Position.map((record) => [record.id, record.class ?? "borrable"])).toEqual(expect.arrayContaining([["pos-new", "nueva"], ["pos-old-1", "borrable"], ["pos-old-2", "borrable"]]));
    expect(frozen.history!.every((entry) => entry.outsideInventory.length === 0)).toBe(true);
  });

  it("hallazgo 2: retirar alcances hacia la empresa CONSERVADA se rechaza antes de cualquier escritura", async () => {
    const outcome = await runCleanup(prisma, input({ apply: true, classFour: [...classFour, { table: "PositionOrgScope", column: "companyId", target: "Company", retain: [], retire: ["comp-1"] }] }), deps);
    expect(outcome.status).toBe("ABORTED");
    expect(outcome.error).toContain("CLASS_FOUR_INVALID");
    expect(outcome.backup).toBeUndefined();
    const now = await readOnly((tx) => captureRowManifest(tx, "localhost"));
    expect(verifyV1(baseline, now, { deleted: {}, nullified: {}, ruleChanges: {}, newRows: {}, newAuditRows: 0 })).toEqual([]);
  }, 60_000);

  it("dry-run: plan, captura, F1 y V1 completos y nada queda escrito", async () => {
    const outcome = await runCleanup(prisma, input({}), deps);
    expect(outcome.error).toBeUndefined();
    expect(outcome.status).toBe("DRY_RUN_OK");
    expect(await count(`"PositionOrgScope"`)).toBe(4);
    expect(await count(`"Position" WHERE "archivedAt" IS NOT NULL`)).toBe(0);
  }, 60_000);

  it("apply: respaldo consolidado (cada fila una vez) == filas retiradas; F1 y V1 verdes", async () => {
    let written: CleanupBackup | undefined;
    const outcome = await runCleanup(prisma, input({ apply: true, writeBackup: (value) => { written = JSON.parse(JSON.stringify(value)) as CleanupBackup; } }), deps);
    expect(outcome.error).toBeUndefined();
    expect(outcome.status).toBe("APPLIED");
    backup = written!;
    expect(backup.format).toBe(2);
    expect(Object.fromEntries(Object.entries(backup.retired).map(([table, entry]) => [table, Object.keys(entry.rows).sort()]))).toEqual({
      Position: ["pos-old-2"], Sector: ["sec-old-2"], BusinessUnit: ["bu-old-2"],
      CostCenterArea: ["cc-1|area-old"], CostCenterBusinessUnit: ["cc-1|bu-old-2"], CostCenterSector: ["cc-1|sec-old-2"],
      PositionSalaryCategory: ["pos-old-2|sc-1"], PositionOrgScope: ["ps-2", "ps-3"],
    });
    expect((outcome.summary.f1 as Array<{ guard: string; ok: boolean }>).map((guard) => [guard.guard, guard.ok])).toEqual([["G4", true], ["G3", true], ["F1.3", true], ["G7", true], ["G5", true], ["G8", true]]);
    expect(outcome.summary.v1).toMatchObject({ violations: [], retiredRows: 9 });
    // Base: retirado exactamente lo respaldado; alcance nuevo y alcance hacia la empresa conservada intactos.
    expect((await prisma.positionOrgScope.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((row) => row.id)).toEqual(["ps-1", "ps-4"]);
    expect((await prisma.businessUnit.findMany({ where: { archivedAt: { not: null } }, select: { id: true } })).map((row) => row.id)).toEqual(["bu-old"]);
    expect(await count(`"Position" WHERE id = 'pos-old-1' AND "archivedAt" IS NOT NULL`)).toBe(1);
    expect(await count(`"Employee" WHERE "positionId" IS NULL AND "sectorId" IS NULL AND id = 'e1'`)).toBe(1);
    expect(await count(`"EmployeeCompany"`)).toBe(1);
  }, 60_000);

  it("restauración con el respaldo en formato 1 (una fila repetida bajo dos claves): dry-run reinserta cada fila una sola vez", async () => {
    const legacy: Record<string, unknown[]> = {};
    for (const [table, entry] of Object.entries(backup!.retired)) legacy[table === "PositionOrgScope" ? "PositionOrgScope.businessUnitId" : table] = Object.values(entry.rows);
    legacy["PositionOrgScope.companyId"] = [backup!.retired.PositionOrgScope!.rows["ps-2"]];
    const { format: _format, retired: _retired, ...rest } = backup!;
    const outcome = await runRestore(prisma, { ...rest, deleted: legacy } as unknown as RestoreBackup, { actorUserId: "u-rrhh", apply: false, host: "localhost" }, restoreAudit);
    expect(outcome.error).toBeUndefined();
    expect(outcome.status).toBe("DRY_RUN_OK");
    expect(outcome.summary.restored).toMatchObject({ rows: 9 });
    expect(await count(`"PositionOrgScope"`)).toBe(2);
  }, 60_000);

  it("restauración (formato 2, apply): mismos IDs y contenido completo, sin duplicados; la base vuelve al estado previo", async () => {
    const outcome = await runRestore(prisma, backup! as unknown as RestoreBackup, { actorUserId: "u-rrhh", apply: true, host: "localhost" }, restoreAudit);
    expect(outcome.error).toBeUndefined();
    expect(outcome.status).toBe("RESTORED");
    const restoredScopes = await prisma.$queryRawUnsafe<Array<{ row: Record<string, unknown> }>>(`SELECT row_to_json(t) AS row FROM "PositionOrgScope" t WHERE id IN ('ps-2','ps-3') ORDER BY id`);
    expect(restoredScopes.map((item) => item.row)).toEqual([backup!.retired.PositionOrgScope!.rows["ps-2"], backup!.retired.PositionOrgScope!.rows["ps-3"]]);
    expect(await count(`"PositionOrgScope"`)).toBe(4);
    for (const table of ["Company", "BusinessUnit", "Establishment", "Area", "Sector", "Position"]) expect(await count(`"${table}" WHERE "archivedAt" IS NOT NULL`)).toBe(0);
    const now = await readOnly((tx) => captureRowManifest(tx, "localhost"));
    // Idéntica al estado previo por ID y contenido, salvo auditoría nueva (limpieza + restauración).
    expect(verifyV1(baseline, now, { deleted: {}, nullified: {}, ruleChanges: {}, newRows: {}, newAuditRows: "ANY" })).toEqual([]);
  }, 60_000);
});
