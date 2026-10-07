/**
 * Inventario de SÓLO LECTURA para la limpieza del modelo organizacional
 * anterior (docs/decisions/ORG_LOCATION_REORGANIZATION.md §5, §6; etapa A3).
 *
 *   npx tsx scripts/org-reorg-inventory.ts --env-file=.env.reorg --expected-host=<host> --report=<archivo.json>
 *     [--neon-project-id=<id> --expected-branch-id=<id> --expected-branch-name=<nombre>]   (con NEON_API_KEY en el entorno)
 *
 * Todo corre en transacciones READ ONLY: Postgres rechaza cualquier escritura.
 * Informa, para C1 (conservar empresas) y C2 (eliminarlas):
 * - registros del modelo anterior candidatos al inventario congelado;
 * - TODAS las FKs hacia la estructura (leídas del catálogo) con su onDelete,
 *   filas afectadas y tratamiento (o bloqueo);
 * - reglas de horas especiales que referencian la estructura: alcance,
 *   población actual, trazas ganadoras y cierres alcanzados;
 * - impacto exacto en el motor de horas especiales si se vaciaran sector,
 *   puesto (y empresas en C2) de los legajos SIN tratar las reglas: se usa el
 *   motor real (resolveSpecialHourRulesByDate) con un lector que simula el
 *   legajo limpio, dentro de la misma transacción de sólo lectura;
 * - el plan de limpieza resultante sin decisiones (bloqueos concretos).
 * No imprime credenciales; sólo identificadores, códigos y nombres de catálogo.
 */
import { writeFileSync } from "node:fs";
import { arg, captureRowManifest, connectTarget, countReferences, discoverForeignKeys, inventoryIds, loadInventory, loadRules, readOnly, ruleReferences, type Tx } from "./org-reorg/lib";
import { buildCleanupPlan, classifyReference, inventoryDimensions, type CompanyMode, type FrozenInventory } from "../src/modules/org-structure/reorg/cleanupPlan";

type Resolution = { multiplier: unknown; winners: Array<{ id: string; name?: string }> };
type Resolver = (employeeId: string, dates: Date[], db: unknown) => Promise<Map<string, Resolution>>;

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/** Lector para el motor: igual a la transacción, pero el legajo aparece sin los vínculos que la limpieza vaciaría. */
function simulatedReader(tx: Tx, inventory: FrozenInventory) {
  const sectors = new Set(inventory.records.Sector.map((record) => record.id));
  const positions = new Set(inventory.records.Position.map((record) => record.id));
  const companies = new Set(inventory.records.Company.map((record) => record.id));
  return {
    doubleHourRule: tx.doubleHourRule,
    holidayWorkAssignment: tx.holidayWorkAssignment,
    employee: {
      findUnique: async (args: Parameters<Tx["employee"]["findUnique"]>[0]) => {
        const row = (await tx.employee.findUnique(args)) as { sectorId: string | null; positionId: string | null; companies?: Array<{ companyId: string }> } | null;
        if (!row) return row;
        return {
          ...row,
          sectorId: row.sectorId && sectors.has(row.sectorId) ? null : row.sectorId,
          positionId: row.positionId && positions.has(row.positionId) ? null : row.positionId,
          companies: (row.companies ?? []).filter((company) => !companies.has(company.companyId)),
        };
      },
    },
  };
}

