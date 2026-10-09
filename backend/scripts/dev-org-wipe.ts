/**
 * Limpieza de reorganización autorizada sobre la base de DESARROLLO
 * (Neon `development`, branch `br-dark-resonance-aib3a9t0`), previa a M2.
 *
 * Alcance autorizado (pedido del 2026-10-09):
 *  - Conservar todos los legajos (Employee) y sus datos personales.
 *  - Vaciar Datos Laborales del legajo: positionId, costCenterId, sectorId
 *    (columna que M2 retira), healthInsurance, agreement, receiptCategory,
 *    internalCategory.
 *  - Eliminar el historial laboral: LaborMovement, EmployeeFieldHistory de la
 *    sección DATOS_LABORALES, EmployeeCompany, la historia temporal (tablas
 *    *Period / *PeriodNode / *PeriodCompany) y las ubicaciones de trabajo
 *    (EmployeeWorkLocation / …Establishment).
 *  - Eliminar TODOS los puestos y sus vínculos e historia de alcance:
 *    Position, PositionSalaryCategory, PositionOrgScope, PositionOrgScopePeriod,
 *    PositionOrgScopePeriodNode.
 *  - En estructura conservar SÓLO las empresas: retirar BusinessUnit, Sector,
 *    Area, Establishment, Zone, CostCenter y sus vínculos, resolviendo
 *    dependencias (ClockDevice.establishmentId → NULL).
 *  - Conservar horas, cierres, novedades, documentos, fichadas, auditoría,
 *    dobles reglas, usuarios, dispositivos, responsables/asignaciones
 *    (EmployeeAssignment) y el historial de bloques (EmployeeBlockHistory:
 *    domicilio, horas especiales, responsables — ninguno es Datos Laborales).
 *
 * Reglas de seguridad:
 *  - Conexión SIEMPRE explícita (--env-file + --expected-host); con --apply la
 *    identidad Neon debe estar VERIFICADA (D-0).
 *  - Guarda previa: ninguna DoubleHourRule puede referenciar sector /
 *    costCenter / position que se van a borrar (si alguna lo hiciera, se
 *    detiene y se pide decisión — no se amplía la regla a NULL).
 *  - Backup por tabla+PK de todo lo que se borra y de las columnas que se
 *    vacían, ANTES de escribir, a --backup-out (fuera del repositorio).
 *  - UNA sola transacción Serializable con lock/statement timeout. Dentro de
 *    ella, antes del commit, se comprueba: filas a borrar = filas respaldadas,
 *    tablas borradas en 0, huella (md5) de cada tabla conservada idéntica
 *    (legajos, usuarios y dispositivos sin las columnas vaciadas; auditoría
 *    sin las 2 filas nuevas) y precondiciones de M2. Cualquier diferencia
 *    revierte todo.
 *
 * Uso:
 *   NEON_API_KEY=… npx tsx scripts/dev-org-wipe.ts --env-file=<archivo> --expected-host=<host> \
 *     --neon-project-id=<id> --expected-branch-id=<id> --expected-branch-name=<nombre> \
 *     --actor-user-id=<uuid-usuario-RRHH> [--backup-out=<archivo.json>] [--apply]
 *
 * Sin --apply sólo lee, imprime el plan con conteos y no escribe nada.
 */
import { writeFileSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { connectTarget, arg, flag } from "./org-reorg/lib";
import { requireVerifiedIdentity } from "../src/modules/org-structure/reorg/targetIdentity";

type Db = Pick<Prisma.TransactionClient, "$queryRawUnsafe">;

interface DeleteStep { table: string; where?: string }

// Orden seguro de borrado (hijos primero; respeta los RESTRICT de la capa
// expand: Area.sectorId, Sector.businessUnitId, Establishment.zoneId,
// ClockDevice.establishmentId — este último se vacía explícitamente).
const LABOR_HISTORY_WHERE = `"section" = 'DATOS_LABORALES'`;
const DELETE_STEPS: readonly DeleteStep[] = [
  { table: "EmployeeWorkLocationEstablishment" },
  { table: "EmployeeWorkLocation" },
  { table: "PositionOrgScopePeriodNode" },
  { table: "PositionOrgScopePeriod" },
  { table: "EmployeeEmployerPeriodCompany" },
  { table: "EmployeeEmployerPeriod" },
  { table: "EmployeePositionPeriod" },
  { table: "EmployeeCostCenterPeriod" },
  { table: "EmployeeLegacySectorPeriod" },
  { table: "LaborMovement" },
  { table: "EmployeeFieldHistory", where: LABOR_HISTORY_WHERE },
  { table: "EmployeeCompany" },
  { table: "PositionOrgScope" },
  { table: "PositionSalaryCategory" },
  { table: "Position" },
  { table: "CostCenterArea" },
  { table: "CostCenterBusinessUnit" },
  { table: "CostCenterCompany" },
  { table: "CostCenterEstablishment" },
  { table: "CostCenterSector" },
  { table: "CostCenter" },
  { table: "Area" },
  { table: "Sector" },
  { table: "Establishment" },
  { table: "BusinessUnit" },
  { table: "Zone" },
];

// Columnas de Datos Laborales del legajo que se vacían (se conservan personales).
const EMPLOYEE_LABOR_COLUMNS = ["positionId", "costCenterId", "sectorId", "healthInsurance", "agreement", "receiptCategory", "internalCategory"];

// Tablas conservadas y columnas excluidas de su huella (las que se vacían).
const KEEP: ReadonlyArray<{ table: string; exclude?: string[]; where?: string }> = [
  { table: "Employee", exclude: EMPLOYEE_LABOR_COLUMNS },
  { table: "User", exclude: ["sectorId"] },
  { table: "ClockDevice", exclude: ["establishmentId", "sectorId"] },
  { table: "EmployeeFieldHistory", where: `NOT (${LABOR_HISTORY_WHERE})` },
  ...[
    "Company", "EmployeeAssignment", "EmployeeBlockHistory", "DoubleHourRule", "DoubleHourRuleEmployee", "SpecialHourRuleDate",
    "SpecialHourRuleApplication", "TimeEntry", "MonthlyTimeClosure", "Novelty", "AttendancePunch", "ClockPunchAttempt",
    "TimeSegment", "WorkShift", "HourConceptBreakdown", "StorageFile", "EmployeeDocument", "HolidayWorkAssignment",
    "AttendanceInactivityIncident", "ShiftAlert", "ShiftAssignment", "ShiftTemplate", "EmployeeWorkRegime",
    "EmployeeHourConcept", "EmployeeAddress", "EmployeeTransport", "TimeCorrectionRequest", "SalaryCategory",
  ].map((table) => ({ table })),
];

interface Fingerprint { count: number; md5: string | null }

function rowExpr(exclude: string[] = []) {
  return exclude.length ? `(to_jsonb(t) - ARRAY[${exclude.map((c) => `'${c}'`).join(",")}]::text[])::text` : "to_jsonb(t)::text";
}

async function fingerprint(db: Db, table: string, exclude?: string[], where?: string): Promise<Fingerprint> {
  const expr = rowExpr(exclude);
  const rows = await db.$queryRawUnsafe<Array<{ c: bigint; h: string | null }>>(
    `SELECT count(*)::bigint AS c, md5(string_agg(${expr}, '|' ORDER BY ${expr})) AS h FROM "${table}" t${where ? ` WHERE ${where}` : ""}`,
  );
  return { count: Number(rows[0]?.c ?? 0), md5: rows[0]?.h ?? null };
}

async function countRows(db: Db, step: DeleteStep) {
  const rows = await db.$queryRawUnsafe<Array<{ c: bigint }>>(`SELECT count(*)::bigint AS c FROM "${step.table}"${step.where ? ` WHERE ${step.where}` : ""}`);
  return Number(rows[0]?.c ?? 0);
}

async function keepFingerprints(db: Db) {
  const out: Record<string, Fingerprint> = {};
  for (const keep of KEEP) out[keep.table] = await fingerprint(db, keep.table, keep.exclude, keep.where);
  return out;
}

async function m2Leftovers(db: Db) {
  const rows = await db.$queryRawUnsafe<Array<{ e: bigint; u: bigint; d: bigint }>>(
    `SELECT (SELECT count(*) FROM "Employee" WHERE "sectorId" IS NOT NULL)::bigint AS e,
            (SELECT count(*) FROM "User" WHERE "sectorId" IS NOT NULL)::bigint AS u,
            (SELECT count(*) FROM "ClockDevice" WHERE "sectorId" IS NOT NULL OR "establishmentId" IS NOT NULL)::bigint AS d`,
  );
  return { employeeSectorId: Number(rows[0]?.e), userSectorId: Number(rows[0]?.u), clockDeviceRefs: Number(rows[0]?.d) };
}

async function main() {
  const actorUserId = arg("actor-user-id");
  if (!actorUserId) throw new Error("Falta --actor-user-id (usuario humano RRHH que ejecuta y queda en la auditoría).");
  const backupOut = arg("backup-out");
  const apply = flag("apply");

  const target = await connectTarget();
  const { prisma, host, identity } = target;
  console.error(`Destino: ${host} | identidad: ${identity.status}${identity.status === "VERIFIED" ? ` (${identity.branchName}/${identity.branchId})` : ` — ${identity.reason}`}`);
  if (apply) requireVerifiedIdentity(identity);

  try {
    // ---- Guardas previas (sólo lectura) ------------------------------------
    const ruleRefs = await prisma.$queryRawUnsafe<Array<{ sector: bigint; costCenter: bigint; position: bigint }>>(
      'SELECT count(*) FILTER (WHERE "sectorId" IS NOT NULL)::bigint AS sector, count(*) FILTER (WHERE "costCenterId" IS NOT NULL)::bigint AS "costCenter", count(*) FILTER (WHERE "positionId" IS NOT NULL)::bigint AS position FROM "DoubleHourRule"',
    );
    const refs = ruleRefs[0] ?? { sector: 0n, costCenter: 0n, position: 0n };
    if (Number(refs.sector) || Number(refs.costCenter) || Number(refs.position)) {
      throw new Error(`GUARDA: hay dobles reglas de horas referenciando sector/costCenter/position (${refs.sector}/${refs.costCenter}/${refs.position}). Ampliaría reglas al ponerlas NULL. Se detiene: requiere decisión.`);
    }
    const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
    if (actor?.role !== "NIVEL_1_RRHH") throw new Error("GUARDA: --actor-user-id debe ser un usuario existente de RRHH (NIVEL_1_RRHH).");
    const companies = await prisma.company.count();
    if (companies === 0) throw new Error("GUARDA: no hay empresas; se esperaba conservar al menos una.");
    console.error(`Guardas OK: DoubleHourRule sin refs a sector/costCenter/position; ${companies} empresas a conservar.`);

    // ---- Inventario (sólo lectura) -----------------------------------------
    const toDelete: Record<string, number> = {};
    for (const step of DELETE_STEPS) toDelete[step.table] = await countRows(prisma, step);
    const keptBefore = await keepFingerprints(prisma);
    const nullifyBefore = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      'SELECT id, "positionId", "costCenterId", "sectorId", "healthInsurance", "agreement", "receiptCategory", "internalCategory" FROM "Employee"',
    );
    const userBefore = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT id, "sectorId" FROM "User" WHERE "sectorId" IS NOT NULL');
    const deviceBefore = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      'SELECT id, "establishmentId", "sectorId" FROM "ClockDevice" WHERE "establishmentId" IS NOT NULL OR "sectorId" IS NOT NULL',
    );

    const plan = {
      ranAt: new Date().toISOString(),
      host,
      identity,
      actorUserId,
      apply,
      rowsToDelete: toDelete,
      tablesKept: Object.fromEntries(Object.entries(keptBefore).map(([t, f]) => [t, f.count])),
      employeeLaborColumnsToNullify: EMPLOYEE_LABOR_COLUMNS,
      employeeRows: nullifyBefore.length,
      userSectorIdToNullify: userBefore.length,
      clockDeviceRefsToNullify: deviceBefore.length,
    };
    console.error(JSON.stringify(plan, null, 2));

    if (!apply) {
      if (backupOut) writeFileSync(backupOut, JSON.stringify({ plan }, null, 2));
      console.error("SIN --apply: no se escribió nada.");
      return;
    }
    if (!backupOut) throw new Error("Con --apply es obligatorio --backup-out=<archivo.json> (backup por tabla+PK antes de escribir).");

    // ---- Backup por tabla+PK (antes de escribir, fuera de la transacción) --
    const backup: Record<string, unknown[]> = {};
    const backedUp = (table: string) => backup[table]?.length ?? 0;
    for (const step of DELETE_STEPS) {
      backup[step.table] = await prisma.$queryRawUnsafe<unknown[]>(`SELECT to_jsonb(t) AS row FROM "${step.table}" t${step.where ? ` WHERE ${step.where}` : ""}`);
    }
    writeFileSync(backupOut, JSON.stringify({
      takenAt: new Date().toISOString(),
      host,
      identity,
      actorUserId,
      deleted: backup,
      nullified: { Employee: nullifyBefore, User: userBefore, ClockDevice: deviceBefore },
      keptFingerprints: keptBefore,
    }, null, 2));
    const backedUpTotal = DELETE_STEPS.reduce((s, step) => s + backedUp(step.table), 0);
    console.error(`Backup escrito en ${backupOut} (${backedUpTotal} filas borrables + ${nullifyBefore.length + userBefore.length + deviceBefore.length} filas con referencias a vaciar).`);

    // ---- Transacción única Serializable con verificación previa al commit --
    const { auditService } = await import("../src/modules/audit/audit.service");
    const deletedCounts: Record<string, number> = {};
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '120s'");

      // El cliente de la transacción del script es el PrismaClient base; la auditoría
      // tipa su parámetro con el cliente de la app, que es el mismo en tiempo de ejecución.
      const auditTx = tx as unknown as Parameters<typeof auditService.registerWithin>[0];
      const keptInTx = await keepFingerprints(tx);
      for (const step of DELETE_STEPS) {
        const now = await countRows(tx, step);
        if (now !== backedUp(step.table)) throw new Error(`${step.table} cambió desde el backup (${backedUp(step.table)}→${now}). Se revierte.`);
      }

      for (const column of EMPLOYEE_LABOR_COLUMNS) await tx.$executeRawUnsafe(`UPDATE "Employee" SET "${column}" = NULL WHERE "${column}" IS NOT NULL`);
      await tx.$executeRawUnsafe('UPDATE "User" SET "sectorId" = NULL WHERE "sectorId" IS NOT NULL');
      await tx.$executeRawUnsafe('UPDATE "ClockDevice" SET "establishmentId" = NULL, "sectorId" = NULL WHERE "establishmentId" IS NOT NULL OR "sectorId" IS NOT NULL');
      for (const step of DELETE_STEPS) {
        deletedCounts[step.table] = await tx.$executeRawUnsafe(`DELETE FROM "${step.table}"${step.where ? ` WHERE ${step.where}` : ""}`);
      }

      const totalDeleted = Object.values(deletedCounts).reduce((s, n) => s + n, 0);
      const auditBefore = await fingerprint(tx, "AuditLog");
      const wipeAudit = await auditService.registerWithin(auditTx, {
        userId: actorUserId,
        action: "DELETE",
        entity: "ORG_REORG_DEV_WIPE",
        description: "Se retiró la estructura organizativa heredada (puestos, centros de costo, unidades, sectores, áreas, establecimientos y zonas), el historial laboral y las ubicaciones de trabajo, conservando las empresas, los legajos, las personas, las horas, las novedades, los documentos, las fichadas y la auditoría.",
        before: { deletedCounts },
        after: { companiesKept: companies },
      });
      const laborAudit = await auditService.registerWithin(auditTx, {
        userId: actorUserId,
        action: "UPDATE",
        entity: "ORG_REORG_DEV_WIPE",
        description: "Se vaciaron los datos laborales de los legajos (puesto, centro de costo, sector, obra social, convenio y categorías) previo a la contracción M2 del modelo organizativo.",
        before: { employeeLaborColumns: EMPLOYEE_LABOR_COLUMNS, userSectorId: userBefore.length, clockDeviceRefs: deviceBefore.length },
        after: { employeeRows: nullifyBefore.length },
      });

      // Verificación dentro de la transacción: cualquier diferencia revierte.
      const checks: string[] = [];
      for (const step of DELETE_STEPS) {
        const left = await countRows(tx, step);
        if (left !== 0) checks.push(`${step.table} quedó con ${left} filas (esperaba 0)`);
        if (deletedCounts[step.table] !== backedUp(step.table)) checks.push(`${step.table}: borradas ${deletedCounts[step.table]}, respaldadas ${backedUp(step.table)}`);
      }
      const keptAfter = await keepFingerprints(tx);
      for (const keep of KEEP) {
        const [b, a] = [keptInTx[keep.table], keptAfter[keep.table]];
        if (!b || !a) { checks.push(`${keep.table} sin huella`); continue; }
        if (b.count !== a.count || b.md5 !== a.md5) checks.push(`${keep.table} cambió (${b.count}→${a.count}, huella ${b.md5 === a.md5 ? "igual" : "distinta"})`);
      }
      const auditAfter = await fingerprint(tx, "AuditLog", undefined, `id NOT IN ('${wipeAudit.id}', '${laborAudit.id}')`);
      if (auditAfter.count !== auditBefore.count || auditAfter.md5 !== auditBefore.md5) checks.push("AuditLog previa cambió");
      const leftovers = await m2Leftovers(tx);
      if (leftovers.employeeSectorId || leftovers.userSectorId || leftovers.clockDeviceRefs) checks.push(`Precondición M2 incumplida: ${JSON.stringify(leftovers)}`);
      if (checks.length) throw new Error(`VERIFICACIÓN CON DIFERENCIAS (se revierte todo):\n - ${checks.join("\n - ")}`);
      return { totalDeleted, kept: Object.fromEntries(Object.entries(keptAfter).map(([t, f]) => [t, f.count])) };
    }, { isolationLevel: "Serializable", timeout: 180_000, maxWait: 30_000 });
    const { clearAuditDerivedCaches } = await import("../src/modules/audit/audit.service");
    clearAuditDerivedCaches();

    console.error(`COMMIT OK: ${result.totalDeleted} filas borradas; conservadas intactas (huellas iguales); precondiciones de M2 cumplidas.`);
    console.error(JSON.stringify({ deletedCounts, kept: result.kept, m2: await m2Leftovers(prisma) }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
