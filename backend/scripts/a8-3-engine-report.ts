/**
 * Reporte SÓLO LECTURA del motor de horas especiales sobre un conjunto fijo de
 * pares fecha-legajo. El mismo archivo corre en la rama actual y en un
 * checkout aislado de otro commit: el import dinámico toma el motor del árbol
 * desde el que se ejecuta, y el resto del script es idéntico en ambos casos.
 *
 *   npx tsx scripts/a8-3-engine-report.ts --env-file=<archivo> --expected-host=<host> \
 *     --pairs-from=<reporte D5 con claves employeeId|YYYY-MM-DD> --engine=<etiqueta> --out=<reporte.json>
 *
 * Cada par queda con la etiqueta comparable de los reportes D5
 * (`multiplicador:ganadoras` o `MISSING:dimensiones:regla`), el multiplicador,
 * las reglas aplicables (`matchedRules` con id y nombre), las ganadoras, las
 * conflictivas y —si la fecha no resuelve— las dimensiones faltantes con su
 * regla. El motor corre dentro de una transacción `SET TRANSACTION READ ONLY`:
 * no escribe nada.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { arg, connectTarget, engineOutcomeLabel, readOnly } from "./org-reorg/lib";

type Evaluation = {
  resolution?: {
    multiplier: unknown;
    winners: Array<{ id: string }>;
    matchedRules: Array<{ id: string; name: string }>;
    conflicting: boolean;
  };
  missingHistory?: { dimensions: string[]; ruleId: string; ruleName: string };
};

type PairResult = {
  label: string;
  multiplier: number | null;
  winners: string[];
  matchedRules: Array<{ id: string; name: string }>;
  conflicting: boolean;
  missingHistory: { dimensions: string[]; ruleId: string; ruleName: string } | null;
};

function shape(evaluation: Evaluation): PairResult {
  const label = engineOutcomeLabel(evaluation);
  if (evaluation.missingHistory) {
    const { dimensions, ruleId, ruleName } = evaluation.missingHistory;
    return { label, multiplier: null, winners: [], matchedRules: [], conflicting: false, missingHistory: { dimensions: [...dimensions].sort(), ruleId, ruleName } };
  }
  const { multiplier, winners, matchedRules, conflicting } = evaluation.resolution!;
  return {
    label,
    multiplier: Number(multiplier),
    winners: winners.map((rule) => rule.id).sort(),
    matchedRules: [...matchedRules].sort((a, b) => a.id.localeCompare(b.id)).map((rule) => ({ id: rule.id, name: rule.name })),
    conflicting,
    missingHistory: null,
  };
}

async function main() {
  const out = arg("out");
  const pairsFrom = arg("pairs-from");
  const engine = arg("engine");
  if (!out || !pairsFrom || !engine) throw new Error("Faltan --pairs-from=, --engine= o --out=.");
  const source = JSON.parse(readFileSync(pairsFrom, "utf8")) as { result?: Record<string, unknown>; pairs?: string[] };
  const pairs = source.pairs ?? Object.keys(source.result ?? {});
  if (!pairs.length) throw new Error(`${pairsFrom} no contiene pares (ni "pairs" ni claves de "result").`);
  const byEmployee = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const split = pair.lastIndexOf("|");
    if (split < 1) throw new Error(`Par inválido: ${pair}`);
    const date = pair.slice(split + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Fecha inválida en el par: ${pair}`);
    const employeeId = pair.slice(0, split);
    byEmployee.set(employeeId, (byEmployee.get(employeeId) ?? new Set()).add(date));
  }
  const target = await connectTarget();
  try {
    // Importado DESPUÉS de fijar DATABASE_URL al destino verificado.
    const { evaluateSpecialHourRulesByDate } = await import("../src/modules/time-entries/timeEntries.repository");
    const evaluate = evaluateSpecialHourRulesByDate as unknown as (employeeId: string, dates: Date[], db: unknown) => Promise<Map<string, Evaluation>>;
    const result = await readOnly(target.prisma, async (tx) => {
      const shaped: Record<string, PairResult> = {};
      for (const [employeeId, dateKeys] of byEmployee) {
        // calendarDateKey usa getters UTC: medianoche UTC conserva el par.
        const dates = [...dateKeys].sort().map((key) => new Date(`${key}T00:00:00.000Z`));
        for (const [day, evaluation] of await evaluate(employeeId, dates, tx)) shaped[`${employeeId}|${day}`] = shape(evaluation);
      }
      return shaped;
    });
    const missingPairs = pairs.filter((pair) => !(pair in result));
    const unexpectedKeys = Object.keys(result).filter((key) => !pairs.includes(key));
    writeFileSync(out, JSON.stringify({
      takenAt: new Date().toISOString(),
      host: target.host,
      engine,
      pairsSource: pairsFrom,
      pairs: pairs.length,
      employees: byEmployee.size,
      missingPairs,
      unexpectedKeys,
      result,
    }, null, 2));
    console.log(JSON.stringify({ host: target.host, engine, pares: pairs.length, legajos: byEmployee.size, sinResultado: missingPairs.length, clavesInesperadas: unexpectedKeys.length, out }, null, 2));
    if (missingPairs.length || unexpectedKeys.length) process.exitCode = 2;
  } finally {
    await target.prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
