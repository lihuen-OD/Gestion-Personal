export type HourConceptStatus = "ACTIVO" | "INACTIVO";
export type HourConceptKind = "NORMAL" | "EXTRA" | "FERIADO" | "NOCTURNA" | "GUARDIA" | "SERENO" | "TRANSPORTE" | "OTRO";

// Solo campos reales, persistidos por el backend (HourConcept en schema.prisma:
// id, code, name, kind, status, countsAsWorked, createdAt, updatedAt).
export interface HourConcept {
  id: string;
  code: string;
  name: string;
  kind: HourConceptKind;
  status: HourConceptStatus;
  countsAsWorked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HourConceptFilters {
  search: string;
  kind: string;
  status: string;
}
