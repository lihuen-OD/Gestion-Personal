// A6 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §3.3): ubicaciones de
// trabajo del legajo. Fechas como clave de calendario "YYYY-MM-DD".
export type WorkLocationState = "CURRENT" | "FUTURE" | "ENDED";

export type WorkLocationNode = { id: string; code: string; name: string; status: "ACTIVO" | "INACTIVO" };

export type EmployeeWorkLocation = {
  id: string;
  zone: WorkLocationNode;
  establishments: WorkLocationNode[];
  effectiveFrom: string;
  effectiveTo: string | null;
  state: WorkLocationState;
  reason: string;
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
};

export type WorkLocationAssignmentInput = {
  zoneId: string;
  establishmentIds: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
  notes: string | null;
};

export type WorkLocationCorrectionInput = Partial<WorkLocationAssignmentInput> & { correctionReason: string };
