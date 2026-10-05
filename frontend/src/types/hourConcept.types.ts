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
// No hay baja lógica (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §14):
// un concepto deshabilitado es status INACTIVO y uno eliminado ya no existe.
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

// Resumen de DELETE /hour-concepts/:id (eliminación definitiva).
export interface HourConceptDeletionSummary {
  concept: { id: string; code: string; name: string };
  deletedBreakdowns: number;
  deletedRules: number;
  deletedEmployeeAssignments: number;
  reclassifiedSegments: number;
  reclassifiedWorkShifts: number;
  unlinkedNovelties: number;
  recalculatedClosures: number;
}
