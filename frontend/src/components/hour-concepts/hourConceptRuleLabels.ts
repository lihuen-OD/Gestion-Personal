import type { HourConceptRule, HourConceptRuleStatus } from "../../types/hourConceptRule.types";

export function hourConceptRuleStatusLabel(status: HourConceptRuleStatus) {
  return status === "ACTIVO" ? "Activo" : "Inactivo";
}

export function hourConceptRuleStatusTone(status: HourConceptRuleStatus): "success" | "neutral" {
  return status === "ACTIVO" ? "success" : "neutral";
}

export function crossesMidnightLabel(crossesMidnight: boolean) {
  return crossesMidnight ? "Sí" : "No";
}

export function sortHourConceptRules(rules: HourConceptRule[]): HourConceptRule[] {
  return [...rules].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
}
