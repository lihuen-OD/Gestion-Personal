import type { User } from "../types";
import type { HourConcept, HourConceptFilters, HourConceptHistoryRecord } from "../types/hourConcept.types";
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
  const text = normalize(`${item.code} ${item.name} ${item.description} ${item.kind}`);
  if (search && !text.includes(search)) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.status && item.status !== filters.status) return false;
  return true;
}

function normalizeHourConcept(item: HourConcept): HourConcept | null {
  const forbidden = new Set(["LLEGADA_TARDE", "AUSENCIA_HORARIA", "FRANCO"]);
  if (forbidden.has(String(item.kind))) return null;
  if (["llegada tarde", "franco compensatorio"].includes(normalize(item.name))) return null;
  return {
    ...item,
    kind: (["NORMAL", "EXTRA", "FERIADO", "NOCTURNA", "GUARDIA", "SERENO", "TRANSPORTE", "OTRO"].includes(item.kind) ? item.kind : "OTRO") as HourConcept["kind"],
    rules: {
      ...item.rules,
      defaultUnit: "HORAS",
    },
    finnegansLinks: [],
  };
}

export const hourConceptMockService = {
  getAll: () => readStore<HourConcept>("hourConcepts").map(normalizeHourConcept).filter(Boolean) as HourConcept[],
  getActive: () => hourConceptMockService.getAll().filter((item) => item.status === "ACTIVO"),
  getById: (id: string) => hourConceptMockService.getAll().find((item) => item.id === id),
  getEmptyFilters: (): HourConceptFilters => ({ search: "", kind: "", status: "ACTIVO" }),
  getFiltered: (filters: HourConceptFilters) => hourConceptMockService.getAll().filter((item) => matchesFilters(item, filters)),
  getFilterOptions: () => {
    const items = hourConceptMockService.getAll();
    return {
      kinds: Array.from(new Set(items.map((item) => item.kind))).sort(),
      statuses: ["ACTIVO", "INACTIVO"],
    };
  },
  getNextCode: () => nextCode(hourConceptMockService.getAll()),
  create: (data: HourConcept, user: User) => {
    const items = readStore<HourConcept>("hourConcepts");
    const id = data.id || crypto.randomUUID();
    const code = data.code || nextCode(items);
    const entry = history(user, "Alta de hora especial", `Se creo la hora especial ${data.name}.`);
    const item: HourConcept = { ...data, id, code, createdAt: todayIso(), updatedAt: todayIso(), createdBy: user.name, updatedBy: user.name, history: [entry] };
    writeStore("hourConcepts", [item, ...items]);
    return item;
  },
  update: (id: string, data: HourConcept, user: User, action = "Edicion de hora especial", description = `Se actualizo la hora especial ${data.name}.`) => {
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
};
