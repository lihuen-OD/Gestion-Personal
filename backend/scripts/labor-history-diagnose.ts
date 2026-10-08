/**
 * Diagnóstico de SÓLO LECTURA de la historia temporal (D-5,
 * docs/decisions/ORG_LOCATION_REORGANIZATION.md §19). Todo corre en una
 * transacción READ ONLY: Postgres rechaza cualquier escritura.
 *
 *   npx tsx scripts/labor-history-diagnose.ts coverage --env-file=<env> --expected-host=<host> --report=<archivo.json>
 *     Cobertura por legajo y dimensión (hoy y desde cuándo), puestos sin
 *     historia de alcance y, con el motor real, cada legajo + fecha con horas
 *     que hoy NO se puede resolver por falta de historia (qué dimensión y regla).
 *     Es la entrada del procedimiento de inicialización (§19.4).
 *
 *   npx tsx scripts/labor-history-diagnose.ts engine --env-file=<env> --expected-host=<host> --out=<archivo.json>
 *       [--compare=<snapshot previo.json>] [--simulate-current-history-from=YYYY-MM-DD]
 *     Resultado del motor para cada legajo + fecha con horas, desgloses o
 *     tramos ("multiplicador:ganadoras" o "MISSING:dimensiones:regla").
 *     `--compare` lo contrasta con otro snapshot (p. ej. el tomado con el motor
 *     anterior). `--simulate-current-history-from` completa EN MEMORIA, sólo
 *     donde no hay historia registrada, una vigencia igual a los valores
 *     actuales desde esa fecha: sirve para probar que, con historia
 *     equivalente, el motor nuevo resuelve igual que el anterior. No escribe ni
 *     inicializa nada.
 *
 * No imprime credenciales; sólo IDs, legajos, códigos y fechas.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { arg, connectTarget, employeeDatesWithHours, engineOutcomes, readOnly, type EngineEvaluator, type Tx } from "./org-reorg/lib";
import { historyFromCurrentValues } from "./labor-history/simulatedReaders";

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

function compare(current: Record<string, string>, previous: Record<string, string>) {
  const changed: Array<{ key: string; before: string | null; after: string | null }> = [];
  let equal = 0;
  let missing = 0;
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    const before = previous[key] ?? null;
    const after = current[key] ?? null;
    if (after?.startsWith("MISSING")) missing += 1;
    if (before === after) equal += 1;
    else changed.push({ key, before, after });
  }
  const valueChanges = changed.filter((change) => !change.after?.startsWith("MISSING"));
  return { compared: Object.keys(previous).length, equal, missingHistory: missing, changed: changed.length, valueChanges: valueChanges.length, details: changed };
}

async function coverage(tx: Tx, evaluate: EngineEvaluator) {
  const today = (await tx.$queryRawUnsafe<Array<{ d: string }>>(`SELECT ((now() AT TIME ZONE 'America/Argentina/Cordoba')::date)::text AS d`))[0]!.d;
  const employees = await tx.employee.findMany({ select: { id: true, legajo: true, status: true }, orderBy: { legajo: "asc" } });
  const periods = async (table: string) => tx.$queryRawUnsafe<Array<{ employeeId: string; first: Date; today: boolean }>>(
    `SELECT "employeeId", min("effectiveFrom") AS first, bool_or("effectiveFrom" <= $1::date AND ("effectiveTo" IS NULL OR "effectiveTo" >= $1::date)) AS today FROM "${table}" GROUP BY "employeeId"`, today,
  );
  const dimensions = {
    position: await periods("EmployeePositionPeriod"),
    costCenter: await periods("EmployeeCostCenterPeriod"),
    legacySector: await periods("EmployeeLegacySectorPeriod"),
    employer: await periods("EmployeeEmployerPeriod"),
  };
  const byEmployee = Object.fromEntries(Object.entries(dimensions).map(([name, rows]) => [name, new Map(rows.map((row) => [row.employeeId, row]))]));
  const positions = await tx.$queryRawUnsafe<Array<{ code: string; scopes: number; scopeHistory: number }>>(`
    SELECT p.code, (SELECT count(*)::int FROM "PositionOrgScope" s WHERE s."positionId" = p.id) AS scopes,
           (SELECT count(*)::int FROM "PositionOrgScopePeriod" h WHERE h."positionId" = p.id) AS "scopeHistory"
    FROM "Position" p ORDER BY p.code`);
  const { byEmployee: datesByEmployee } = await employeeDatesWithHours(tx);
  const unresolved: Array<{ legajo: string; date: string; dimensions: string[]; ruleId: string }> = [];
  const legajoOf = new Map(employees.map((employee) => [employee.id, employee.legajo]));
  for (const [employeeId, dates] of datesByEmployee) {
    for (const [date, evaluation] of await evaluate(employeeId, dates, tx)) {
      if (evaluation.missingHistory) unresolved.push({ legajo: legajoOf.get(employeeId) ?? employeeId, date, dimensions: evaluation.missingHistory.dimensions, ruleId: evaluation.missingHistory.ruleId });
    }
  }
  const rows = employees.map((employee) => ({
    legajo: employee.legajo,
    status: employee.status,
    ...Object.fromEntries(Object.entries(byEmployee).map(([name, map]) => {
      const row = map.get(employee.id);
      return [name, row ? { from: dayKey(row.first), coversToday: row.today } : null];
    })),
  }));
  const fullyCoveredToday = rows.filter((row) => ["position", "costCenter", "legacySector", "employer"].every((name) => (row as Record<string, unknown>)[name] && ((row as Record<string, { coversToday: boolean }>)[name]!.coversToday))).length;
  return {
    today,
    employees: rows.length,
    employeesFullyCoveredToday: fullyCoveredToday,
    employeesWithoutAnyHistory: rows.filter((row) => ["position", "costCenter", "legacySector", "employer"].every((name) => !(row as Record<string, unknown>)[name])).length,
    positions: { total: positions.length, withScopes: positions.filter((row) => row.scopes > 0).length, withScopesButNoHistory: positions.filter((row) => row.scopes > 0 && row.scopeHistory === 0).map((row) => row.code) },
    unresolvedEmployeeDates: unresolved.length,
    unresolvedByRule: unresolved.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.ruleId]: (acc[item.ruleId] ?? 0) + 1 }), {}),
    unresolved: unresolved.sort((a, b) => a.legajo.localeCompare(b.legajo) || a.date.localeCompare(b.date)),
    byEmployee: rows,
  };
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "coverage" && mode !== "engine") throw new Error("Modo: coverage | engine");
  const target = await connectTarget();
  // Importado después de fijar DATABASE_URL al destino verificado.
  const { evaluateSpecialHourRulesByDate } = await import("../src/modules/time-entries/timeEntries.repository");
  const evaluate = evaluateSpecialHourRulesByDate as unknown as EngineEvaluator;
  try {
    if (mode === "coverage") {
      const report = arg("report");
      if (!report) throw new Error("Falta --report=<archivo.json> (fuera del repositorio).");
      const result = await readOnly(target.prisma, (tx) => coverage(tx, evaluate));
      writeFileSync(report, JSON.stringify({ generatedAt: new Date().toISOString(), host: target.host, identity: target.identity.status, readOnly: true, ...result }, null, 2));
      const { byEmployee: _rows, unresolved: _unresolved, ...summary } = result;
      console.log(JSON.stringify({ host: target.host, ...summary, report }, null, 2));
      return;
    }
    const out = arg("out");
    if (!out) throw new Error("Falta --out=<archivo.json> (fuera del repositorio).");
    const simulateFrom = arg("simulate-current-history-from");
    const outcomes = await readOnly(target.prisma, async (tx) => engineOutcomes(tx, evaluate, simulateFrom ? await historyFromCurrentValues(tx, simulateFrom) : tx));
    const result = Object.fromEntries([...outcomes].sort(([a], [b]) => a.localeCompare(b)));
    const previousPath = arg("compare");
    const comparison = previousPath ? compare(result, (JSON.parse(readFileSync(previousPath, "utf8")) as { result: Record<string, string> }).result) : null;
    writeFileSync(out, JSON.stringify({ takenAt: new Date().toISOString(), host: target.host, readOnly: true, simulatedCurrentHistoryFrom: simulateFrom ?? null, employeeDates: outcomes.size, result, ...(comparison ? { comparison } : {}) }, null, 2));
    console.log(JSON.stringify({ host: target.host, simulatedCurrentHistoryFrom: simulateFrom ?? null, employeeDates: outcomes.size, ...(comparison ? { comparison: { ...comparison, details: comparison.details.slice(0, 20) } } : {}), out }, null, 2));
  } finally {
    await target.prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
