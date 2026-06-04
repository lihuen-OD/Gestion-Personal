import type { EmployeeFieldHistoryRecord, FieldHistorySection, User } from "../types";
import { auditMockService } from "./auditMockService";
import { readStore, writeStore } from "./storage";

type CreateFieldHistory = Omit<EmployeeFieldHistoryRecord, "id" | "createdAt" | "createdByUserId" | "createdByUserName">;

export const employeeFieldHistoryMockService = {
  getByEmployee: (employeeId: string) => readStore<EmployeeFieldHistoryRecord>("fieldHistory").filter((record) => record.employeeId === employeeId),
  getByField: (employeeId: string, section: FieldHistorySection, field: string) => readStore<EmployeeFieldHistoryRecord>("fieldHistory").filter((record) => record.employeeId === employeeId && record.section === section && record.field === field),
  getCurrentEffectiveFrom: (employeeId: string, section: FieldHistorySection, field: string) => {
    const rows = employeeFieldHistoryMockService.getByField(employeeId, section, field).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    return rows[0]?.effectiveFrom;
  },
  create: (record: CreateFieldHistory, user: User, auditEntity?: string) => {
    const value: EmployeeFieldHistoryRecord = { ...record, id: crypto.randomUUID(), createdAt: new Date().toISOString(), createdByUserId: user.id, createdByUserName: user.name };
    writeStore("fieldHistory", [value, ...readStore<EmployeeFieldHistoryRecord>("fieldHistory")]);
    auditMockService.create({
      user: user.name,
      role: user.role,
      action: "Registrar modificacion con historial",
      entity: auditEntity || `Legajo ${record.employeeId}`,
      field: record.fieldLabel,
      previous: record.oldValue || "-",
      next: `${record.newValue} | Desde: ${record.effectiveFrom}`,
      reason: record.reason,
    });
    return value;
  },
  createMany: (records: CreateFieldHistory[], user: User, auditEntity?: string) => records.map((record) => employeeFieldHistoryMockService.create(record, user, auditEntity)),
};
