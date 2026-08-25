import { scheduledInstantForShiftTime } from "../../shared/datetime/argentinaTime";

/**
 * Clasificación automática multi-concepto de una jornada real (etapa de
 * Turnos V1). Ningún nombre de concepto está hardcodeado acá: los rangos
 * horarios vienen 100% de HourConceptRule, cargada por RRHH.
 *
 * Genera exclusivamente evidencia técnica sobre TimeSegment (con fines de
 * trazabilidad/alertas para RRHH) — nunca decide Hora normal ni
 * totalWorkedMinutes, que desde la Etapa 6L siempre salen de TimeEntry con
 * el concepto Normal canónico. `priority` (ver pickWinner) es un residuo del
 * modelo exclusivo anterior a los Conceptos Horarios aditivos: quedó
 * congelado en 0 para toda regla nueva (Etapa 6E) y ya no lo carga RRHH.
 *
 * Regla de oro: nunca se pierden, inventan ni duplican minutos. Toda función
 * de este archivo es pura (sin acceso a datos) — quien la llama resuelve
 * antes qué reglas están activas y qué conceptos tiene habilitados el
 * empleado.
 */

export interface HourConceptRuleRef {
  id: string;
  hourConceptId: string;
  hourConceptName: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  priority: number;
}

export type SegmentConceptStatus = "SUGERIDO" | "MANUAL" | "SIN_CONCEPTO_COMPATIBLE" | "CONCEPTO_NO_HABILITADO";

export interface ClassifiedInterval {
  startAt: Date;
  endAt: Date;
  minutes: number;
  hourConceptId: string;
  hourConceptName: string;
  hourConceptRuleId: string | null;
  conceptStatus: SegmentConceptStatus;
}

interface RuleOccurrence {
  rule: HourConceptRuleRef;
  startAt: Date;
  endAt: Date;
}

const DAY_MS = 24 * 60 * 60_000;

// Genera, para una regla que recurre a diario por horario (HH:MM,
// eventualmente cruzando medianoche), sus ocurrencias como instantes reales
// que se solapan con [rangeStart, rangeEnd). Prueba anclar en el día de
// rangeStart y en los 3 días siguientes/anteriores (mismo margen que usa
// closestOccurrence en workShiftEvaluation.service.ts) para no perder
// ocurrencias que arrancan el día previo o se extienden al día posterior.
// Reutiliza scheduledInstantForShiftTime (argentinaTime.ts) — nunca
// reimplementa el corrimiento de huso horario.
function ruleOccurrencesOverlapping(rule: HourConceptRuleRef, rangeStart: Date, rangeEnd: Date): RuleOccurrence[] {
  const occurrences: RuleOccurrence[] = [];
  for (const offsetDays of [-1, 0, 1, 2]) {
    const reference = new Date(rangeStart.getTime() + offsetDays * DAY_MS);
    const occStart = scheduledInstantForShiftTime(reference, rule.startTime, false);
    const occEnd = scheduledInstantForShiftTime(reference, rule.endTime, rule.crossesMidnight);
    if (occStart.getTime() < rangeEnd.getTime() && occEnd.getTime() > rangeStart.getTime()) {
      occurrences.push({ rule, startAt: occStart, endAt: occEnd });
    }
  }
  return occurrences;
}

// Desambigua solapamientos: gana la de mayor priority; empatada, gana el
// startTime más temprano; todavía empatada, gana el id (orden estable,
// arbitrario pero 100% determinístico — nunca dos corridas con los mismos
// datos de entrada eligen ganadores distintos).
// Nota (Etapa 6R): priority es legacy congelado en 0 para toda regla nueva
// (hourConceptRules.repository.ts), así que hoy esta rama es siempre un
// empate y el desempate real ocurre por startTime/id. Se conserva la
// comparación (en vez de eliminarla) porque reglas creadas antes de esa
// restricción podrían tener priority != 0 en la base, y este resultado solo
// afecta metadata de TimeSegment (evidencia), nunca totalWorkedMinutes.
function pickWinner(rules: HourConceptRuleRef[]): HourConceptRuleRef | null {
  if (rules.length === 0) return null;
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0]!;
}

/**
 * Partición pura de UN rango real [startAt, endAt) por HourConceptRule
 * activas. No sabe nada de días calendario ni de WorkShift — solo resuelve,
 * para cada instante del rango, qué regla (si alguna) aplica, y fusiona los
 * tramos contiguos que resuelven a la misma regla (o a ninguna).
 *
 * - Regla matchea y el concepto está habilitado para el empleado -> SUGERIDO.
 * - Regla matchea pero el concepto NO está habilitado -> CONCEPTO_NO_HABILITADO
 *   (se conserva el concepto detectado, no se lo reemplaza por el default,
 *   para que RRHH vea exactamente qué detectó el sistema).
 * - Ninguna regla matchea el tramo -> SIN_CONCEPTO_COMPATIBLE, usando el
 *   concepto de fallback (nunca se deja un segmento sin hourConceptId: el
 *   campo es obligatorio en el schema).
 *
 * Invariante garantizada por construcción: la suma de `minutes` de todos los
 * intervalos devueltos es exactamente igual a los minutos reales entre
 * startAt y endAt — nunca se pierde, inventa ni duplica un minuto.
 */
