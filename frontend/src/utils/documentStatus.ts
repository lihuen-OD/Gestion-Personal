import type { DocumentCategory } from "../types/documentCategory.types";

export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export function isoAddDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function defaultDocumentExpiration(category?: DocumentCategory) {
  return category?.rules.expires && category.rules.defaultValidityDays ? isoAddDays(category.rules.defaultValidityDays) : "";
}

export function documentStatusByExpiration(expiresAt: string) {
  if (!expiresAt) return "Vigente";
  const today = isoToday();
  const days = Math.ceil((new Date(`${expiresAt}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  return days < 0 ? "Vencido" : days <= 30 ? "Por vencer" : "Vigente";
}
