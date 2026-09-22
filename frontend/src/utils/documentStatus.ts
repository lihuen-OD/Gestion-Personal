import type { DocumentCategory } from "../types/documentCategory.types";
import { argentinaDateKey } from "./argentinaDateKey";

// Etapa 15M.21: "hoy" es el día calendario Argentina, no el día UTC — entre
// ~21:00 y 23:59 ART el día UTC ya rodó al siguiente, lo que corría un día
// hacia adelante el estado "Vencido"/"Por vencer" de un documento.
export function isoToday() {
  return argentinaDateKey(new Date());
}

export function isoAddDays(days: number) {
  const date = new Date(`${isoToday()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
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
