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

// Mismo orden que devuelve el backend (priority desc, startTime asc) — se
// reordena también en el cliente por si la lista se construye a partir de
// varias respuestas (ej. tras crear/editar una regla sin recargar todo).
export function sortHourConceptRules(rules: HourConceptRule[]): HourConceptRule[] {
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0;
  });
}
