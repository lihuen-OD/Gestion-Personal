import type { Employee, User } from "../types";
import type { Position, PositionFilters, PositionHistoryRecord, PositionStatus, PositionSummary } from "../types/position.types";
import { auditMockService } from "./auditMockService";
import { calculateEmployeeStatus } from "./employeeStatusService";
import { employeeMockService } from "./employeeMockService";
import { readStore, writeStore } from "./storage";

const normalize = (value: unknown) => String(value || "").trim().toLowerCase();
const todayIso = () => new Date().toISOString();

function nextPositionCode(positions: Position[]) {
  const numbers = positions.map((position) => {
    const match = String(position.code || "").match(/(\d+)$/);
    return match ? Number(match[1]) : 0;
  });
  return `PUE-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

function history(positionId: string, user: User | undefined, action: string, description: string, oldValue?: string, newValue?: string): PositionHistoryRecord {
  return { id: crypto.randomUUID(), positionId, action, description, oldValue, newValue, createdAt: todayIso(), createdByUserId: user?.id || "system", createdByUserName: user?.name || "Sistema" };
}

function employeePositionText(employee: Employee) {
  return normalize(employee.puestoNombre || employee.position || (employee as unknown as Record<string, string>).puesto);
}

function matchesPosition(employee: Employee, position: Position) {
  const record = employee as unknown as Record<string, string>;
  return employee.positionId === position.id
    || record.puestoId === position.id
    || employeePositionText(employee) === normalize(position.name);
}

function assignedEmployees(position: Position) {
  return employeeMockService.getAll().filter((employee) => calculateEmployeeStatus(employee) === "Activo" && matchesPosition(employee, position));
}

function matchesFilters(position: Position, filters: PositionFilters) {
  const query = normalize(filters.search);
  const text = normalize(`${position.code} ${position.name} ${position.businessUnitName} ${position.establishmentName} ${position.areaDepartment} ${position.sector} ${(position.salaryRangeCategories || []).join(" ")}`);
  return (!query || text.includes(query))
    && (!filters.businessUnitName || position.businessUnitName === filters.businessUnitName)
    && (!filters.establishmentName || position.establishmentName === filters.establishmentName)
    && (!filters.areaDepartment || position.areaDepartment === filters.areaDepartment)
    && (!filters.sector || position.sector === filters.sector)
    && (!filters.salaryRangeCategory || position.salaryRangeCategories?.includes(filters.salaryRangeCategory))
    && (!filters.status || position.status === filters.status);
}

export const positionMockService = {
  getEmptyFilters: (): PositionFilters => ({ search: "", businessUnitName: "", establishmentName: "", areaDepartment: "", sector: "", salaryRangeCategory: "", status: "" }),
  getNextCode: () => nextPositionCode(readStore<Position>("positions")),
  getAll: () => readStore<Position>("positions"),
  getById: (id: string) => readStore<Position>("positions").find((position) => position.id === id),
  getFiltered: (filters: PositionFilters) => readStore<Position>("positions").filter((position) => matchesFilters(position, filters)),
  getAssignedEmployees: (positionId: string) => {
    const position = positionMockService.getById(positionId);
    return position ? assignedEmployees(position) : [];
  },
  getSummary: (): PositionSummary => {
    const positions = readStore<Position>("positions");
    const assigned = new Map(positions.map((position) => [position.id, assignedEmployees(position).length]));
    const outdatedLimit = new Date();
    outdatedLimit.setMonth(outdatedLimit.getMonth() - 12);
    return {
      total: positions.length,
      active: positions.filter((position) => position.status === "ACTIVO").length,
      inactive: positions.filter((position) => position.status === "INACTIVO").length,
      withoutPeople: positions.filter((position) => (assigned.get(position.id) || 0) === 0).length,
      pendingUpdate: positions.filter((position) => new Date(`${position.lastUpdatedAt}T00:00:00`) < outdatedLimit).length,
      linkedToEmployees: positions.filter((position) => (assigned.get(position.id) || 0) > 0).length,
    };
  },
  getFilterOptions: () => {
    const positions = readStore<Position>("positions");
    const unique = (items: (string | undefined)[]) => Array.from(new Set(items.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "es"));
    return {
      businessUnitName: unique(positions.map((position) => position.businessUnitName)),
      establishmentName: unique(positions.map((position) => position.establishmentName)),
      areaDepartment: unique(positions.map((position) => position.areaDepartment)),
      sector: unique(positions.map((position) => position.sector)),
      salaryRangeCategory: unique(positions.flatMap((position) => position.salaryRangeCategories || [])),
    };
  },
  create: (data: Omit<Position, "id" | "createdAt" | "updatedAt" | "history"> & { id?: string }, user: User) => {
    const current = readStore<Position>("positions");
    const positionId = data.id || crypto.randomUUID();
    const code = data.code?.trim() || nextPositionCode(current);
    const entry = history(positionId, user, "Alta de puesto", `Se creo el puesto ${data.name}.`);
    const position: Position = { ...data, code, id: positionId, history: [entry], createdAt: todayIso(), updatedAt: todayIso(), createdBy: user.name, updatedBy: user.name };
    writeStore("positions", [position, ...current]);
    writeStore("positionHistory", [entry, ...readStore<PositionHistoryRecord>("positionHistory")]);
    auditMockService.create({ user: user.name, role: user.role, action: "Crear puesto", entity: `Puesto ${position.name}`, previous: "-", next: position.status, reason: "Alta de puesto mock" });
    return position;
  },
  update: (id: string, data: Position, user: User, action = "Edicion de puesto", description = "Se actualizaron datos del puesto.") => {
    const all = readStore<Position>("positions");
    const previous = all.find((position) => position.id === id);
    const entry = history(id, user, action, description, previous ? previous.updatedAt : undefined, todayIso());
    const next = { ...data, id, code: data.code?.trim() || nextPositionCode(all.filter((position) => position.id !== id)), updatedAt: todayIso(), updatedBy: user.name, history: [entry, ...(data.history || [])] };
    writeStore("positions", all.map((position) => position.id === id ? next : position));
    writeStore("positionHistory", [entry, ...readStore<PositionHistoryRecord>("positionHistory")]);
    auditMockService.create({ user: user.name, role: user.role, action, entity: `Puesto ${next.name}`, previous: entry.oldValue || "-", next: entry.newValue || "-", reason: description });
    return next;
  },
  changeStatus: (id: string, status: PositionStatus, user: User) => {
    const position = positionMockService.getById(id);
    if (!position) return undefined;
    return positionMockService.update(id, { ...position, status }, user, "Cambio de estado", `El puesto paso a estado ${status}.`);
  },
  removeOrHide: (id: string, user: User) => {
    const position = positionMockService.getById(id);
    if (!position) return undefined;
    if (assignedEmployees(position).length) return positionMockService.update(id, { ...position, status: "INACTIVO" }, user, "Puesto ocultado", "El puesto tiene personas asignadas, por eso se inactivo para conservar la trazabilidad.");
    const entry = history(id, user, "Puesto eliminado", `Se elimino el puesto ${position.name} porque no tenia personas asignadas.`);
    writeStore("positions", readStore<Position>("positions").filter((item) => item.id !== id));
    writeStore("positionHistory", [entry, ...readStore<PositionHistoryRecord>("positionHistory")]);
    auditMockService.create({ user: user.name, role: user.role, action: "Eliminar puesto", entity: `Puesto ${position.name}`, previous: position.status, next: "Eliminado", reason: "Puesto sin personas asignadas" });
    return undefined;
  },
  softDelete: (id: string, user: User) => positionMockService.removeOrHide(id, user),
  resetDemoData: () => {
    localStorage.removeItem("losod_demo_positions");
    localStorage.removeItem("losod_demo_positionHistory");
  },
};
