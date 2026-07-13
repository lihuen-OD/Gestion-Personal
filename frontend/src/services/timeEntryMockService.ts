import type { Employee, TimeEntry, TimeStatus, User } from "../types";
import { auditMockService } from "./auditMockService";
import { readStore, writeStore } from "./storage";

const countableStatuses = new Set<TimeStatus>(["Aprobado", "En revisión"]);
const exportableStatuses = new Set<TimeStatus>(["Aprobado"]);
const lockedStatuses = new Set<TimeStatus>(["Aprobado", "Cerrado", "Exportado"]);
const statusPriority: TimeStatus[] = ["Devuelto", "En revisión", "Rechazado", "Pendiente", "Borrador", "Aprobado", "Cerrado", "Exportado"];

function dateFromPeriodDay(period: string, day: number) {
  return `${period}-${String(day).padStart(2, "0")}`;
}

function currentMonthPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function enrichEntry(entry: Omit<TimeEntry, "id">, previous?: TimeEntry): Omit<TimeEntry, "id"> {
  return {
    ...entry,
    date: entry.date || dateFromPeriodDay(entry.period, entry.day),
    totalMinutes: entry.totalMinutes ?? Math.round((entry.hours || 0) * 60),
    origin: entry.origin || previous?.origin || "MANUAL",
    createdBy: previous?.createdBy || entry.createdBy,
    updatedBy: entry.updatedBy || previous?.updatedBy,
  };
}

function canReviewTimeEntries(user: User) {
  return user.role === "Nivel 1 - RRHH" || user.role.startsWith("Nivel 2");
}

function updateReviewStatus(id: string, status: TimeStatus, user: User, reason: string) {
  const all = readStore<TimeEntry>("timeEntries");
  const current = all.find((entry) => entry.id === id);
  if (!current || !canReviewTimeEntries(user) || current.status !== "En revisión") return undefined;
  const updated = { ...current, status, notes: reason ? `${current.notes ? `${current.notes} | ` : ""}${status === "Pendiente" ? "Devuelto" : status}: ${reason}` : current.notes };
  writeStore("timeEntries", all.map((entry) => entry.id === id ? updated : entry));
  auditMockService.create({
    user: user.name,
    role: user.role,
    action: status === "Aprobado" ? "Aprobó carga horaria" : status === "Rechazado" ? "Rechazó carga horaria" : "Devolvió carga horaria",
    entity: `Carga horaria ${current.period} día ${current.day} · ${current.type}`,
    previous: current.status,
    next: status,
    reason: reason || "Revisión de carga horaria",
  });
  return updated;
}

function employeeMatchesScope(employee: Employee, user: User) {
  if (user.role === "Nivel 1 - RRHH") return true;
  const companyMatch = !user.company || employee.company === user.company || employee.companies?.includes(user.company);
  const directManagerMatch = employee.directManager === user.name || employee.directManagers?.includes(user.name);
  const timeResponsibleMatch = employee.timeResponsible === user.name || employee.timeResponsibles?.includes(user.name);
  if (user.role.startsWith("Nivel 2")) {
    const sectorMatch = !user.sector || employee.sector === user.sector;
    return companyMatch && (directManagerMatch || timeResponsibleMatch || sectorMatch);
  }
  return companyMatch && timeResponsibleMatch;
}

function resolveEmployeePeriodStatus(entries: TimeEntry[]) {
  return statusPriority.find((status) => entries.some((entry) => entry.status === status)) || "Pendiente";
}

function summarizePeriodEntries(entries: TimeEntry[]) {
  const countable = entries.filter((entry) => countableStatuses.has(entry.status));
  const approved = entries.filter((entry) => entry.status === "Aprobado");
  const special = countable.filter((entry) => entry.isSpecial || entry.type !== "Hora normal");
  return {
    entries,
    countable,
    approved,
    total: countable.reduce((sum, entry) => sum + entry.hours, 0),
    normalHours: countable.filter((entry) => entry.type === "Hora normal").reduce((sum, entry) => sum + entry.hours, 0),
    specialHours: special.reduce((sum, entry) => sum + entry.hours, 0),
    approvedHours: approved.reduce((sum, entry) => sum + entry.hours, 0),
    reviewHours: entries.filter((entry) => entry.status === "En revisión").reduce((sum, entry) => sum + entry.hours, 0),
    daysWithEntries: new Set(entries.map((entry) => entry.day)).size,
    status: resolveEmployeePeriodStatus(entries),
  };
}

