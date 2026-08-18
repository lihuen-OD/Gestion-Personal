import type { Employee } from "./index";

export type PositionStatus = "ACTIVO" | "INACTIVO";
export type WorkModality = "PRESENCIAL" | "HIBRIDA" | "REMOTA" | "OTRA";

export type PositionResponsibility = { id: string; description: string; order: number };
export type PositionRelation = { id: string; name: string; description?: string };
export type PositionCompetency = { id: string; name: string; description?: string; active: boolean };
export type PositionIndicator = { id: string; name: string; description?: string; target?: string; active: boolean };
export type PositionEvaluationCriterion = { id: string; name: string; description: string; rule?: string; weight?: number; active: boolean };

export type PositionHistoryRecord = {
  id: string;
  positionId: string;
  action: string;
  description: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
  createdByUserId: string;
  createdByUserName: string;
};

export type Position = {
  id: string;
  code?: string;
  name: string;
  assignedCount?: number;
  reportsTo?: string;
  supervises?: string;
  location?: string;
  lastUpdatedAt: string;
  status: PositionStatus;
  companyId?: string;
  companyName?: string;
  businessUnitId?: string;
  establishmentId?: string;
  suggestedCostCenterId?: string;
  suggestedCostCenterName?: string;
  suggestedReceiptCategoryId?: string;
  suggestedReceiptCategoryName?: string;
  suggestedInternalCategoryId?: string;
  suggestedInternalCategoryName?: string;
  /** Fuente oficial de ubicacion (limpieza final de Position, 2026-08-18). */
  sectorId?: string;
  /** Derivados de solo lectura via sectorId -> area -> establishment -> businessUnit -> company. */
  derivedSectorName?: string;
  derivedAreaId?: string;
  derivedAreaName?: string;
  derivedEstablishmentId?: string;
  derivedEstablishmentName?: string;
  derivedBusinessUnitId?: string;
  derivedBusinessUnitName?: string;
  derivedCompanyId?: string;
  derivedCompanyName?: string;
  /** Fuente oficial de categoria salarial (relacion real PositionSalaryCategory). */
  salaryCategoryIds?: string[];
  salaryCategoryNames?: string[];
  mission: string;
  responsibilities: PositionResponsibility[];
  internalRelations: PositionRelation[];
  externalRelations: PositionRelation[];
  competencies: PositionCompetency[];
  workConditions: {
    modality: WorkModality;
    workload: string;
    workplace: string;
    relationType: string;
    observations?: string;
  };
  performanceIndicators: PositionIndicator[];
  evaluationCriteria: PositionEvaluationCriterion[];
  history: PositionHistoryRecord[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
};

export type PositionFilters = {
  search: string;
  /** Filtran por id real (catalogo de Estructura Organizacional), no por string legado. */
  businessUnitId: string;
  establishmentId: string;
  areaId: string;
  sectorId: string;
  salaryRangeCategory: string;
  status: "" | PositionStatus;
};

export type PositionSummary = {
  total: number;
  active: number;
  inactive: number;
  withoutPeople: number;
  pendingUpdate: number;
  linkedToEmployees: number;
};

export type AssignedPositionEmployee = Employee;
