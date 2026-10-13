// A6 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §3.3): ubicaciones de
// trabajo del legajo. Fechas como clave de calendario "YYYY-MM-DD".
export type WorkLocationState = "CURRENT" | "FUTURE" | "ENDED";

export type WorkLocationNode = { id: string; code: string; name: string; status: "ACTIVO" | "INACTIVO" };

/** ESTABLISHMENT = establecimiento completo; UNITS = sólo las unidades elegidas. Siempre explícito. */
export type WorkLocationCoverage = "ESTABLISHMENT" | "UNITS";

export type WorkLocationEstablishment = WorkLocationNode & { coverage: WorkLocationCoverage; units: WorkLocationNode[] };

export type WorkLocationEstablishmentSelection = { establishmentId: string; coverage: WorkLocationCoverage; unitIds: string[] };

export type EmployeeWorkLocation = {
  id: string;
  /** `province` es null en zonas anteriores a la provincia (pendientes de recarga). */
  zone: WorkLocationNode & { province?: { id: string; name: string } | null };
  establishments: WorkLocationEstablishment[];
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
  establishments: WorkLocationEstablishmentSelection[];
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
  notes: string | null;
};

export type WorkLocationCorrectionInput = Partial<WorkLocationAssignmentInput> & { correctionReason: string };
