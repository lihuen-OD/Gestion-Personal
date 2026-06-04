import type { AuditEntry } from "../types";
import { readStore, writeStore } from "./storage";

export const auditMockService = {
  getAll: () => readStore<AuditEntry>("audit"),
  create: (entry: Omit<AuditEntry, "id" | "date" | "time">) => {
    const now = new Date();
    const value: AuditEntry = { ...entry, id: crypto.randomUUID(), date: now.toLocaleDateString("es-AR"), time: now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) };
    writeStore("audit", [value, ...readStore<AuditEntry>("audit")]);
    return value;
  },
};
