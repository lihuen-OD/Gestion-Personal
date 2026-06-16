import type { User } from "../types";
import type { FinnegansNoveltyLink, NoveltyType, NoveltyTypeFilters, NoveltyTypeHistoryRecord } from "../types/noveltyType.types";
import { readStore, writeStore } from "./storage";
import { resolveNoveltyUiColor } from "../utils/noveltyColor";

const todayIso = () => new Date().toISOString();
const normalize = (value: string) => value.trim().toLowerCase();

function history(user: User | undefined, action: string, description: string): NoveltyTypeHistoryRecord {
  return { id: crypto.randomUUID(), action, description, createdAt: todayIso(), createdByUserId: user?.id || "system", createdByUserName: user?.name || "Sistema" };
}

function matchesFilters(item: NoveltyType, filters: NoveltyTypeFilters) {
  const search = normalize(filters.search);
  const text = normalize(`${item.code} ${item.name} ${item.description} ${item.finnegansLinks.map((link) => `${link.code} ${link.name} ${link.exportConcept || ""}`).join(" ")}`);
  if (search && !text.includes(search)) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.status && item.status !== filters.status) return false;
  if (filters.exportsToFinnegans && String(item.rules.exportsToFinnegans) !== filters.exportsToFinnegans) return false;
  if (filters.requiresApproval && String(item.rules.requiresApproval) !== filters.requiresApproval) return false;
  return true;
}

function nextCode(items: NoveltyType[]) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `NOV-${String(max + 1).padStart(3, "0")}`;
}

function normalizeNoveltyType(item: NoveltyType): NoveltyType {
  const hasFinnegans = item.finnegansLinks?.some((link) => link.status === "ACTIVO");
  const storedTimeImpact = String(item.rules.timeImpact || "");
  const timeImpact = storedTimeImpact === "DESCUENTA_HORAS"
    ? "REGISTRA_HORAS_NO_TRABAJADAS"
    : storedTimeImpact === "BLOQUEA_CARGA_DIA"
      ? "BLOQUEA_CARGA_DIA"
      : storedTimeImpact === "REGISTRA_HORAS_NO_TRABAJADAS"
        ? "REGISTRA_HORAS_NO_TRABAJADAS"
        : "NO_AFECTA_HORAS";
  return {
    ...item,
    uiColor: resolveNoveltyUiColor(item.uiColor, item.id || item.name || item.code),
    origin: item.origin || (hasFinnegans ? "FINNEGANS" : "INTERNA"),
    rules: {
      ...item.rules,
      exportsToFinnegans: item.rules.exportsToFinnegans ?? Boolean(item.rules.affectsSettlement && hasFinnegans),
      hasValidity: item.rules.hasValidity ?? Boolean(item.rules.allowsDateTo),
      blocksTimeEntry: item.rules.blocksTimeEntry ?? ["VACACIONES", "LICENCIA", "ACCIDENTE", "SANCION"].includes(item.kind),
      setsWorkedHoursToZero: item.rules.setsWorkedHoursToZero ?? ["VACACIONES", "LICENCIA", "ACCIDENTE", "SANCION"].includes(item.kind),
      timeImpact,
    },
    finnegansLinks: (item.finnegansLinks || []).map((link) => ({ ...link, exportConcept: link.exportConcept || link.settlementConcept || link.name, hasValidity: link.hasValidity ?? Boolean(item.rules.allowsDateTo) })),
  };
}

export const noveltyTypeMockService = {
  getAll: () => readStore<NoveltyType>("noveltyTypes").map(normalizeNoveltyType),
  getActive: () => noveltyTypeMockService.getAll().filter((item) => item.status === "ACTIVO"),
  getById: (id: string) => noveltyTypeMockService.getAll().find((item) => item.id === id),
  getByName: (name: string) => noveltyTypeMockService.getAll().find((item) => normalize(item.name) === normalize(name)),
  getEmptyFilters: (): NoveltyTypeFilters => ({ search: "", kind: "", exportsToFinnegans: "", requiresApproval: "", status: "ACTIVO" }),
  getFiltered: (filters: NoveltyTypeFilters) => noveltyTypeMockService.getAll().filter((item) => matchesFilters(item, filters)),
  getFilterOptions: () => {
    const items = readStore<NoveltyType>("noveltyTypes");
    return {
      kinds: Array.from(new Set(items.map((item) => item.kind))).sort(),
      statuses: ["ACTIVO", "INACTIVO"],
    };
  },
  getNextCode: () => nextCode(readStore<NoveltyType>("noveltyTypes")),
  create: (data: NoveltyType, user: User) => {
    const items = readStore<NoveltyType>("noveltyTypes");
    const id = data.id || crypto.randomUUID();
    const code = data.code || nextCode(items);
    const entry = history(user, "Alta de tipo", `Se creo el tipo de novedad ${data.name}.`);
    const item: NoveltyType = { ...data, id, code, createdAt: todayIso(), updatedAt: todayIso(), createdBy: user.name, updatedBy: user.name, history: [entry] };
    writeStore("noveltyTypes", [item, ...items]);
    return item;
  },
  update: (id: string, data: NoveltyType, user: User, action = "Edicion de tipo", description = `Se actualizo el tipo de novedad ${data.name}.`) => {
    const items = readStore<NoveltyType>("noveltyTypes");
    const current = items.find((item) => item.id === id);
    if (!current) return undefined;
    const updated: NoveltyType = { ...current, ...data, id, code: current.code, updatedAt: todayIso(), updatedBy: user.name, history: [history(user, action, description), ...(current.history || [])] };
    writeStore("noveltyTypes", items.map((item) => item.id === id ? updated : item));
    return updated;
  },
  changeStatus: (id: string, status: "ACTIVO" | "INACTIVO", user: User) => {
    const item = noveltyTypeMockService.getById(id);
    if (!item) return undefined;
    return noveltyTypeMockService.update(id, { ...item, status }, user, status === "ACTIVO" ? "Activacion" : "Inactivacion", `Se cambio el estado a ${status}.`);
  },
  addFinnegansLink: (item: NoveltyType): NoveltyType => ({ ...item, rules: { ...item.rules, exportsToFinnegans: true }, finnegansLinks: [...item.finnegansLinks, { id: crypto.randomUUID(), code: "", name: "", exportConcept: "", priority: item.finnegansLinks.length + 1, status: "ACTIVO", hasValidity: item.rules.hasValidity } as FinnegansNoveltyLink] }),
  removeFinnegansLink: (item: NoveltyType, linkId: string): NoveltyType => ({ ...item, finnegansLinks: item.finnegansLinks.filter((link) => link.id !== linkId) }),
};
