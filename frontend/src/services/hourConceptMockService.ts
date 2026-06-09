import type { User } from "../types";
import type { FinnegansHourConceptLink, HourConcept, HourConceptFilters, HourConceptHistoryRecord } from "../types/hourConcept.types";
import { readStore, writeStore } from "./storage";

const todayIso = () => new Date().toISOString();
const normalize = (value: string) => value.trim().toLowerCase();

function history(user: User | undefined, action: string, description: string): HourConceptHistoryRecord {
  return { id: crypto.randomUUID(), action, description, createdAt: todayIso(), createdByUserId: user?.id || "system", createdByUserName: user?.name || "Sistema" };
}

function nextCode(items: HourConcept[]) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `HOR-${String(max + 1).padStart(3, "0")}`;
}

function matchesFilters(item: HourConcept, filters: HourConceptFilters) {
  const search = normalize(filters.search);
  const text = normalize(`${item.code} ${item.name} ${item.description} ${item.kind} ${item.finnegansLinks.map((link) => `${link.code} ${link.name} ${link.settlementConcept}`).join(" ")}`);
  if (search && !text.includes(search)) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.status && item.status !== filters.status) return false;
  if (filters.affectsSettlement && String(item.rules.affectsSettlement) !== filters.affectsSettlement) return false;
  if (filters.requiresApproval && String(item.rules.requiresApproval) !== filters.requiresApproval) return false;
  return true;
}

export const hourConceptMockService = {
  getAll: () => readStore<HourConcept>("hourConcepts"),
  getActive: () => readStore<HourConcept>("hourConcepts").filter((item) => item.status === "ACTIVO"),
  getById: (id: string) => readStore<HourConcept>("hourConcepts").find((item) => item.id === id),
  getEmptyFilters: (): HourConceptFilters => ({ search: "", kind: "", affectsSettlement: "", requiresApproval: "", status: "ACTIVO" }),
  getFiltered: (filters: HourConceptFilters) => readStore<HourConcept>("hourConcepts").filter((item) => matchesFilters(item, filters)),
  getFilterOptions: () => {
    const items = readStore<HourConcept>("hourConcepts");
    return {
      kinds: Array.from(new Set(items.map((item) => item.kind))).sort(),
      statuses: ["ACTIVO", "INACTIVO"],
    };
  },
  getNextCode: () => nextCode(readStore<HourConcept>("hourConcepts")),
  create: (data: HourConcept, user: User) => {
    const items = readStore<HourConcept>("hourConcepts");
    const id = data.id || crypto.randomUUID();
    const code = data.code || nextCode(items);
    const entry = history(user, "Alta de concepto", `Se creo el concepto horario ${data.name}.`);
    const item: HourConcept = { ...data, id, code, createdAt: todayIso(), updatedAt: todayIso(), createdBy: user.name, updatedBy: user.name, history: [entry] };
    writeStore("hourConcepts", [item, ...items]);
    return item;
  },
  update: (id: string, data: HourConcept, user: User, action = "Edicion de concepto", description = `Se actualizo el concepto horario ${data.name}.`) => {
    const items = readStore<HourConcept>("hourConcepts");
    const current = items.find((item) => item.id === id);
    if (!current) return undefined;
    const updated: HourConcept = { ...current, ...data, id, code: current.code, updatedAt: todayIso(), updatedBy: user.name, history: [history(user, action, description), ...(current.history || [])] };
    writeStore("hourConcepts", items.map((item) => item.id === id ? updated : item));
    return updated;
  },
  changeStatus: (id: string, status: "ACTIVO" | "INACTIVO", user: User) => {
    const item = hourConceptMockService.getById(id);
    if (!item) return undefined;
    return hourConceptMockService.update(id, { ...item, status }, user, status === "ACTIVO" ? "Activacion" : "Inactivacion", `Se cambio el estado a ${status}.`);
  },
  addFinnegansLink: (item: HourConcept): HourConcept => ({ ...item, finnegansLinks: [...item.finnegansLinks, { id: crypto.randomUUID(), code: "", name: "", settlementConcept: "", priority: item.finnegansLinks.length + 1, status: "ACTIVO" } as FinnegansHourConceptLink] }),
  removeFinnegansLink: (item: HourConcept, linkId: string): HourConcept => ({ ...item, finnegansLinks: item.finnegansLinks.filter((link) => link.id !== linkId) }),
};
