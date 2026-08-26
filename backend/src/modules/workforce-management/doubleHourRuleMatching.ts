// Etapa 8B: funciones puras (sin Prisma) del motor de Horas Especiales,
// compartidas entre el motor real (time-entries, al fichar) y el preview de
// calendario (workforce-management, de sólo configuración). Viven acá y no
// en time-entries porque workforce-management es el módulo dueño de
// DoubleHourRule — time-entries ya importa de acá (attendanceRecipients),
// nunca al revés.

export type RecurrenceType = "FECHA" | "RANGO" | "SEMANAL";

export type DoubleHourRuleForMatching = {
  id: string;
  recurrenceType: RecurrenceType;
  fromDate: Date;
  toDate: Date | null;
  weekdays: number[];
};

// ruleId -> set de fechas "YYYY-MM-DD" activas (isActive=true). Se arma una
// sola vez por lote de reglas (buildActiveDatesByRule) para no repetir el
// filtro isActive en cada llamada a ruleMatchesDate.
export type ActiveDatesByRule = Map<string, Set<string>>;

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildActiveDatesByRule(rules: Array<{ id: string; dates: Array<{ date: Date; isActive: boolean }> }>): ActiveDatesByRule {
  const map: ActiveDatesByRule = new Map();
  for (const rule of rules) {
    const active = new Set<string>();
    for (const entry of rule.dates) {
      if (entry.isActive) active.add(dateKey(entry.date));
    }
    map.set(rule.id, active);
  }
  return map;
}

// FECHA: la condición son las fechas explícitas de SpecialHourRuleDate
// (activeDatesByRule), no fromDate — una regla FECHA puede cubrir muchas
// fechas (feriados) o una sola. RANGO/SEMANAL: mismo criterio que siempre,
// sobre fromDate/toDate/weekdays.
export function ruleMatchesDate(rule: DoubleHourRuleForMatching, date: Date, activeDatesByRule: ActiveDatesByRule): boolean {
  const segmentKey = dateKey(date);
  if (rule.recurrenceType === "FECHA") {
    return activeDatesByRule.get(rule.id)?.has(segmentKey) ?? false;
  }
  const fromKey = dateKey(rule.fromDate);
  const toKey = rule.toDate ? dateKey(rule.toDate) : undefined;
  if (rule.recurrenceType === "RANGO") return segmentKey >= fromKey && (!toKey || segmentKey <= toKey);
  const segmentDay = date.getUTCDay();
  return segmentKey >= fromKey && (!toKey || segmentKey <= toKey) && rule.weekdays.includes(segmentDay);
}

export type WinningRulesResult<T> = {
  winners: T[];
  multiplier: number;
  conflicting: boolean;
};

// V1 (decisión 8A/8F, ahora con prioridad — Etapa 8B): las reglas NO se
// acumulan. Gana la de mayor `priority`; si dos o más empatan en la mayor
// prioridad, se resuelve con el mismo criterio que existía antes de tener
// prioridad (el multiplicador más alto entre las empatadas) pero queda
// marcado como conflicto (`conflicting: true`) para que quede trazado — no
// bloquea ni rompe el pipeline de fichada.
// `multiplier` se tipa laxo (no number|string) a propósito: en el motor real
// llega como Prisma.Decimal (no un number ni un string), y este módulo no
// depende de @prisma/client. Number(rule.multiplier) funciona igual para
// Decimal, string o number — sólo se usa para comparar magnitudes.
export function resolveWinningRules<T extends { priority: number; multiplier: unknown }>(matchedRules: T[]): WinningRulesResult<T> {
  if (!matchedRules.length) return { winners: [], multiplier: 1, conflicting: false };
  const maxPriority = Math.max(...matchedRules.map((rule) => rule.priority));
  const topRules = matchedRules.filter((rule) => rule.priority === maxPriority);
  const multiplier = Math.max(...topRules.map((rule) => Number(rule.multiplier)));
  return { winners: topRules, multiplier, conflicting: topRules.length > 1 };
}

export type ScopeShape = {
  companyId: string | null;
  sectorId: string | null;
  costCenterId: string | null;
  positionId: string | null;
  // Vacío = sin restricción por persona (alcanza a cualquiera dentro del
  // resto del alcance configurado).
  employeeIds: string[];
};

// Heurístico ADVISORIO para el calendario de configuración (no es la
// resolución real, que siempre corre en el motor con el empleado concreto):
// dos alcances se consideran mutuamente excluyentes sólo si alguna dimensión
// está seteada distinta en ambas, o si ambas restringen por empleados
// específicos y esas listas no comparten a nadie. Cualquier otra
// combinación (una sin restricción en esa dimensión, o dimensiones que
// coinciden) se considera "podrían superponerse".
export function scopesCouldOverlap(a: ScopeShape, b: ScopeShape): boolean {
  const dimensions: Array<keyof Omit<ScopeShape, "employeeIds">> = ["companyId", "sectorId", "costCenterId", "positionId"];
  for (const dimension of dimensions) {
    if (a[dimension] && b[dimension] && a[dimension] !== b[dimension]) return false;
  }
  if (a.employeeIds.length && b.employeeIds.length) {
    const employeesInB = new Set(b.employeeIds);
    if (!a.employeeIds.some((employeeId) => employeesInB.has(employeeId))) return false;
  }
  return true;
}
