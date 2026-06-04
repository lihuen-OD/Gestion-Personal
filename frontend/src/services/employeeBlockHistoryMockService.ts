import type { EmployeeBlockHistoryRecord, FieldHistorySection, User } from "../types";
import { auditMockService } from "./auditMockService";
import { readStore, writeStore } from "./storage";

type CreateBlockHistory = Omit<EmployeeBlockHistoryRecord, "id" | "createdAt" | "createdByUserId" | "createdByUserName">;

export const employeeBlockHistoryMockService = {
  getByEmployee: (employeeId: string) => readStore<EmployeeBlockHistoryRecord>("blockHistory").filter((record) => record.employeeId === employeeId),
  getByBlock: (employeeId: string, section: FieldHistorySection, block: string) => readStore<EmployeeBlockHistoryRecord>("blockHistory").filter((record) => record.employeeId === employeeId && record.section === section && record.block === block),
  create: (record: CreateBlockHistory, user: User, auditEntity?: string) => {
    const value: EmployeeBlockHistoryRecord = { ...record, id: crypto.randomUUID(), createdAt: new Date().toISOString(), createdByUserId: user.id, createdByUserName: user.name };
    writeStore("blockHistory", [value, ...readStore<EmployeeBlockHistoryRecord>("blockHistory")]);
    auditMockService.create({
      user: user.name,
      role: user.role,
      action: `Modificar ${record.blockLabel}`,
      entity: auditEntity || `Legajo ${record.employeeId}`,
      field: record.blockLabel,
      previous: record.oldValue || "-",
      next: `${record.newValue} | Desde: ${record.effectiveFrom}`,
      reason: record.reason,
    });
    return value;
  },
};