async function engineImpact(tx: Tx, resolve: Resolver, inventory: FrozenInventory) {
  const rows = await tx.$queryRawUnsafe<Array<{ employeeId: string; date: Date }>>(
    `SELECT "employeeId", date FROM "TimeEntry" UNION SELECT "employeeId", date FROM "HourConceptBreakdown" UNION SELECT "employeeId", date FROM "TimeSegment"`,
  );
  const datesByEmployee = new Map<string, Date[]>();
  for (const row of rows) datesByEmployee.set(row.employeeId, [...(datesByEmployee.get(row.employeeId) ?? []), row.date]);
  const reader = simulatedReader(tx, inventory);
  const changes: Array<{ employeeId: string; date: string; before: { multiplier: number; winners: string[] }; after: { multiplier: number; winners: string[] } }> = [];
  for (const [employeeId, dates] of datesByEmployee) {
    const [current, simulated] = [await resolve(employeeId, dates, tx), await resolve(employeeId, dates, reader)];
    for (const [key, now] of current) {
      const then = simulated.get(key);
      const winnersNow = now.winners.map((rule) => rule.id).sort();
      const winnersThen = (then?.winners ?? []).map((rule) => rule.id).sort();
      if (Number(now.multiplier) !== Number(then?.multiplier ?? 1) || winnersNow.join() !== winnersThen.join()) {
        changes.push({ employeeId, date: key, before: { multiplier: Number(now.multiplier), winners: winnersNow }, after: { multiplier: Number(then?.multiplier ?? 1), winners: winnersThen } });
      }
    }
  }
  // Filas existentes en esas fechas (las que una reinterpretación recalcularía) y cierres alcanzados.
  const keys = changes.map((change) => `${change.employeeId}|${change.date}`);
  const [entries, breakdowns, segments] = keys.length ? await Promise.all([
    tx.$queryRawUnsafe<Array<{ n: number; hours: number }>>(`SELECT count(*)::int AS n, coalesce(sum(hours), 0)::float AS hours FROM "TimeEntry" WHERE ("employeeId" || '|' || to_char(date, 'YYYY-MM-DD')) = ANY($1::text[])`, keys),
    tx.$queryRawUnsafe<Array<{ n: number; minutes: number }>>(`SELECT count(*)::int AS n, coalesce(sum(minutes), 0)::int AS minutes FROM "HourConceptBreakdown" WHERE ("employeeId" || '|' || to_char(date, 'YYYY-MM-DD')) = ANY($1::text[])`, keys),
    tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "TimeSegment" WHERE ("employeeId" || '|' || to_char(date, 'YYYY-MM-DD')) = ANY($1::text[])`, keys),
  ]) : [[{ n: 0, hours: 0 }], [{ n: 0, minutes: 0 }], [{ n: 0 }]];
  const periods = [...new Set(changes.map((change) => `${change.employeeId}|${change.date.slice(0, 7)}`))];
  const closures = periods.length
    ? await tx.$queryRawUnsafe<Array<{ status: string; n: number }>>(`SELECT status::text, count(*)::int AS n FROM "MonthlyTimeClosure" WHERE ("employeeId" || '|' || period) = ANY($1::text[]) GROUP BY status`, periods)
    : [];
  return {
    employeesWithHours: datesByEmployee.size,
    employeeDatesEvaluated: rows.length,
    changedEmployeeDates: changes.length,
    employeesAffected: new Set(changes.map((change) => change.employeeId)).size,
    rowsOnChangedDates: { timeEntries: entries[0]!.n, hours: entries[0]!.hours, breakdowns: breakdowns[0]!.n, breakdownMinutes: breakdowns[0]!.minutes, segments: segments[0]!.n },
    employeePeriods: periods.length,
    closuresByStatus: Object.fromEntries(closures.map((row) => [row.status, row.n])),
    changes,
  };
}

async function ruleApplications(tx: Tx, ruleId: string) {
  const [stats] = await tx.$queryRawUnsafe<Array<{ applications: number; winners: number; employees: number; first: Date | null; last: Date | null }>>(
    `SELECT count(*)::int AS applications, count(*) FILTER (WHERE a."isWinner")::int AS winners,
            count(DISTINCT s."employeeId")::int AS employees, min(s.date) AS first, max(s.date) AS last
     FROM "SpecialHourRuleApplication" a JOIN "TimeSegment" s ON s.id = a."timeSegmentId" WHERE a."doubleHourRuleId" = $1`, ruleId,
  );
  const closures = await tx.$queryRawUnsafe<Array<{ status: string; n: number }>>(
    `SELECT c.status::text, count(DISTINCT c.id)::int AS n FROM "SpecialHourRuleApplication" a
     JOIN "TimeSegment" s ON s.id = a."timeSegmentId"
     JOIN "MonthlyTimeClosure" c ON c."employeeId" = s."employeeId" AND c.period = to_char(s.date, 'YYYY-MM')
     WHERE a."doubleHourRuleId" = $1 AND a."isWinner" GROUP BY c.status`, ruleId,
  );
  return { ...stats!, first: stats!.first ? dayKey(stats!.first) : null, last: stats!.last ? dayKey(stats!.last) : null, closuresWithWins: Object.fromEntries(closures.map((row) => [row.status, row.n])) };
}

async function inventoryFor(tx: Tx, companyMode: CompanyMode, resolve: Resolver) {
  const inventory = await loadInventory(tx, companyMode);
  const foreignKeys = await discoverForeignKeys(tx);
  const references = await countReferences(tx, foreignKeys, inventoryIds(inventory));
  const rules = await loadRules(tx);
  const refs = await ruleReferences(tx, rules);
  const plan = buildCleanupPlan({ inventory, references, rules: refs, decisions: [] });
  const names = await catalogNames(tx);
  const affectedRules = [];
  for (const rule of rules) {
    const ref = refs.find((item) => item.ruleId === rule.id)!;
    const dimensions = inventoryDimensions(ref, inventory);
    if (!dimensions.length && !rule.companyId && !rule.sectorId && !rule.positionId && !rule.costCenterId) continue;
    affectedRules.push({
      id: rule.id, name: rule.name, kind: rule.kind, status: rule.status, recurrenceType: rule.recurrenceType,
      fromDate: dayKey(rule.fromDate), toDate: rule.toDate ? dayKey(rule.toDate) : null, priority: rule.priority, multiplier: Number(rule.multiplier),
      scope: {
        company: rule.companyId && { id: rule.companyId, name: names.get(rule.companyId) },
        sector: rule.sectorId && { id: rule.sectorId, name: names.get(rule.sectorId) },
        costCenter: rule.costCenterId && { id: rule.costCenterId, name: names.get(rule.costCenterId) },
        position: rule.positionId && { id: rule.positionId, name: names.get(rule.positionId) },
        explicitEmployees: rule.employees.length,
      },
      referencesInventory: dimensions,
      requiresDecision: dimensions.length > 0,
      currentPopulation: ref.currentPopulation.length,
      activeDates: rule.dates.filter((date) => date.isActive).length,
      applications: await ruleApplications(tx, rule.id),
    });
  }
  return {
    companyMode,
    inventory: Object.fromEntries(Object.entries(inventory.records).map(([table, records]) => [table, { count: records.length, records }])),
    references: references.map((reference) => {
      const { treatment, issue } = classifyReference(reference);
      return { ...reference, treatment, blocking: issue?.blocking ?? (treatment === "RULE_DECISION" && reference.rowsToInventory > 0) };
    }),
    plan: { blocking: plan.blocking, issues: plan.issues, nullify: plan.nullify, deleteLinks: plan.deleteLinks, deletable: Object.fromEntries(Object.entries(plan.deletable).map(([table, ids]) => [table, ids.length])) },
    rules: affectedRules,
    engineImpactWithoutRuleTreatment: await engineImpact(tx, resolve, inventory),
  };
}

async function catalogNames(tx: Tx) {
  const pick = <T extends { id: string; code: string; name: string }>(rows: T[]) => rows.map((row) => [row.id, `${row.code} - ${row.name}`] as const);
  const [companies, sectors, costCenters, positions] = await Promise.all([
    tx.company.findMany({ select: { id: true, code: true, name: true } }),
    tx.sector.findMany({ select: { id: true, code: true, name: true } }),
    tx.costCenter.findMany({ select: { id: true, code: true, name: true } }),
    tx.position.findMany({ select: { id: true, code: true, name: true } }),
  ]);
  return new Map([...pick(companies), ...pick(sectors), ...pick(costCenters), ...pick(positions)]);
}

async function employeeBaseline(tx: Tx) {
  const [summary] = await tx.$queryRawUnsafe<Array<Record<string, number>>>(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'ACTIVO')::int AS active,
           count("positionId")::int AS "withPosition",
           count("sectorId")::int AS "withSector",
           count("costCenterId")::int AS "withCostCenter",
           count(*) FILTER (WHERE "internalCategory" IS NOT NULL)::int AS "withInternalCategory",
           count(*) FILTER (WHERE "receiptCategory" IS NOT NULL)::int AS "withReceiptCategory",
           count(*) FILTER (WHERE agreement IS NOT NULL)::int AS "withAgreement",
           count(*) FILTER (WHERE "healthInsurance" IS NOT NULL)::int AS "withHealthInsurance",
           (SELECT count(DISTINCT "employeeId")::int FROM "EmployeeCompany") AS "withEmployerCompany",
           (SELECT count(*)::int FROM "EmployeeCompany" WHERE "isPrimary") AS "primaryEmployerLinks"
    FROM "Employee"`);
  const assignments = await tx.$queryRawUnsafe<Array<{ type: string; rows: number; employees: number; byPersonNameOnly: number }>>(
    `SELECT type, count(*)::int AS rows, count(DISTINCT "employeeId")::int AS employees, count(*) FILTER (WHERE "userId" IS NULL)::int AS "byPersonNameOnly" FROM "EmployeeAssignment" GROUP BY type ORDER BY type`,
  );
  const reloadList = await tx.$queryRawUnsafe<Array<{ legajo: string; status: string; position: string | null; sector: string | null; employerCompanies: string | null }>>(`
    SELECT e.legajo, e.status::text AS status,
           p.code || ' - ' || p.name AS position,
           s.code || ' - ' || s.name AS sector,
           (SELECT string_agg(c.code || CASE WHEN ec."isPrimary" THEN '*' ELSE '' END, ', ' ORDER BY c.code) FROM "EmployeeCompany" ec JOIN "Company" c ON c.id = ec."companyId" WHERE ec."employeeId" = e.id) AS "employerCompanies"
    FROM "Employee" e LEFT JOIN "Position" p ON p.id = e."positionId" LEFT JOIN "Sector" s ON s.id = e."sectorId"
    WHERE e."positionId" IS NOT NULL OR e."sectorId" IS NOT NULL OR EXISTS (SELECT 1 FROM "EmployeeCompany" ec WHERE ec."employeeId" = e.id)
    ORDER BY e.legajo`);
  const textCopies = await tx.$queryRawUnsafe<Array<{ source: string; field: string; rows: number }>>(`
    SELECT 'EmployeeFieldHistory' AS source, field, count(*)::int AS rows FROM "EmployeeFieldHistory" WHERE field IN ('sector', 'positionId', 'costCenter', 'companies') GROUP BY field
    UNION ALL SELECT 'AuditLog', entity, count(*)::int FROM "AuditLog" WHERE entity IN ('Company', 'BusinessUnit', 'Establishment', 'Area', 'Sector', 'Position', 'CostCenter', 'Employee') GROUP BY entity
    ORDER BY 1, 2`);
  return { summary, assignments, reloadList, textCopies };
}

async function main() {
  const reportPath = arg("report");
  if (!reportPath) throw new Error("Falta --report=<archivo.json> (fuera del repositorio).");
  const target = await connectTarget();
  // Importado después de fijar DATABASE_URL al destino verificado.
  const { resolveSpecialHourRulesByDate } = await import("../src/modules/time-entries/timeEntries.repository");
  const resolve = resolveSpecialHourRulesByDate as unknown as Resolver;
  try {
    const report = await readOnly(target.prisma, async (tx) => {
      const [meta] = await tx.$queryRawUnsafe<Array<{ database: string; now: string; server: string }>>("SELECT current_database() AS database, now()::text AS now, current_setting('server_version') AS server");
      const migrations = await tx.$queryRawUnsafe<Array<{ migration_name: string }>>(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at DESC LIMIT 3`);
      const newModel = await tx.$queryRawUnsafe<Array<Record<string, number>>>(`SELECT
        (SELECT count(*)::int FROM "Zone") AS zones,
        (SELECT count(*)::int FROM "Sector" WHERE "businessUnitId" IS NOT NULL) AS "sectorsWithBusinessUnit",
        (SELECT count(*)::int FROM "Area" WHERE "sectorId" IS NOT NULL) AS "areasWithSector",
        (SELECT count(*)::int FROM "Establishment" WHERE "zoneId" IS NOT NULL) AS "establishmentsWithZone",
        (SELECT count(*)::int FROM "PositionOrgScope") AS "positionScopes",
        (SELECT count(*)::int FROM "EmployeeWorkLocation") AS "workLocations"`);
      const manifest = await captureRowManifest(tx, target.host);
      return {
        generatedAt: new Date().toISOString(),
        readOnly: true,
        target: { host: target.host, database: meta!.database, serverVersion: meta!.server, dbNow: meta!.now, neonIdentity: target.identity },
        lastMigrations: migrations.map((row) => row.migration_name),
        newModelRows: newModel[0],
        tableRowCounts: Object.fromEntries(Object.entries(manifest.tables).map(([table, data]) => [table, Object.keys(data.rows).length])),
        employees: await employeeBaseline(tx),
        C1: await inventoryFor(tx, "C1", resolve),
        C2: await inventoryFor(tx, "C2", resolve),
      };
    });
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    const brief = (mode: "C1" | "C2") => ({
      inventario: Object.fromEntries(Object.entries(report[mode].inventory).map(([table, data]) => [table, (data as { count: number }).count])),
      bloqueos: report[mode].plan.issues.filter((issue) => issue.blocking).map((issue) => `${issue.code}: ${issue.message}`),
      reglasQueRequierenDecision: report[mode].rules.filter((rule) => rule.requiresDecision).length,
      impactoMotorSinTratar: { fechasLegajoQueCambian: report[mode].engineImpactWithoutRuleTreatment.changedEmployeeDates, legajos: report[mode].engineImpactWithoutRuleTreatment.employeesAffected, cierres: report[mode].engineImpactWithoutRuleTreatment.closuresByStatus },
    });
    console.log(JSON.stringify({ host: target.host, identidadNeon: target.identity.status, C1: brief("C1"), C2: brief("C2"), reporte: reportPath }, null, 2));
  } finally {
    await target.prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
