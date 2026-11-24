import { apiRequest } from "./apiClient";

/**
 * Rotaciones de turnos — R4.6 (contratos en docs/BACKEND_API_CONTRACTS.md,
 * "Administración de rotaciones"). R4.8A: listado, detalle y datos de la
 * rotación. R4.8B1: equipos y lectura de versiones. R4.8B2: alta, edición y
 * borrado de versiones. Personas, vista previa y activación se agregan en sus
 * subetapas.
 *
 * Sin caché: el backend tampoco la tiene ("la configuración se lee al abrirla
 * y cada escritura devuelve el estado nuevo"). `silentErrors` en las
 * escrituras: cada formulario o acción muestra el error en su contexto.
 */
export type ShiftRotationStatus = "ACTIVO" | "INACTIVO";
export type ShiftRotationHealth = "OK" | "WARNING" | "ERROR";

export type ShiftRotationIssue = {
  /** Código de diagnóstico (`ReadinessIssueCode` del backend). Nunca se muestra: se traduce a un título. */
  code: string;
  severity: "ERROR" | "WARNING";
  message: string;
  versionId?: string;
  crewId?: string;
  employeeId?: string;
};

export type ShiftRotationCrew = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  status: ShiftRotationStatus;
  openMemberCount: number;
  everHadMembers: boolean;
};

export type ShiftRotationVersionSummary = {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  cycleLengthWeeks: number;
  anchorWeekStart: string;
  locked: boolean;
  inEffectToday: boolean;
  dayCount: number;
  updatedAt: string;
};

export type ShiftRotationMember = {
  id: string;
  crewId: string;
  crew: string;
  employeeId: string;
  legajo: string;
  employee: string;
  employeeStatus: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type ShiftRotationGroupRef = { id: string; code: string; name: string; status: ShiftRotationStatus };

export type ShiftRotation = {
  id: string;
  code: string;
  name: string;
  status: ShiftRotationStatus;
  observation: string | null;
  shiftGroup: ShiftRotationGroupRef;
  /** ACTIVA con alguna membresía que ya empezó: código y borrado quedan bloqueados. */
  hasRuled: boolean;
  /** Estado derivado: ACTIVA que ya rigió y no tiene versión ni personas desde hoy. */
  finalized: boolean;
  health: ShiftRotationHealth;
  issues: ShiftRotationIssue[];
  crews: ShiftRotationCrew[];
  versions: ShiftRotationVersionSummary[];
  /** Membresías vigentes o futuras (desde hoy). */
  members: ShiftRotationMember[];
  createdAt: string;
  updatedAt: string;
};

export type ShiftRotationDayKind = "SHIFT" | "REST";

export type ShiftRotationBlock = {
  blockIndex: number;
  shiftTemplateId: string;
  template: { code: string; name: string; startTime: string; endTime: string };
};

export type ShiftRotationDay = {
  id: string;
  crewId: string;
  crew: string | null;
  cycleWeekIndex: number;
  weekLabel: string;
  /** 0 = domingo … 6 = sábado (convención del backend). */
  weekday: number;
  weekdayName: string | null;
  kind: ShiftRotationDayKind;
  blocks: ShiftRotationBlock[];
};

/** Problema estructural de la grilla (`validateRotationGrid`). El código nunca se muestra. */
export type ShiftRotationGridIssue = {
  code: string;
  severity: "ERROR" | "WARNING";
  crewId?: string;
  cycleWeekIndex?: number;
  weekday?: number;
  blockIndex?: number;
  message: string;
};

export type ShiftRotationVersion = {
  id: string;
  rotationId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  cycleLengthWeeks: number;
  anchorWeekStart: string;
  locked: boolean;
  updatedAt: string;
  days: ShiftRotationDay[];
  issues: ShiftRotationGridIssue[];
};

export type ShiftRotationVersionInput = {
  effectiveFrom: string;
  cycleLengthWeeks: number;
  anchorWeekStart: string;
  days: Array<{ crewId: string; cycleWeekIndex: number; weekday: number; kind: ShiftRotationDayKind; blocks: Array<{ blockIndex: number; shiftTemplateId: string }> }>;
};

export type ShiftRotationCrewCreateInput = { code: string; name: string; sortOrder: number };
export type ShiftRotationCrewUpdateInput = Partial<{ name: string; sortOrder: number; status: ShiftRotationStatus }>;

export type ShiftRotationCreateInput = { code: string; name: string; shiftGroupId: string; observation?: string | null };
export type ShiftRotationUpdateInput = Partial<ShiftRotationCreateInput>;

export const shiftRotationApiService = {
  list() {
    return apiRequest<{ data: ShiftRotation[] }>("/shifts/rotations").then((response) => response.data);
  },
  detail(id: string) {
    return apiRequest<{ data: ShiftRotation }>(`/shifts/rotations/${id}`).then((response) => response.data);
  },
  create(input: ShiftRotationCreateInput) {
    return apiRequest<{ data: ShiftRotation }>("/shifts/rotations", { method: "POST", body: input, silentErrors: true }).then((response) => response.data);
  },
  update(id: string, input: ShiftRotationUpdateInput) {
    return apiRequest<{ data: ShiftRotation }>(`/shifts/rotations/${id}`, { method: "PATCH", body: input, silentErrors: true }).then((response) => response.data);
  },
  remove(id: string) {
    return apiRequest<unknown>(`/shifts/rotations/${id}`, { method: "DELETE", silentErrors: true });
  },
  /** Devuelve el equipo; el llamador vuelve a leer el detalle (conteos y diagnóstico). */
  createCrew(rotationId: string, input: ShiftRotationCrewCreateInput) {
    return apiRequest<{ data: unknown }>(`/shifts/rotations/${rotationId}/crews`, { method: "POST", body: input, silentErrors: true });
  },
  updateCrew(rotationId: string, crewId: string, input: ShiftRotationCrewUpdateInput) {
    return apiRequest<{ data: unknown }>(`/shifts/rotations/${rotationId}/crews/${crewId}`, { method: "PATCH", body: input, silentErrors: true });
  },
  version(rotationId: string, versionId: string) {
    return apiRequest<{ data: ShiftRotationVersion }>(`/shifts/rotations/${rotationId}/versions/${versionId}`).then((response) => response.data);
  },
  /** Grilla completa en un solo cuerpo; crear desde X cierra la versión anterior en X−1. */
  createVersion(rotationId: string, input: ShiftRotationVersionInput) {
    return apiRequest<{ data: ShiftRotationVersion }>(`/shifts/rotations/${rotationId}/versions`, { method: "POST", body: input, silentErrors: true }).then((response) => response.data);
  },
  /** Sólo versiones futuras. `expectedUpdatedAt` = el `updatedAt` leído: si cambió, 409 ROTATION_VERSION_STALE. */
  updateVersion(rotationId: string, versionId: string, input: ShiftRotationVersionInput & { expectedUpdatedAt: string }) {
    return apiRequest<{ data: ShiftRotationVersion }>(`/shifts/rotations/${rotationId}/versions/${versionId}`, { method: "PATCH", body: input, silentErrors: true }).then((response) => response.data);
  },
  /** Sólo versiones futuras; la anterior vuelve a regir hasta la siguiente. */
  removeVersion(rotationId: string, versionId: string) {
    return apiRequest<unknown>(`/shifts/rotations/${rotationId}/versions/${versionId}`, { method: "DELETE", silentErrors: true });
  },
};
