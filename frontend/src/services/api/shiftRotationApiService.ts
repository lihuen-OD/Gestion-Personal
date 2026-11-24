import { apiRequest } from "./apiClient";

/**
 * Rotaciones de turnos — R4.6 (contratos en docs/BACKEND_API_CONTRACTS.md,
 * "Administración de rotaciones"). R4.8A sólo usa el listado, el detalle y el
 * alta/edición/borrado de la rotación; equipos, grillas, personas, vista
 * previa y activación se agregan en sus subetapas.
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
};
