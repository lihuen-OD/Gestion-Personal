import type { DocumentCategoryKind, DocumentCategoryScope } from "../types/documentCategory.types";

// Etapa 15M.20: las categorías documentales (y los vínculos externos que
// cuelgan de ellas) mostraban el enum crudo del backend en filtros, tabla y
// formulario — un único punto de verdad acá para las tres pantallas/
// componentes que los usan.
export const documentCategoryKindLabels: Record<DocumentCategoryKind, string> = {
  PERSONAL: "Personal",
  LABORAL: "Laboral",
  MEDICA: "Médica",
  LIQUIDACION: "Liquidación",
  TRANSPORTE: "Transporte",
  CAPACITACION: "Capacitación",
  LEGAL: "Legal",
  NOVEDAD: "Novedad",
  OTRO: "Otro",
};

export const documentCategoryScopeLabels: Record<DocumentCategoryScope, string> = {
  LEGAJO: "Legajo",
  NOVEDAD: "Novedad",
  LIQUIDACION: "Liquidación",
  TRANSPORTE: "Transporte",
  ALTA_BAJA: "Alta/Baja",
  PUESTO: "Puesto",
};

export const documentLinkProviderLabels: Record<"FINNEGANS" | "CARPETA_RED" | "OTRO", string> = {
  FINNEGANS: "Finnegans",
  CARPETA_RED: "Carpeta de red",
  OTRO: "Otro",
};
