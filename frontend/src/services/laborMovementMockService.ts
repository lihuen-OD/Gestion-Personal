import type { Employee, LaborMovement, LaborMovementType, User } from "../types";
import { auditMockService } from "./auditMockService";
import { calculateLaborStatus } from "./employeeStatusService";
import { readStore, writeStore } from "./storage";

export const laborMovementMockService = {
  addMovement: (employeeId: string, data: { type: LaborMovementType; effectiveFrom: string; reason: string; observation?: string }, user: User) => {
    const employees = readStore<Employee>("employees");
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) throw new Error("Empleado no encontrado");
    const movement: LaborMovement = { id: crypto.randomUUID(), ...data, createdAt: new Date().toISOString(), createdByUserId: user.id, createdByUserName: user.name };
    const laborMovements = [...(employee.laborMovements || []), movement].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const nextStatus = calculateLaborStatus(laborMovements);
    const updated: Employee = {
      ...employee,
      laborMovements,
      startDate: laborMovements.find((item) => item.type === "ALTA")?.effectiveFrom || employee.startDate,
      endDate: laborMovements.filter((item) => item.type === "BAJA").slice(-1)[0]?.effectiveFrom || "",
      exitReason: laborMovements.filter((item) => item.type === "BAJA").slice(-1)[0]?.reason || "",
      status: nextStatus.status,
      historyEvents: [{ id: crypto.randomUUID(), date: new Date().toLocaleDateString("es-AR"), type: data.type === "ALTA" ? "Alta laboral" : "Baja laboral", description: `${data.type} desde ${data.effectiveFrom}. Motivo: ${data.reason}`, user: user.name }, ...(employee.historyEvents || [])],
    };
    writeStore("employees", employees.map((item) => item.id === employeeId ? updated : item));
    auditMockService.create({
      user: user.name,
      role: user.role,
      action: "Registrar movimiento laboral",
      entity: `Legajo ${updated.legajoInterno || updated.legajo}`,
      field: "Alta / Baja laboral",
      previous: "-",
      next: `${movement.type} desde ${movement.effectiveFrom}. Estado resultante: ${nextStatus.status}`,
      reason: `${movement.reason}${movement.observation ? ` | ${movement.observation}` : ""}`,
    });
    return updated;
  },
};
