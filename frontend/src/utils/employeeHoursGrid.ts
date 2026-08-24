import type { EmployeeTimeGridRow } from "../services/api/employeeApiService";

export const hourConceptLoadModeLabel = (mode: EmployeeTimeGridRow["concept"]["loadMode"]) =>
  mode === "MANUAL" ? "Manual" : mode === "AUTOMATIC" ? "Automático" : mode === "BOTH" ? "Manual y automático" : "Base del sistema";

export const additionalBreakdownHours = (rows: EmployeeTimeGridRow[]) =>
  rows.filter((row) => row.role === "ADDITIONAL").reduce((sum, row) => sum + row.totalMinutes, 0) / 60;

export const normalWorkedDays = (rows: EmployeeTimeGridRow[]) =>
  Object.values(rows.find((row) => row.role === "NORMAL_BASE")?.minutesByDay ?? {}).filter((minutes) => minutes > 0).length;
