import type { AuditEntry } from "../types";
import { readStore, writeStore } from "./storage";
import { formatInstantDate, formatInstantTime } from "../utils/date";

export const auditMockService = {
  getAll: () => readStore<AuditEntry>("audit"),
  create: (entry: Omit<AuditEntry, "id" | "date" | "time">) => {
    const now = new Date();
    const value: AuditEntry = { ...entry, id: crypto.randomUUID(), date: formatInstantDate(now), time: formatInstantTime(now) };
    writeStore("audit", [value, ...readStore<AuditEntry>("audit")]);
    return value;
  },
};
