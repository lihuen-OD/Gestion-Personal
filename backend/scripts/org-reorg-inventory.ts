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
 * - historia temporal de D-5 (§19): filas por tabla, cobertura de hoy por
 *   dimensión y, por fuente, los IDs exactos referenciados (A8 §12.2);
 * - congelado con clases (`borrable`/`conservada`/`nueva`) y el ciclo de
 *   ampliación: cada destino de historia fuera del inventario se incorpora
 *   con el mismo criterio de membresía, ronda por ronda, hasta
 *   `outsideInventory = ∅` (sin reconocimiento ni flag); G8 del paso 3;
 * - F0 + G1 (formas vieja/nueva sin mirar archivedAt, A8 §12.3): con formas
 *   mezcladas el reporte se escribe igual y el proceso sale con exit 2;
 * - impacto en el motor de horas especiales si desaparecieran las referencias
 *   al inventario SIN tratar las reglas: motor real
 *   (evaluateSpecialHourRulesByDate) con un lector que simula esa historia,
 *   dentro de la misma transacción de sólo lectura; las fechas sin historia
 *   suficiente se informan como MISSING;
 * - el plan de limpieza resultante sin decisiones (bloqueos concretos).
 * No imprime credenciales; sólo identificadores, códigos y nombres de catálogo.
 */
import { writeFileSync } from "node:fs";
import { amplifyInventory, arg, captureRowManifest, connectTarget, countReferences, discoverForeignKeys, employeeDatesWithHours, engineOutcomes, inventoryIds, loadInventory, loadRules, loadShapeRows, readOnly, ruleReferences, type EngineEvaluator, type Tx } from "./org-reorg/lib";
import { historyWithoutReferences } from "./labor-history/simulatedReaders";
import { borrableIds, buildCleanupPlan, classifyReference, inventoryDimensions, type CompanyMode, type FrozenInventory } from "../src/modules/org-structure/reorg/cleanupPlan";
import { evaluateF0 } from "../src/modules/org-structure/reorg/shapes";
import { evaluateG8 } from "../src/modules/org-structure/reorg/guards";

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Impacto en el motor si desaparecieran las referencias a registros del
 * inventario. Desde D-5 el motor no lee las columnas vigentes del legajo sino
 * su historia temporal (§19): se simula en memoria una historia sin esas
 * referencias. Una fecha sin historia suficiente figura como MISSING tanto
 * antes como después (no es un cambio de la limpieza).
 */