export function classifyShiftInterval(input: {
  startAt: Date;
  endAt: Date;
  activeRules: HourConceptRuleRef[];
  enabledHourConceptIds: ReadonlySet<string>;
  fallbackHourConcept: { id: string; name: string };
}): ClassifiedInterval[] {
  const { startAt, endAt, activeRules, enabledHourConceptIds, fallbackHourConcept } = input;
  if (endAt.getTime() <= startAt.getTime()) return [];

  const occurrences = activeRules.flatMap((rule) => ruleOccurrencesOverlapping(rule, startAt, endAt));

  const boundaryTimes = new Set<number>([startAt.getTime(), endAt.getTime()]);
  for (const occ of occurrences) {
    if (occ.startAt.getTime() > startAt.getTime() && occ.startAt.getTime() < endAt.getTime()) boundaryTimes.add(occ.startAt.getTime());
    if (occ.endAt.getTime() > startAt.getTime() && occ.endAt.getTime() < endAt.getTime()) boundaryTimes.add(occ.endAt.getTime());
  }
  const boundaries = [...boundaryTimes].sort((a, b) => a - b);

  const rawSegments: Array<{ startAt: Date; endAt: Date; winner: HourConceptRuleRef | null }> = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const subStart = boundaries[i]!;
    const subEnd = boundaries[i + 1]!;
    if (subEnd <= subStart) continue;
    const midpoint = (subStart + subEnd) / 2;
    const covering = occurrences.filter((occ) => occ.startAt.getTime() <= midpoint && occ.endAt.getTime() >= midpoint).map((occ) => occ.rule);
    rawSegments.push({ startAt: new Date(subStart), endAt: new Date(subEnd), winner: pickWinner(covering) });
  }

  const merged: Array<{ startAt: Date; endAt: Date; winner: HourConceptRuleRef | null }> = [];
  for (const segment of rawSegments) {
    const last = merged[merged.length - 1];
    if (last && (last.winner?.id ?? null) === (segment.winner?.id ?? null) && last.endAt.getTime() === segment.startAt.getTime()) {
      last.endAt = segment.endAt;
    } else {
      merged.push({ ...segment });
    }
  }

  return merged
    .map((segment) => {
      const minutes = Math.round((segment.endAt.getTime() - segment.startAt.getTime()) / 60_000);
      if (!segment.winner) {
        return {
          startAt: segment.startAt,
          endAt: segment.endAt,
          minutes,
          hourConceptId: fallbackHourConcept.id,
          hourConceptName: fallbackHourConcept.name,
          hourConceptRuleId: null,
          conceptStatus: "SIN_CONCEPTO_COMPATIBLE" as const,
        };
      }
      const enabled = enabledHourConceptIds.has(segment.winner.hourConceptId);
      return {
        startAt: segment.startAt,
        endAt: segment.endAt,
        minutes,
        hourConceptId: segment.winner.hourConceptId,
        hourConceptName: segment.winner.hourConceptName,
        hourConceptRuleId: segment.winner.id,
        conceptStatus: enabled ? ("SUGERIDO" as const) : ("CONCEPTO_NO_HABILITADO" as const),
      };
    })
    .filter((segment) => segment.minutes > 0);
}

export interface DaySegmentInput {
  date: Date;
  startAt: Date;
  endAt: Date;
}

export interface ClassifiedDaySegment extends ClassifiedInterval {
  date: Date;
}

/**
 * Compatibilidad hacia atrás (etapa de Turnos V1, decisión explícita): si no
 * hay ninguna HourConceptRule activa cargada en todo el sistema, la
 * clasificación automática ni se intenta — se devuelve un único segmento
 * "MANUAL" por tramo de día, exactamente el comportamiento anterior a esta
 * etapa. La clasificación automática solo se activa cuando existe al menos
 * una regla activa en algún lado.
 *
 * Con clasificación activa: reutiliza la partición por día calendario
 * Argentina-aware que ya hace buildShiftSegments (recibida acá como
 * `daySegments`, sin duplicar esa lógica) y, dentro de cada tramo de día,
 * aplica classifyShiftInterval.
 */
export function classifyWorkShiftSegments(input: {
  daySegments: DaySegmentInput[];
  activeRules: HourConceptRuleRef[];
  enabledHourConceptIds: ReadonlySet<string>;
  fallbackHourConcept: { id: string; name: string };
}): ClassifiedDaySegment[] {
  if (input.activeRules.length === 0) {
    return input.daySegments.map((day) => ({
      date: day.date,
      startAt: day.startAt,
      endAt: day.endAt,
      minutes: Math.round((day.endAt.getTime() - day.startAt.getTime()) / 60_000),
      hourConceptId: input.fallbackHourConcept.id,
      hourConceptName: input.fallbackHourConcept.name,
      hourConceptRuleId: null,
      conceptStatus: "MANUAL",
    }));
  }

  return input.daySegments.flatMap((day) =>
    classifyShiftInterval({
      startAt: day.startAt,
      endAt: day.endAt,
      activeRules: input.activeRules,
      enabledHourConceptIds: input.enabledHourConceptIds,
      fallbackHourConcept: input.fallbackHourConcept,
    }).map((segment) => ({ ...segment, date: day.date })),
  );
}

// Utilidad de diagnóstico/tests: confirma que no se perdió ni inventó ningún
// minuto real entre startAt/endAt.
export function sumClassifiedMinutes(segments: Array<{ minutes: number }>): number {
  return segments.reduce((total, segment) => total + segment.minutes, 0);
}
