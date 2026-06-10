import type { User } from "../types";
import type { FinnegansSettlementLink, SettlementConfig, SettlementConfigFilters, SettlementConfigHistoryRecord, SettlementValidationRule } from "../types/settlementConfig.types";
import { readStore, writeStore } from "./storage";

const todayIso = () => new Date().toISOString();
const normalize = (value: string) => value.trim().toLowerCase();

function history(user: User | undefined, action: string, description: string): SettlementConfigHistoryRecord {
  return { id: crypto.randomUUID(), action, description, createdAt: todayIso(), createdByUserId: user?.id || "system", createdByUserName: user?.name || "Sistema" };
}

function nextCode(items: SettlementConfig[]) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `LIQ-${String(max + 1).padStart(3, "0")}`;
}

function matchesFilters(item: SettlementConfig, filters: SettlementConfigFilters) {
  const search = normalize(filters.search);
  const text = normalize(`${item.code} ${item.name} ${item.description} ${item.kind} ${item.finnegansLinks.map((link) => `${link.code} ${link.name} ${link.exportCode}`).join(" ")}`);
  if (search && !text.includes(search)) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.periodicity && item.periodicity !== filters.periodicity) return false;
  if (filters.status && item.status !== filters.status) return false;
  if (filters.exportsToFinnegans && String(item.exportsToFinnegans) !== filters.exportsToFinnegans) return false;
  return true;
}

export const settlementConfigMockService = {
  getAll: () => readStore<SettlementConfig>("settlementConfigs"),
  getActive: () => readStore<SettlementConfig>("settlementConfigs").filter((item) => item.status === "ACTIVO"),
  getById: (id: string) => readStore<SettlementConfig>("settlementConfigs").find((item) => item.id === id),
  getEmptyFilters: (): SettlementConfigFilters => ({ search: "", kind: "", periodicity: "", exportsToFinnegans: "", status: "ACTIVO" }),
  getFiltered: (filters: SettlementConfigFilters) => readStore<SettlementConfig>("settlementConfigs").filter((item) => matchesFilters(item, filters)),
  getFilterOptions: () => {
    const items = readStore<SettlementConfig>("settlementConfigs");
    return {
      kinds: Array.from(new Set(items.map((item) => item.kind))).sort(),
      periodicities: Array.from(new Set(items.map((item) => item.periodicity))).sort(),
      statuses: ["ACTIVO", "INACTIVO"],
    };
  },
  getNextCode: () => nextCode(readStore<SettlementConfig>("settlementConfigs")),
  create: (data: SettlementConfig, user: User) => {
    const items = readStore<SettlementConfig>("settlementConfigs");
    const id = data.id || crypto.randomUUID();
    const code = data.code || nextCode(items);
    const entry = history(user, "Alta de configuracion", `Se creo la configuracion de liquidacion ${data.name}.`);
    const item: SettlementConfig = { ...data, id, code, createdAt: todayIso(), updatedAt: todayIso(), createdBy: user.name, updatedBy: user.name, history: [entry] };
    writeStore("settlementConfigs", [item, ...items]);
    return item;
  },
  update: (id: string, data: SettlementConfig, user: User, action = "Edicion de configuracion", description = `Se actualizo la configuracion de liquidacion ${data.name}.`) => {
    const items = readStore<SettlementConfig>("settlementConfigs");
    const current = items.find((item) => item.id === id);
    if (!current) return undefined;
    const updated: SettlementConfig = { ...current, ...data, id, code: current.code, updatedAt: todayIso(), updatedBy: user.name, history: [history(user, action, description), ...(current.history || [])] };
    writeStore("settlementConfigs", items.map((item) => item.id === id ? updated : item));
    return updated;
  },
  changeStatus: (id: string, status: "ACTIVO" | "INACTIVO", user: User) => {
    const item = settlementConfigMockService.getById(id);
    if (!item) return undefined;
    return settlementConfigMockService.update(id, { ...item, status }, user, status === "ACTIVO" ? "Activacion" : "Inactivacion", `Se cambio el estado a ${status}.`);
  },
  addFinnegansLink: (item: SettlementConfig): SettlementConfig => ({ ...item, finnegansLinks: [...item.finnegansLinks, { id: crypto.randomUUID(), code: "", name: "", exportCode: "", status: "ACTIVO" } as FinnegansSettlementLink] }),
  removeFinnegansLink: (item: SettlementConfig, linkId: string): SettlementConfig => ({ ...item, finnegansLinks: item.finnegansLinks.filter((link) => link.id !== linkId) }),
  addValidationRule: (item: SettlementConfig): SettlementConfig => ({ ...item, validationRules: [...item.validationRules, { id: crypto.randomUUID(), name: "", description: "", severity: "ADVERTENCIA", enabled: true } as SettlementValidationRule] }),
  removeValidationRule: (item: SettlementConfig, ruleId: string): SettlementConfig => ({ ...item, validationRules: item.validationRules.filter((rule) => rule.id !== ruleId) }),
};
