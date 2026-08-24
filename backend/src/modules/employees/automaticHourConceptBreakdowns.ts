import { argentinaCalendarDate, argentinaDateParts, nextArgentinaMidnightUtc, scheduledInstantForShiftTime } from "../../shared/datetime/argentinaTime";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AutomaticBreakdownRule {
  id: string;
  hourConceptId: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
}

export interface WorkedShiftInterval {
  id: string;
  startAt: Date;
  endAt: Date;
}

export interface CalculatedAutomaticBreakdown {
  date: Date;
  period: string;
  day: number;
  hourConceptId: string;
  minutes: number;
  workShiftId: string;
  hourConceptRuleId: string | null;
}

export function argentinaPeriodBounds(period: string) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return {
    startAt: new Date(Date.UTC(year, month - 1, 1, 3)),
    endAt: new Date(Date.UTC(year, month, 1, 3)),
  };
}

type Interval = { startAt: Date; endAt: Date; ruleIds: Set<string> };

function mergeIntervals(intervals: Interval[]) {
  const sorted = [...intervals].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.startAt.getTime() > previous.endAt.getTime()) {
      merged.push({ ...interval, ruleIds: new Set(interval.ruleIds) });
      continue;
    }
    if (interval.endAt > previous.endAt) previous.endAt = interval.endAt;
    for (const id of interval.ruleIds) previous.ruleIds.add(id);
  }
  return merged;
}

export function calculateAutomaticBreakdowns(
  period: string,
  shifts: WorkedShiftInterval[],
  rules: AutomaticBreakdownRule[],
): CalculatedAutomaticBreakdown[] {
  const bounds = argentinaPeriodBounds(period);
  const byShiftAndConcept = new Map<string, Interval[]>();

  for (const shift of shifts) {
    const shiftStart = new Date(Math.max(shift.startAt.getTime(), bounds.startAt.getTime()));
    const shiftEnd = new Date(Math.min(shift.endAt.getTime(), bounds.endAt.getTime()));
    if (shiftStart >= shiftEnd) continue;

    for (const rule of rules) {
      const seen = new Set<number>();
      const approximateDays = Math.ceil((shiftEnd.getTime() - shiftStart.getTime()) / DAY_MS);
      for (let offset = -1; offset <= approximateDays + 1; offset += 1) {
        const reference = new Date(shiftStart.getTime() + offset * DAY_MS);
        const ruleStart = scheduledInstantForShiftTime(reference, rule.startTime);
        if (seen.has(ruleStart.getTime())) continue;
        seen.add(ruleStart.getTime());
        const ruleEnd = scheduledInstantForShiftTime(reference, rule.endTime, rule.crossesMidnight);
        const startAt = new Date(Math.max(shiftStart.getTime(), ruleStart.getTime()));
        const endAt = new Date(Math.min(shiftEnd.getTime(), ruleEnd.getTime()));
        if (startAt >= endAt) continue;
        const key = `${shift.id}:${rule.hourConceptId}`;
        const current = byShiftAndConcept.get(key) ?? [];
        current.push({ startAt, endAt, ruleIds: new Set([rule.id]) });
        byShiftAndConcept.set(key, current);
      }
    }
  }

  const result: CalculatedAutomaticBreakdown[] = [];
  for (const [key, intervals] of byShiftAndConcept) {
    const separator = key.indexOf(":");
    const workShiftId = key.slice(0, separator);
    const hourConceptId = key.slice(separator + 1);
    for (const interval of mergeIntervals(intervals)) {
      let cursor = interval.startAt;
      while (cursor < interval.endAt) {
        const endAt = new Date(Math.min(interval.endAt.getTime(), nextArgentinaMidnightUtc(cursor).getTime()));
        const parts = argentinaDateParts(cursor);
        const minutes = Math.round((endAt.getTime() - cursor.getTime()) / 60_000);
        if (minutes > 0) {
          result.push({
            date: argentinaCalendarDate(parts.key),
            period,
            day: parts.day,
            hourConceptId,
            minutes,
            workShiftId,
            hourConceptRuleId: interval.ruleIds.size === 1 ? ([...interval.ruleIds][0] ?? null) : null,
          });
        }
        cursor = endAt;
      }
    }
  }
  return result;
}
