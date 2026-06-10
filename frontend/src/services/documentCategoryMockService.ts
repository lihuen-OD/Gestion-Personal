import type { User } from "../types";
import type { DocumentCategory, DocumentCategoryFilters, DocumentCategoryHistoryRecord, ExternalDocumentLink } from "../types/documentCategory.types";
import { readStore, writeStore } from "./storage";

const todayIso = () => new Date().toISOString();
const normalize = (value: string) => value.trim().toLowerCase();

function history(user: User | undefined, action: string, description: string): DocumentCategoryHistoryRecord {
  return { id: crypto.randomUUID(), action, description, createdAt: todayIso(), createdByUserId: user?.id || "system", createdByUserName: user?.name || "Sistema" };
}

function nextCode(items: DocumentCategory[]) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `DOC-${String(max + 1).padStart(3, "0")}`;
}

function matchesFilters(item: DocumentCategory, filters: DocumentCategoryFilters) {
  const search = normalize(filters.search);
  const text = normalize(`${item.code} ${item.name} ${item.description} ${item.kind} ${item.scopes.join(" ")} ${item.externalLinks.map((link) => `${link.provider} ${link.code} ${link.name}`).join(" ")}`);
  if (search && !text.includes(search)) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.scope && !item.scopes.includes(filters.scope as never)) return false;
  if (filters.mandatory && String(item.rules.mandatory) !== filters.mandatory) return false;
  if (filters.expires && String(item.rules.expires) !== filters.expires) return false;
  if (filters.status && item.status !== filters.status) return false;
  return true;
}

export const documentCategoryMockService = {
  getAll: () => readStore<DocumentCategory>("documentCategories"),
  getActive: () => readStore<DocumentCategory>("documentCategories").filter((item) => item.status === "ACTIVO"),
  getById: (id: string) => readStore<DocumentCategory>("documentCategories").find((item) => item.id === id),
  getEmptyFilters: (): DocumentCategoryFilters => ({ search: "", kind: "", scope: "", mandatory: "", expires: "", status: "ACTIVO" }),
  getFiltered: (filters: DocumentCategoryFilters) => readStore<DocumentCategory>("documentCategories").filter((item) => matchesFilters(item, filters)),
  getFilterOptions: () => {
    const items = readStore<DocumentCategory>("documentCategories");
    return {
      kinds: Array.from(new Set(items.map((item) => item.kind))).sort(),
      scopes: Array.from(new Set(items.flatMap((item) => item.scopes))).sort(),
      statuses: ["ACTIVO", "INACTIVO"],
    };
  },
  getNextCode: () => nextCode(readStore<DocumentCategory>("documentCategories")),
  create: (data: DocumentCategory, user: User) => {
    const items = readStore<DocumentCategory>("documentCategories");
    const id = data.id || crypto.randomUUID();
    const code = data.code || nextCode(items);
    const entry = history(user, "Alta de categoria", `Se creo la categoria documental ${data.name}.`);
    const item: DocumentCategory = { ...data, id, code, createdAt: todayIso(), updatedAt: todayIso(), createdBy: user.name, updatedBy: user.name, history: [entry] };
    writeStore("documentCategories", [item, ...items]);
    return item;
  },
  update: (id: string, data: DocumentCategory, user: User, action = "Edicion de categoria", description = `Se actualizo la categoria documental ${data.name}.`) => {
    const items = readStore<DocumentCategory>("documentCategories");
    const current = items.find((item) => item.id === id);
    if (!current) return undefined;
    const updated: DocumentCategory = { ...current, ...data, id, code: current.code, updatedAt: todayIso(), updatedBy: user.name, history: [history(user, action, description), ...(current.history || [])] };
    writeStore("documentCategories", items.map((item) => item.id === id ? updated : item));
    return updated;
  },
  addExternalLink: (item: DocumentCategory): DocumentCategory => ({ ...item, externalLinks: [...item.externalLinks, { id: crypto.randomUUID(), provider: "FINNEGANS", code: "", name: "", status: "ACTIVO" } as ExternalDocumentLink] }),
  removeExternalLink: (item: DocumentCategory, linkId: string): DocumentCategory => ({ ...item, externalLinks: item.externalLinks.filter((link) => link.id !== linkId) }),
};
