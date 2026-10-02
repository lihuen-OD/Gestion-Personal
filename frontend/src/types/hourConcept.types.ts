export type HourConceptStatus = "ACTIVO" | "INACTIVO";
export type HourConceptKind = "NORMAL" | "EXTRA" | "FERIADO" | "NOCTURNA" | "GUARDIA" | "SERENO" | "TRANSPORTE" | "OTRO";
export type HourConceptLoadMode = "MANUAL" | "AUTOMATIC" | "BOTH";
export type HourConceptSystemRole = "NORMAL_BASE";
// Semántica de negocio, independiente del modo de carga
// (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md): WITHIN_BASE clasifica
// horas ya incluidas en las Horas base; ADDITIVE_TO_WORKED_TOTAL es tiempo
// trabajado fuera de la fichada y suma al total.
export type HourConceptWorkTreatment = "WITHIN_BASE" | "ADDITIVE_TO_WORKED_TOTAL";

// Campos reales, persistidos por el backend, que además tiene sentido
// mostrar/editar en esta pantalla. HourConcept en schema.prisma también
// tiene countsAsWorked — decisión de producto (Etapa 8N): todo concepto
// horario cuenta como trabajado, así que no se expone en el frontend. Sigue
// existiendo en backend (ver hourConcepts.schemas.ts), no se manda desde
// acá — ver mapToApi en hourConceptApiService.ts.
// HourConcept en schema.prisma también tiene deletedAt (Etapa 8P, baja
// lógica cuando hay uso histórico) — decisión de producto (Etapa 8Q,
// auditoría UI/UX): esta pantalla ya no ofrece "ver eliminados", así que no
// se expone acá. El backend sigue soportando el filtro (GET ?includeDeleted)
// para quien lo necesite directamente — ver hourConceptApiService.ts.
export interface HourConcept {
  id: string;
  code: string;
  name: string;
  kind: HourConceptKind;
  status: HourConceptStatus;
  loadMode?: HourConceptLoadMode | null;
  systemRole?: HourConceptSystemRole | null;
  workTreatment?: HourConceptWorkTreatment | null;
  createdAt: string;
  updatedAt: string;
}

export interface HourConceptFilters {
  search: string;
  kind: string;
  status: string;
}
