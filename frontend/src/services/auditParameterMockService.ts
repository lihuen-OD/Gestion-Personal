import type { User } from "../types";
import type { AuditParameter, AuditParameterFilters, AuditParameterHistoryRecord } from "../types/auditParameter.types";
import { readStore, writeStore } from "./storage";

const todayIso = () => new Date().toISOString();
const normalize = (value: string) => value.trim().toLowerCase();

function history(user: User | undefined, action: string, description: string): AuditParameterHistoryRecord {
  return { id: crypto.randomUUID(), action, description, createdAt: todayIso(), createdByUserId: user?.id || "system", createdByUserName: user?.name || "Sistema" };
}

function nextCode(items: AuditParameter[]) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `AUD-${String(max + 1).padStart(3, "0")}`;
}

function matchesFilters(item: AuditParameter, filters: AuditParameterFilters) {
  const search = normalize(filters.search);
  const text = normalize(`${item.code} ${item.name} ${item.description} ${item.scope} ${item.severity}`);
  if (search && !text.includes(search)) return false;
  if (filters.scope && item.scope !== filters.scope) return false;
  if (filters.severity && item.severity !== filters.severity) return false;
  if (filters.requiresReason && String(item.requiresReason) !== filters.requiresReason) return false;
  if (filters.status && item.status !== filters.status) return false;
  return true;
}

export const auditParameterMockService = {
  getAll: () => readStore<AuditParameter>("auditParameters"),
  getActive: () => readStore<AuditParameter>("auditParameters").filter((item) => item.status === "ACTIVO"),
  getById: (id: string) => readStore<AuditParameter>("auditParameters").find((item) => item.id === id),
  getEmptyFilters: (): AuditParameterFilters => ({ search: "", scope: "", severity: "", requiresReason: "", status: "ACTIVO" }),
  getFiltered: (filters: AuditParameterFilters) => readStore<AuditParameter>("auditParameters").filter((item) => matchesFilters(item, filters)),
  getFilterOptions: () => {
    const items = readStore<AuditParameter>("auditParameters");
    return {
      scopes: Array.from(new Set(items.map((item) => item.scope))).sort(),
      severities: Array.from(new Set(items.map((item) => item.severity))).sort(),
      statuses: ["ACTIVO", "INACTIVO"],
    };
  },
  getNextCode: () => nextCode(readStore<AuditParameter>("auditParameters")),
  create: (data: AuditParameter, user: User) => {
    const items = readStore<AuditParameter>("auditParameters");
    const id = data.id || crypto.randomUUID();
    const code = data.code || nextCode(items);
    const entry = history(user, "Alta de parametro", `Se creo el parametro de auditoria ${data.name}.`);
    const item: AuditParameter = { ...data, id, code, createdAt: todayIso(), updatedAt: todayIso(), createdBy: user.name, updatedBy: user.name, history: [entry] };
    writeStore("auditParameters", [item, ...items]);
    return item;
  },
  update: (id: string, data: AuditParameter, user: User, action = "Edicion de parametro", description = `Se actualizo el parametro de auditoria ${data.name}.`) => {
    const items = readStore<AuditParameter>("auditParameters");
    const current = items.find((item) => item.id === id);
    if (!current) return undefined;
    const updated: AuditParameter = { ...current, ...data, id, code: current.code, updatedAt: todayIso(), updatedBy: user.name, history: [history(user, action, description), ...(current.history || [])] };
    writeStore("auditParameters", items.map((item) => item.id === id ? updated : item));
    return updated;
  },
};