export const timeEntryMockService = {
  getAll: () => readStore<TimeEntry>("timeEntries"),
  getKnownPeriods: () => Array.from(new Set(readStore<TimeEntry>("timeEntries").map((entry) => entry.period))).sort(),
  getDefaultPeriod: () => timeEntryMockService.getKnownPeriods().slice(-1)[0] || currentMonthPeriod(),
  getByPeriod: (period: string) => readStore<TimeEntry>("timeEntries").filter((entry) => entry.period === period),
  getByEmployee: (employeeId: string, period: string) => readStore<TimeEntry>("timeEntries").filter((t) => t.employeeId === employeeId && t.period === period),
  getEmployeesFor: (user: User) => {
    const all = readStore<Employee>("employees");
    return all.filter((employee) => employeeMatchesScope(employee, user));
  },
  canEdit: (entry?: TimeEntry) => !entry || !lockedStatuses.has(entry.status),
  isCountableStatus: (status: TimeStatus) => countableStatuses.has(status),
  isExportableStatus: (status: TimeStatus) => exportableStatuses.has(status),
  getEmployeePeriodSummary: (employeeId: string, period: string) => summarizePeriodEntries(timeEntryMockService.getByEmployee(employeeId, period)),
  getPeriodExportRows: (period: string, employees: Employee[]) => {
    return employees.map((employee) => {
      const summary = timeEntryMockService.getEmployeePeriodSummary(employee.id, period);
      return {
        employee,
        legajo: employee.legajoInterno || employee.legajoFinnegans || employee.legajo || "Sin cargar",
        cuil: employee.cuil,
        apellido: employee.lastName,
        nombre: employee.firstName,
        empresa: employee.company,
        centroCosto: employee.costCenter,
        horasNormales: summary.approved.filter((entry) => entry.type === "Hora normal").reduce((sum, entry) => sum + entry.hours, 0),
        horasEspeciales: summary.approved.filter((entry) => entry.type !== "Hora normal").reduce((sum, entry) => sum + entry.hours, 0),
        horasTotales: summary.approved.reduce((sum, entry) => sum + entry.hours, 0),
        estado: summary.status,
      };
    }).filter((row) => row.horasTotales > 0);
  },
  save: (entry: Omit<TimeEntry, "id">, user?: User) => {
    const all = readStore<TimeEntry>("timeEntries");
    const previous = all.find((t) => t.employeeId === entry.employeeId && t.period === entry.period && t.day === entry.day && t.type === entry.type);
    if (previous && !timeEntryMockService.canEdit(previous)) return undefined;
    const value = {
      ...enrichEntry({
        ...entry,
        createdBy: previous?.createdBy || entry.createdBy || user?.name,
        updatedBy: user?.name || entry.updatedBy || previous?.updatedBy,
      }, previous),
      id: previous?.id ?? crypto.randomUUID(),
    };
    writeStore("timeEntries", [...all.filter((t) => t.id !== previous?.id), value]);
    if (user) {
      auditMockService.create({
        user: user.name,
        role: user.role,
        action: previous ? "Actualizó carga horaria" : "Creó carga horaria",
        entity: `Carga horaria ${value.period} día ${value.day} · ${value.type}`,
        previous: previous ? `${previous.hours} h · ${previous.status}` : "-",
        next: `${value.hours} h · ${value.status}`,
        reason: previous ? "Actualización de carga horaria" : "Nueva carga horaria",
      });
    }
    return value;
  },
  remove: (id: string) => {
    writeStore("timeEntries", readStore<TimeEntry>("timeEntries").filter((t) => t.id !== id));
  },
  updateEmployeeStatus: (employeeId: string, period: string, status: TimeStatus) => {
    const all = readStore<TimeEntry>("timeEntries");
    writeStore("timeEntries", all.map((t) => t.employeeId === employeeId && t.period === period ? { ...t, status } : t));
  },
  canReview: canReviewTimeEntries,
  approve: (id: string, user: User) => updateReviewStatus(id, "Aprobado", user, "Aprobación de carga horaria"),
  reject: (id: string, user: User, reason: string) => updateReviewStatus(id, "Rechazado", user, reason),
  returnForCorrection: (id: string, user: User, reason: string) => updateReviewStatus(id, "Pendiente", user, reason),
};
