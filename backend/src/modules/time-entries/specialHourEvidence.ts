/**
 * Lógica pura de la evidencia A8-3 (equivalencia del motor de horas especiales,
 * docs/decisions/A8_M2_PREPARATION.md §3.4). Sin I/O ni cliente: la usan
 * `scripts/a8-3-engine-report.ts` y `scripts/a8-3-compare.ts` y sus pruebas.
 */

/**
 * Resultado mínimo comparable de una fecha: la etiqueta D5
 * (`multiplicador:ganadoras` o `MISSING:dimensiones:regla`) sólo necesita el
 * multiplicador, las ganadoras y, para MISSING, dimensiones y regla. El motor
 * real aporta además `matchedRules`/`conflicting`/`ruleName` (opcionales acá
 * para que el tipo siga sirviendo a los scripts D5 que sólo etiquetan).
 */
export type EngineEvaluation = {
  resolution?: {
    multiplier: unknown;
    winners: Array<{ id: string }>;
    matchedRules?: Array<{ id: string; name: string }>;
    conflicting?: boolean;
  };
  missingHistory?: { dimensions: string[]; ruleId: string; ruleName?: string };
};

/** Registro por par fecha-legajo tal como se guarda en el reporte. */
export type EnginePairResult = {
  label: string;
  multiplier: number | null;
  winners: string[];
  matchedRules: Array<{ id: string; name: string }>;
  conflicting: boolean;
  missingHistory: { dimensions: string[]; ruleId: string; ruleName: string } | null;
};

/**
 * Etiqueta comparable de un resultado: "multiplicador:ganadoras" (mismo formato
 * que los reportes anteriores) o "MISSING:dimensiones:regla" cuando la fecha no
 * se puede resolver sin inventar historia.
 */
export function engineOutcomeLabel(evaluation: EngineEvaluation): string {
  if (evaluation.missingHistory) return `MISSING:${[...evaluation.missingHistory.dimensions].sort().join("+")}:${evaluation.missingHistory.ruleId}`;
  return `${Number(evaluation.resolution!.multiplier)}:${evaluation.resolution!.winners.map((rule) => rule.id).sort().join(",")}`;
}

/** Forma canónica de las reglas aplicables: ordenadas por id y sólo {id, nombre}. */
export function normalizeMatchedRules(rules: Array<{ id: string; name: string }>): Array<{ id: string; name: string }> {
  return [...rules].sort((a, b) => a.id.localeCompare(b.id)).map((rule) => ({ id: rule.id, name: rule.name }));
}

/** Serialización del reporte para un par: etiqueta + detalle completo. */
export function shapeEngineEvaluation(evaluation: EngineEvaluation): EnginePairResult {
  const label = engineOutcomeLabel(evaluation);
  if (evaluation.missingHistory) {
    const { dimensions, ruleId, ruleName } = evaluation.missingHistory;
    return {
      label,
      multiplier: null,
      winners: [],
      matchedRules: [],
      conflicting: false,
      missingHistory: { dimensions: [...dimensions].sort(), ruleId, ruleName: ruleName ?? "" },
    };
  }
  const { multiplier, winners, matchedRules = [], conflicting = false } = evaluation.resolution!;
  return {
    label,
    multiplier: Number(multiplier),
    winners: winners.map((rule) => rule.id).sort(),
    matchedRules: normalizeMatchedRules(matchedRules),
    conflicting,
    missingHistory: null,
  };
}

/**
 * Rechaza pares `employeeId|YYYY-MM-DD` duplicados ANTES de agruparlos (Codex
 * sobre `d2c7f71`) y sólo entonces agrupa fechas por legajo. Un duplicado es
 * el par completo idéntico: el mismo legajo con la misma fecha no debe
 * evaluarse dos veces ni inflar el conteo de pares.
 */
export function groupEnginePairs(pairs: string[]): Map<string, Set<string>> {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const pair of pairs) {
    if (seen.has(pair)) duplicates.push(pair);
    else seen.add(pair);
  }
  if (duplicates.length) throw new Error(`Pares duplicados en la entrada: ${[...new Set(duplicates)].join(", ")}`);
  const byEmployee = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const split = pair.lastIndexOf("|");
    if (split < 1) throw new Error(`Par inválido: ${pair}`);
    const date = pair.slice(split + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Fecha inválida en el par: ${pair}`);
    const employeeId = pair.slice(0, split);
    byEmployee.set(employeeId, (byEmployee.get(employeeId) ?? new Set()).add(date));
  }
  return byEmployee;
}

/**
 * Cobertura del reporte (Codex sobre `d2c7f71`): la cantidad de pares únicos
 * debe coincidir con la cantidad de claves de resultado, sin pares sin
 * resultado y sin claves que no correspondan a ningún par.
 */
export function reportCoverage(pairs: string[], resultKeys: string[]): {
  uniquePairs: number;
  resultKeys: number;
  missingPairs: string[];
  unexpectedKeys: string[];
  ok: boolean;
} {
  const unique = new Set(pairs);
  const resultSet = new Set(resultKeys);
  const missingPairs = [...unique].filter((pair) => !resultSet.has(pair));
  const unexpectedKeys = resultKeys.filter((key) => !unique.has(key));
  const ok = unique.size === resultKeys.length && !missingPairs.length && !unexpectedKeys.length;
  return { uniquePairs: unique.size, resultKeys: resultKeys.length, missingPairs, unexpectedKeys, ok };
}

/**
 * Comparación de dos resultados para el mismo par. Las reglas aplicables se
 * comparan normalizadas por `{id, nombre}` (Codex sobre `d2c7f71`): un cambio
 * de nombre de la misma regla es una diferencia visible, no sólo un cambio de
 * ids.
 */
export function compareEnginePairResults(before: EnginePairResult, after: EnginePairResult): { equal: boolean; detail: string[] } {
  const detail: string[] = [];
  if (before.label !== after.label) detail.push(`label ${before.label} → ${after.label}`);
  if (before.multiplier !== after.multiplier) detail.push(`multiplier ${before.multiplier} → ${after.multiplier}`);
  if (before.winners.join(",") !== after.winners.join(",")) detail.push(`winners ${before.winners.join(",")} → ${after.winners.join(",")}`);
  const matchedBefore = normalizeMatchedRules(before.matchedRules);
  const matchedAfter = normalizeMatchedRules(after.matchedRules);
  if (JSON.stringify(matchedBefore) !== JSON.stringify(matchedAfter)) detail.push(`matchedRules ${JSON.stringify(matchedBefore)} → ${JSON.stringify(matchedAfter)}`);
  if (before.conflicting !== after.conflicting) detail.push(`conflicting ${before.conflicting} → ${after.conflicting}`);
  if (JSON.stringify(before.missingHistory) !== JSON.stringify(after.missingHistory)) detail.push("missingHistory cambió");
  return { equal: !detail.length, detail };
}
