import type { EmployeeTimeGridRow } from "../services/api/employeeApiService";
import type { TimeEntry } from "../types";
import { timeEntryApiService } from "../services/api/timeEntryApiService";

export const hourConceptLoadModeLabel = (mode: EmployeeTimeGridRow["concept"]["loadMode"]) =>
  mode === "MANUAL" ? "Manual" : mode === "AUTOMATIC" ? "Automático" : mode === "BOTH" ? "Manual y automático" : "Base del sistema";

export const additionalBreakdownHours = (rows: EmployeeTimeGridRow[]) =>
  rows.filter((row) => row.role === "ADDITIONAL").reduce((sum, row) => sum + row.totalMinutes, 0) / 60;

export const normalWorkedDays = (rows: EmployeeTimeGridRow[]) =>
  Object.values(rows.find((row) => row.role === "NORMAL_BASE")?.minutesByDay ?? {}).filter((minutes) => minutes > 0).length;

export const isManualBreakdownEditable = (row: EmployeeTimeGridRow) =>
  row.role === "ADDITIONAL" && (row.concept.loadMode === "MANUAL" || row.concept.loadMode === "BOTH");

// Etapa 6L.4: actualización local de la grilla tras guardar, sin esperar un
// refetch completo. `entries`/`rows` llegan del backend con el mismo criterio
// que buildAdditiveTimeGrid (backend): sólo Aprobado/En revisión cuentan para
// el total — timeEntryApiService.isCountableStatus ya encapsula ese criterio,
// se reusa acá para no duplicarlo.
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

export const totalWorkedMinutesFromRows = (rows: EmployeeTimeGridRow[]) =>
  rows.find((row) => row.role === "NORMAL_BASE")?.totalMinutes ?? 0;
