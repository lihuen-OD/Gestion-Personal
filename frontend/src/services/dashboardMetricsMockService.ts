import type { DocumentMock, Employee, Novelty, TimeEntry } from "../types";
import { calculateEmployeeStatus } from "./employeeStatusService";
import { readStore } from "./storage";

const referenceDate = new Date("2026-06-02T12:00:00");
const dayMs = 86_400_000;
const absenceTypes = new Set(["Enfermedad", "ART", "Falta injustificada", "Licencia", "Certificado médico"]);

function yearsBetween(from: string, to = referenceDate) {
  return (to.getTime() - new Date(`${from}T12:00:00`).getTime()) / (365.25 * dayMs);
}
function groupCount(values: string[]) {
  return Object.entries(values.reduce<Record<string, number>>((result, value) => ({ ...result, [value]: (result[value] || 0) + 1 }), {}))
    .map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}
function dayCount(from: string, to: string) {
  return Math.max(1, Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / dayMs) + 1);
}

export const dashboardMetricsMockService = {
  getMetrics: (scope?: (employee: Employee) => boolean) => {
    const employees = readStore<Employee>("employees").filter(scope || (() => true));
    const active = employees.filter((employee) => calculateEmployeeStatus(employee) === "Activo");
    const employeeIds = new Set(employees.map((employee) => employee.id));
    const entries = readStore<TimeEntry>("timeEntries").filter((entry) => employeeIds.has(entry.employeeId) && entry.period === "2026-06");
    const novelties = readStore<Novelty>("novelties").filter((novelty) => employeeIds.has(novelty.employeeId));
    const documents = readStore<DocumentMock>("documents").filter((document) => employeeIds.has(document.employeeId));
    const absenceDays = novelties.filter((novelty) => absenceTypes.has(novelty.type) && novelty.from.startsWith("2026-06")).reduce((total, novelty) => total + dayCount(novelty.from, novelty.to), 0);
    const upcomingBirthdays = active.filter((employee) => {
      const birthDate = new Date(`${employee.birthDate}T12:00:00`);
      let next = new Date(referenceDate.getFullYear(), birthDate.getMonth(), birthDate.getDate(), 12);
      if (next < referenceDate) next = new Date(referenceDate.getFullYear() + 1, birthDate.getMonth(), birthDate.getDate(), 12);
      return (next.getTime() - referenceDate.getTime()) / dayMs <= 30;
    }).sort((a, b) => a.birthDate.slice(5).localeCompare(b.birthDate.slice(5)));
    const transported = active.filter((employee) => employee.transport);
    const withEntries = new Set(entries.map((entry) => entry.employeeId));
    const inactiveThisYear = employees.filter((employee) => employee.endDate?.startsWith("2026"));
    return {
      total: employees.length, active: active.length, inactive: employees.length - active.length,
      absenceDays, absenceRate: active.length ? (absenceDays / (active.length * 21) * 100).toFixed(1) : "0.0",
      turnoverRate: employees.length ? (inactiveThisYear.length / ((active.length + employees.length) / 2) * 100).toFixed(1) : "0.0",
      exits: inactiveThisYear.length, upcomingBirthdays,
      averageAge: active.length ? (active.reduce((total, employee) => total + yearsBetween(employee.birthDate), 0) / active.length).toFixed(1) : "0.0",
      averageTenure: active.length ? (active.reduce((total, employee) => total + yearsBetween(employee.startDate), 0) / active.length).toFixed(1) : "0.0",
      transported: transported.length, transportByCity: groupCount(transported.map((employee) => employee.city)),
      transportRoutes: groupCount(transported.map((employee) => employee.transportRoute)),
      loadedHours: entries.reduce((total, entry) => total + entry.hours, 0),
      loadCoverage: active.length ? Math.round(withEntries.size / active.length * 100) : 0,
      pendingLoads: active.filter((employee) => !withEntries.has(employee.id)).length,
      reviewLoads: new Set(entries.filter((entry) => entry.status === "En revisión").map((entry) => entry.employeeId)).size,
      expiredDocuments: documents.filter((document) => document.status === "Vencido").length,
      expiringDocuments: documents.filter((document) => document.status === "Por vencer").length,
      missingResponsible: active.filter((employee) => !employee.timeResponsible).length,
      pendingNovelties: novelties.filter((novelty) => novelty.status === "Pendiente").length,
      headcountByCompany: groupCount(active.map((employee) => employee.company)),
      headcountBySector: groupCount(active.map((employee) => employee.sector)),
    };
  },
};
