import type { Employee, TimeEntry, TimeStatus } from "../types";
import { readStore, writeStore } from "./storage";

function dateFromPeriodDay(period: string, day: number) {
  return `${period}-${String(day).padStart(2, "0")}`;
}

function enrichEntry(entry: Omit<TimeEntry, "id">, previous?: TimeEntry): Omit<TimeEntry, "id"> {
  return {
    ...entry,
    date: entry.date || dateFromPeriodDay(entry.period, entry.day),
    totalMinutes: entry.totalMinutes ?? Math.round((entry.hours || 0) * 60),
    origin: entry.origin || previous?.origin || "MANUAL",
  };
}

export const timeEntryMockService = {
  getAll: () => readStore<TimeEntry>("timeEntries"),
  getByEmployee: (employeeId: string, period: string) => readStore<TimeEntry>("timeEntries").filter((t) => t.employeeId === employeeId && t.period === period),
  getEmployeesFor: (name: string, role: string) => {
    const all = readStore<Employee>("employees");
    return role === "Nivel 3 - Administrativo de Carga Horaria" ? all.filter((e) => e.timeResponsible === name || e.timeResponsibles?.includes(name)) : all;
  },
  save: (entry: Omit<TimeEntry, "id">) => {
    const all = readStore<TimeEntry>("timeEntries");
    const previous = all.find((t) => t.employeeId === entry.employeeId && t.period === entry.period && t.day === entry.day);
    const value = { ...enrichEntry(entry, previous), id: previous?.id ?? crypto.randomUUID() };
    writeStore("timeEntries", [...all.filter((t) => t.id !== previous?.id), value]);
    return value;
  },
  updateEmployeeStatus: (employeeId: string, period: string, status: TimeStatus) => {
    const all = readStore<TimeEntry>("timeEntries");
    writeStore("timeEntries", all.map((t) => t.employeeId === employeeId && t.period === period ? { ...t, status } : t));
  },
};
