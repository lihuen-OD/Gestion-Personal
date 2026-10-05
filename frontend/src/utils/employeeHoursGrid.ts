import type { EmployeeTimeGridRow } from "../services/api/employeeApiService";
import type { TimeEntry } from "../types";
import { timeEntryApiService } from "../services/api/timeEntryApiService";

export const hourConceptLoadModeLabel = (mode: EmployeeTimeGridRow["concept"]["loadMode"]) =>
  mode === "MANUAL" ? "Manual" : mode === "AUTOMATIC" ? "Automático" : mode === "BOTH" ? "Manual y automático" : "Base del sistema";

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: la grilla agrupa filas por
// tratamiento (lo decide el backend vía concept.workTreatment). Agrupar es
// presentación; ningún total se deriva de sumar filas en el frontend.
export function groupTimeGridRows(rows: EmployeeTimeGridRow[]) {
  return {
    base: rows.find((row) => row.role === "NORMAL_BASE"),
    withinBase: rows.filter((row) => row.role === "ADDITIONAL" && row.concept.workTreatment === "WITHIN_BASE"),
    additive: rows.filter((row) => row.role === "ADDITIONAL" && row.concept.workTreatment !== "WITHIN_BASE"),
  };
}

export const timeGridRowLabel = (row: EmployeeTimeGridRow) => (row.role === "NORMAL_BASE" ? "Horas base" : row.concept.name);

export function timeGridRowSubtitle(row: EmployeeTimeGridRow) {
  if (row.role === "NORMAL_BASE") return "Registradas · fichada o carga";
  const effect = row.concept.workTreatment === "WITHIN_BASE" ? "No suma al total" : "Suma al total";
  return [effect, hourConceptLoadModeLabel(row.concept.loadMode), row.enabled ? null : "No habilitado"].filter(Boolean).join(" · ");
}

export const normalWorkedDays = (rows: EmployeeTimeGridRow[]) =>
  Object.values(rows.find((row) => row.role === "NORMAL_BASE")?.minutesByDay ?? {}).filter((minutes) => minutes > 0).length;

export const isManualBreakdownEditable = (row: EmployeeTimeGridRow) =>
  row.role === "ADDITIONAL" && row.enabled && (row.concept.loadMode === "MANUAL" || row.concept.loadMode === "BOTH");

// Etapa 6L.4: actualización local de la CELDA editada tras guardar, sin
// esperar el refetch. Sólo toca la fila cargada (mismo criterio de estados que
// buildEmployeeTimeGrid en backend, vía timeEntryApiService.isCountableStatus);
// Horas normales, total trabajado y equivalencia NO se recalculan acá — se
// muestran como "actualizando" hasta que llega la contabilidad del backend.
export function upsertTimeEntry(entries: TimeEntry[], entry: TimeEntry): TimeEntry[] {
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index === -1) return [...entries, entry];
  const next = [...entries];
  next[index] = entry;
  return next;
}

export function applyNormalEntryToRows(rows: EmployeeTimeGridRow[], entry: TimeEntry): EmployeeTimeGridRow[] {
  return rows.map((row) => {
    if (row.role !== "NORMAL_BASE") return row;
    const minutesByDay = { ...row.minutesByDay };
    const key = String(entry.day);
    if (timeEntryApiService.isCountableStatus(entry.status)) {
      minutesByDay[key] = Math.round(entry.hours * 60);
    } else {
      delete minutesByDay[key];
    }
    const totalMinutes = Object.values(minutesByDay).reduce((sum, minutes) => sum + minutes, 0);
    return { ...row, minutesByDay, totalMinutes };
  });
}

export function applyBreakdownToRows(rows: EmployeeTimeGridRow[], hourConceptId: string, day: number, minutes: number): EmployeeTimeGridRow[] {
  return rows.map((row) => {
    if (row.role !== "ADDITIONAL" || row.concept.id !== hourConceptId) return row;
    const minutesByDay = { ...row.minutesByDay };
    const key = String(day);
    if (minutes > 0) {
      minutesByDay[key] = minutes;
    } else {
      delete minutesByDay[key];
    }
    const totalMinutes = Object.values(minutesByDay).reduce((sum, value) => sum + value, 0);
    return { ...row, minutesByDay, totalMinutes };
  });
}