async function engineImpact(tx: Tx, evaluate: EngineEvaluator, inventory: FrozenInventory) {
  const { rows } = await employeeDatesWithHours(tx);
  const candidates = borrableIds(inventory);
  const reader = historyWithoutReferences(tx, {
    sectors: new Set(candidates.Sector),
    positions: new Set(candidates.Position),
    companies: new Set(candidates.Company),
  });
  const [current, simulated] = [await engineOutcomes(tx, evaluate), await engineOutcomes(tx, evaluate, reader)];
  const missingNow = [...current.values()].filter((value) => value.startsWith("MISSING")).length;
  const changes: Array<{ employeeId: string; date: string; before: string; after: string }> = [];
  for (const [key, now] of current) {
    const then = simulated.get(key) ?? "1:";
    if (now !== then) changes.push({ employeeId: key.split("|")[0]!, date: key.split("|")[1]!, before: now, after: then });
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
    employeesWithHours: new Set([...current.keys()].map((key) => key.split("|")[0])).size,
    employeeDatesEvaluated: rows,
    employeeDatesWithoutHistory: missingNow,
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

async function inventoryFor(tx: Tx, companyMode: CompanyMode, evaluate: EngineEvaluator) {
  // A8 §12.2: congelado con clases + historia con los IDs EXACTOS por fuente;
  // `outsideInventory` sólo se vacía por ampliación (mismo criterio de
  // membresía, rondas registradas con IDs), nunca por reconocimiento.
  const { inventory, rounds } = await amplifyInventory(tx, await loadInventory(tx, companyMode));
  const history = inventory.history!;
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
    inventory: {
      ...Object.fromEntries(Object.entries(inventory.records).map(([table, records]) => [table, {
        count: records.length,
        byClass: Object.fromEntries((["borrable", "conservada", "nueva"] as const).map((cls) => [cls, records.filter((record) => (record.class ?? "borrable") === cls).length])),
        records,
      }])),
      history,
    },
    amplification: rounds,
    // G8 en el paso 3 (§12.5): outsideInventory = ∅ tras la ampliación y ningún referenciado entre los eliminables del plan.
    g8: evaluateG8(history, plan.deletable),
    references: references.map((reference) => {
      // §12.7 (gate apagado por defecto): en C2 la historia hacia Company sigue bloqueando (HT-4).
      const { treatment, issue } = classifyReference(reference, { historyBlocking: reference.target === "Company" && companyMode === "C2" });
      return { ...reference, treatment, blocking: issue?.blocking ?? (treatment === "RULE_DECISION" && reference.rowsToInventory > 0) };
    }),
    plan: { blocking: plan.blocking, issues: plan.issues, nullify: plan.nullify, deleteLinks: plan.deleteLinks, roots: plan.roots, retained: plan.retained, deletable: plan.deletable },
    rules: affectedRules,
    engineImpactWithoutRuleTreatment: await engineImpact(tx, evaluate, inventory),
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

/** Historia temporal (D-5): filas por tabla y cobertura del día de hoy por dimensión. Sólo lectura. */
async function laborHistoryBaseline(tx: Tx) {
  const [counts] = await tx.$queryRawUnsafe<Array<Record<string, number>>>(`SELECT
    (SELECT count(*)::int FROM "EmployeePositionPeriod") AS "employeePositionPeriods",
    (SELECT count(*)::int FROM "EmployeeCostCenterPeriod") AS "employeeCostCenterPeriods",
    (SELECT count(*)::int FROM "EmployeeLegacySectorPeriod") AS "employeeLegacySectorPeriods",
    (SELECT count(*)::int FROM "EmployeeEmployerPeriod") AS "employeeEmployerPeriods",
    (SELECT count(*)::int FROM "EmployeeEmployerPeriodCompany") AS "employeeEmployerPeriodCompanies",
    (SELECT count(*)::int FROM "PositionOrgScopePeriod") AS "positionOrgScopePeriods",
    (SELECT count(*)::int FROM "PositionOrgScopePeriodNode") AS "positionOrgScopePeriodNodes"`);
  const [coverage] = await tx.$queryRawUnsafe<Array<Record<string, number>>>(`
    WITH today AS (SELECT (now() AT TIME ZONE 'America/Argentina/Cordoba')::date AS d)
    SELECT
      (SELECT count(*)::int FROM "Employee") AS employees,
      (SELECT count(DISTINCT p."employeeId")::int FROM "EmployeePositionPeriod" p, today WHERE p."effectiveFrom" <= today.d AND (p."effectiveTo" IS NULL OR p."effectiveTo" >= today.d)) AS "coveredPositionToday",
      (SELECT count(DISTINCT p."employeeId")::int FROM "EmployeeCostCenterPeriod" p, today WHERE p."effectiveFrom" <= today.d AND (p."effectiveTo" IS NULL OR p."effectiveTo" >= today.d)) AS "coveredCostCenterToday",
      (SELECT count(DISTINCT p."employeeId")::int FROM "EmployeeLegacySectorPeriod" p, today WHERE p."effectiveFrom" <= today.d AND (p."effectiveTo" IS NULL OR p."effectiveTo" >= today.d)) AS "coveredLegacySectorToday",
      (SELECT count(DISTINCT p."employeeId")::int FROM "EmployeeEmployerPeriod" p, today WHERE p."effectiveFrom" <= today.d AND (p."effectiveTo" IS NULL OR p."effectiveTo" >= today.d)) AS "coveredEmployerToday",
      (SELECT count(*)::int FROM "Position") AS positions,
      (SELECT count(DISTINCT p."positionId")::int FROM "PositionOrgScopePeriod" p, today WHERE p."effectiveFrom" <= today.d AND (p."effectiveTo" IS NULL OR p."effectiveTo" >= today.d)) AS "positionsWithScopeHistoryToday"`);
  return { rows: counts, coverage };
}

async function main() {
  const reportPath = arg("report");
  if (!reportPath) throw new Error("Falta --report=<archivo.json> (fuera del repositorio).");
  const target = await connectTarget();
  // Importado después de fijar DATABASE_URL al destino verificado.
  const { evaluateSpecialHourRulesByDate } = await import("../src/modules/time-entries/timeEntries.repository");
  const evaluate = evaluateSpecialHourRulesByDate as unknown as EngineEvaluator;
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
      // F0 (+ G1) en el paso 3, antes de escribir: formas vieja/nueva sin mirar archivedAt (§12.3).
      const f0 = evaluateF0(await loadShapeRows(tx));
      return {
        generatedAt: new Date().toISOString(),
        readOnly: true,
        target: { host: target.host, database: meta!.database, serverVersion: meta!.server, dbNow: meta!.now, neonIdentity: target.identity },
        lastMigrations: migrations.map((row) => row.migration_name),
        newModelRows: newModel[0],
        tableRowCounts: Object.fromEntries(Object.entries(manifest.tables).map(([table, data]) => [table, Object.keys(data.rows).length])),
        employees: await employeeBaseline(tx),
        laborHistory: await laborHistoryBaseline(tx),
        f0,
        C1: await inventoryFor(tx, "C1", evaluate),
        C2: await inventoryFor(tx, "C2", evaluate),
      };
    });
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    const brief = (mode: "C1" | "C2") => ({
      inventario: Object.fromEntries(
        Object.entries(report[mode].inventory).map(([entry, data]) => [
          entry,
          Array.isArray(data) ? { historialFuentes: (data as unknown[]).length } : (data as { byClass: unknown }).byClass,
        ]),
      ),
      ampliacion: report[mode].amplification.map((round) => ({ ronda: round.round, incorporados: round.added.length })),
      g8: report[mode].g8.ok,
      bloqueos: report[mode].plan.issues.filter((issue) => issue.blocking).map((issue) => `${issue.code}: ${issue.message}`),
      reglasQueRequierenDecision: report[mode].rules.filter((rule) => rule.requiresDecision).length,
      impactoMotorSinTratar: { fechasLegajoQueCambian: report[mode].engineImpactWithoutRuleTreatment.changedEmployeeDates, legajos: report[mode].engineImpactWithoutRuleTreatment.employeesAffected, cierres: report[mode].engineImpactWithoutRuleTreatment.closuresByStatus },
    });
    console.log(JSON.stringify({ host: target.host, identidadNeon: target.identity.status, f0: { ok: report.f0.ok, violaciones: report.f0.violations.length }, C1: brief("C1"), C2: brief("C2"), reporte: reportPath }, null, 2));
    // F0 es compuerta del tratamiento (§12.12): con formas mezcladas el reporte se escribe igual, pero el exit marca el bloqueo.
    if (!report.f0.ok) process.exitCode = 2;
  } finally {
    await target.prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
