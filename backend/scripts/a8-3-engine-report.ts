/**
 * Reporte SÓLO LECTURA del motor de horas especiales sobre un conjunto fijo de
 * pares fecha-legajo. El mismo archivo corre en la rama actual y en un
 * checkout aislado de otro commit: el import dinámico toma el motor del árbol
 * desde el que se ejecuta, y el resto del script es idéntico en ambos casos
 * (en un checkout aislado hay que copiar además
 * `src/modules/time-entries/specialHourEvidence.ts`, módulo puro sin
 * dependencias del motor).
 *
 *   npx tsx scripts/a8-3-engine-report.ts --env-file=<archivo> --expected-host=<host> \
 *     --pairs-from=<reporte D5 con claves employeeId|YYYY-MM-DD> --engine=<etiqueta> --out=<reporte.json>
 *
 * Antes de tocar la base se rechazan pares `employeeId|fecha` duplicados y se
 * agrupa recién entonces; al final se verifica que la cantidad de pares
 * únicos coincide con las claves de resultado, sin pares sin resultado ni
 * claves sin par (si algo falla, exit 2). Cada par queda con la etiqueta
 * comparable de los reportes D5 (`multiplicador:ganadoras` o
 * `MISSING:dimensiones:regla`), el multiplicador, las reglas aplicables
 * (`matchedRules` con id y nombre), las ganadoras, el conflicto y —si la fecha
 * no resuelve— las dimensiones faltantes con su regla. El motor corre dentro
 * de una transacción `SET TRANSACTION READ ONLY`: no escribe nada.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { arg, connectTarget, readOnly } from "./org-reorg/lib";
import { groupEnginePairs, reportCoverage, shapeEngineEvaluation, type EngineEvaluation, type EnginePairResult } from "../src/modules/time-entries/specialHourEvidence";

async function main() {
  const out = arg("out");
  const pairsFrom = arg("pairs-from");
  const engine = arg("engine");
  if (!out || !pairsFrom || !engine) throw new Error("Faltan --pairs-from=, --engine= o --out=.");
  const source = JSON.parse(readFileSync(pairsFrom, "utf8")) as { result?: Record<string, unknown>; pairs?: string[] };
  const pairs = source.pairs ?? Object.keys(source.result ?? {});
  if (!pairs.length) throw new Error(`${pairsFrom} no contiene pares (ni "pairs" ni claves de "result").`);
  // Rechaza duplicados ANTES de agrupar y antes de cualquier conexión.
  const byEmployee = groupEnginePairs(pairs);
  const target = await connectTarget();
  try {
    // Importado DESPUÉS de fijar DATABASE_URL al destino verificado.
    const { evaluateSpecialHourRulesByDate } = await import("../src/modules/time-entries/timeEntries.repository");
    const evaluate = evaluateSpecialHourRulesByDate as unknown as (employeeId: string, dates: Date[], db: unknown) => Promise<Map<string, EngineEvaluation>>;
    const result = await readOnly(target.prisma, async (tx) => {
      const shaped: Record<string, EnginePairResult> = {};
      for (const [employeeId, dateKeys] of byEmployee) {
        // calendarDateKey usa getters UTC: medianoche UTC conserva el par.
        const dates = [...dateKeys].sort().map((key) => new Date(`${key}T00:00:00.000Z`));
        for (const [day, evaluation] of await evaluate(employeeId, dates, tx)) shaped[`${employeeId}|${day}`] = shapeEngineEvaluation(evaluation);
      }
      return shaped;
    });
    const coverage = reportCoverage(pairs, Object.keys(result));
    writeFileSync(out, JSON.stringify({
      takenAt: new Date().toISOString(),
      host: target.host,
      engine,
      pairsSource: pairsFrom,
      pairs: pairs.length,
      uniquePairs: coverage.uniquePairs,
      resultKeys: coverage.resultKeys,
      employees: byEmployee.size,
      missingPairs: coverage.missingPairs,
      unexpectedKeys: coverage.unexpectedKeys,
      result,
    }, null, 2));
    console.log(JSON.stringify({
      host: target.host,
      engine,
      pares: pairs.length,
      paresUnicos: coverage.uniquePairs,
      clavesResultado: coverage.resultKeys,
      legajos: byEmployee.size,
      sinResultado: coverage.missingPairs.length,
      clavesInesperadas: coverage.unexpectedKeys.length,
      coberturaOk: coverage.ok,
      out,
    }, null, 2));
    if (!coverage.ok) process.exitCode = 2;
  } finally {
    await target.prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
