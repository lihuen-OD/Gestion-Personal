export type HourConceptStatus = "ACTIVO" | "INACTIVO";
export type HourConceptKind = "NORMAL" | "EXTRA" | "FERIADO" | "NOCTURNA" | "GUARDIA" | "SERENO" | "TRANSPORTE" | "OTRO";

// Solo campos reales, persistidos por el backend (HourConcept en schema.prisma:
// id, code, name, kind, status, countsAsWorked, createdAt, updatedAt).
// countsAsWorked existe en el modelo pero todavía no se expone acá — no se
// agregó en la limpieza de la Etapa 8L para no introducir una funcionalidad
// nueva; queda documentado como pendiente.
export interface HourConcept {
  id: string;
  code: string;
  name: string;
  kind: HourConceptKind;
  status: HourConceptStatus;
  createdAt: string;
  updatedAt: string;
}

export interface HourConceptFilters {
  search: string;
  kind: string;
  status: string;
}
