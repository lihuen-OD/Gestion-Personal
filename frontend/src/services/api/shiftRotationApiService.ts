import { apiRequest } from "./apiClient";
import { invalidateCacheFamily, NOVELTY_COVERAGE_DERIVED_CACHE_FAMILIES } from "../cache";

/**
 * Versiones y membresías recalculan en el backend la cobertura de Novedades
 * de las personas afectadas: se invalidan las mismas familias derivadas que
 * invalida `shiftAssignmentApiService` al cambiar un turno fijo.
 */
function invalidateCoverage(reason: string) {
  return Promise.all(NOVELTY_COVERAGE_DERIVED_CACHE_FAMILIES.map((family) => invalidateCacheFamily(family, reason)));
}

/**
 * Rotaciones de turnos — R4.6 (contratos en docs/BACKEND_API_CONTRACTS.md,
 * "Administración de rotaciones"). R4.8A: listado, detalle y datos de la
 * rotación. R4.8B1: equipos y lectura de versiones. R4.8B2: alta, edición y
 * borrado de versiones. R4.8C: personas (membresías). R4.8D: vista previa
 * (`GET /shifts/expected`, R4.7, sólo lectura). R4.8E: activar, desactivar y
 * finalizar (vista previa + confirmación con token).
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

export type ShiftRotationAddMembersInput = { employeeIds: string[]; effectiveFrom: string; effectiveTo?: string | null; closeFixedAssignments?: boolean };

/** Personas que, tras la baja, no tienen turno fijo ni otra rotación desde `from` (dato informativo del backend). */
export type ShiftRotationWithoutFixedShift = { employeeId: string; employee: string; from: string };

// ── Vista previa (R4.7, docs/BACKEND_API_CONTRACTS.md "Vista previa de horarios de rotación") ──

export type PreviewBlock = {
  /** Fecha operativa: el día en que empieza el bloque (un nocturno pertenece sólo a ese día). */
  operationalDate: string;
  blockIndex: number;
  source: "ROTATION" | "FIXED_ASSIGNMENT" | "HOLIDAY_CONVOCATION";
  template: { id: string; code: string; startTime: string; endTime: string; crossesMidnight: boolean };
  scheduledStartAt: string;
  scheduledEndAt: string;
  durationMinutes: number;
};

export type PreviewPlanningKind = "SHIFTS" | "REST" | "MISSING" | "CONFLICT" | "FIXED_ASSIGNMENT" | "NONE";

export type PreviewWarning = { code: string; severity: "ERROR" | "WARNING"; message: string; relatedDate?: string };

export type PreviewCell = {
  date: string;
  assignment: null | {
    membershipId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    crew: { id: string; code: string; name: string } | null;
    version: { id: string; effectiveFrom: string; effectiveTo: string | null } | null;
    cycleWeekIndex: number | null;
    cycleWeekLabel: string | null;
  };
  planning: { kind: PreviewPlanningKind; reason: string | null; detail: string[]; origin: unknown; blocks: PreviewBlock[] };
  effective: { obligation: "SHIFT" | "NO_OBLIGATION" | "UNRESOLVED"; source: string; reason: string | null; blocks: PreviewBlock[] };
  expectedWorkday: {
    obligation: "WORKDAY" | "NO_WORK_OBLIGATION" | "HOLIDAY_NOT_CONVOKED" | "DAY_OFF" | "UNRESOLVED";
    unresolvedReason: string | null;
    expectedMinutes: number | null;
    isHoliday: boolean;
    convoked: boolean;
    source: string;
    planIssue?: { kind: "CONFLICT" | "MISSING"; reason: string };
  };
  facts: { dayOff: boolean; holidayScope: "IN_SCOPE" | "OUT_OF_SCOPE" | "SCOPE_HISTORY_MISSING" | null; convoked: boolean; regimeKind: string | null };
  transitionFromPrevious: null | { previousOperationalDate: string; restMinutes: number | null; overlap: boolean };
  warnings: PreviewWarning[];
};

export type PreviewRow = {
  employee: { id: string; legajo: string; firstName: string; lastName: string; status: string };
  days: PreviewCell[];
};

export type PreviewResponse = {
  data: PreviewRow[];
  context: {
    rotation: { id: string; code: string; name: string };
    range: { from: string; to: string; days: number };
    persistedStatus: ShiftRotationStatus;
    readOnly: true;
    previewMode: "HYPOTHETICAL_INACTIVE" | "CURRENT_CONFIGURATION";
    affectsRealObligations: false;
  };
  meta: { total: number; page: number; pageSize: number; hasMore: boolean };
};

// ── Finalización (R4.6: vista previa + confirmación con token) ──

type FinalizeMemberRow = { id: string; employeeId: string; employee: string; crew: string; effectiveFrom: string; effectiveTo: string | null };

export type FinalizePreview = {
  lastDay: string;
  closeVersions: Array<{ id: string; effectiveFrom: string; effectiveTo: string | null }>;
  deleteVersions: Array<{ id: string; effectiveFrom: string; effectiveTo: string | null; dayCount: number }>;
  closeMembers: FinalizeMemberRow[];
  cancelMembers: FinalizeMemberRow[];
  withoutFixedShiftAfter: ShiftRotationWithoutFixedShift[];
  transitionOverlaps: Array<{ employeeId: string; employee: string; outgoing: string; incoming: string }>;
  /** Informativo: R4.7 no fija un umbral de descanso. */
  restsAtTransition: Array<{ employeeId: string; employee: string; restMinutes: number }>;
  requiresConfirmation: true;
  /** Huella del conjunto de cambios; se devuelve tal cual en la confirmación. */
  confirmationToken: string;
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
  async createVersion(rotationId: string, input: ShiftRotationVersionInput) {
    const result = await apiRequest<{ data: ShiftRotationVersion }>(`/shifts/rotations/${rotationId}/versions`, { method: "POST", body: input, silentErrors: true }).then((response) => response.data);
    await invalidateCoverage("rotation version created");
    return result;
  },
  /** Sólo versiones futuras. `expectedUpdatedAt` = el `updatedAt` leído: si cambió, 409 ROTATION_VERSION_STALE. */
  async updateVersion(rotationId: string, versionId: string, input: ShiftRotationVersionInput & { expectedUpdatedAt: string }) {
    const result = await apiRequest<{ data: ShiftRotationVersion }>(`/shifts/rotations/${rotationId}/versions/${versionId}`, { method: "PATCH", body: input, silentErrors: true }).then((response) => response.data);
    await invalidateCoverage("rotation version updated");
    return result;
  },
  /** Exige diagnóstico sin errores y ninguna membresía iniciada hoy o antes (lo valida el backend). */
  async activate(rotationId: string) {
    const result = await apiRequest<{ data: ShiftRotation }>(`/shifts/rotations/${rotationId}/activate`, { method: "POST", silentErrors: true }).then((response) => response.data);
    await invalidateCoverage("rotation activated");
    return result;
  },
  /** Sólo si la rotación nunca rigió. */
  async deactivate(rotationId: string) {
    const result = await apiRequest<{ data: ShiftRotation }>(`/shifts/rotations/${rotationId}/deactivate`, { method: "POST", silentErrors: true }).then((response) => response.data);
    await invalidateCoverage("rotation deactivated");
    return result;
  },
  finalizePreview(rotationId: string, lastDay: string) {
    return apiRequest<{ data: FinalizePreview }>(`/shifts/rotations/${rotationId}/finalize/preview`, { method: "POST", body: { lastDay }, silentErrors: true }).then((response) => response.data);
  },
  /** Confirma con el token de la vista previa; si la rotación cambió responde 409 ROTATION_FINALIZE_STALE con la vista previa nueva. */
  async finalize(rotationId: string, lastDay: string, confirmationToken: string) {
    const result = await apiRequest<{ data: { rotation: ShiftRotation; applied: FinalizePreview } }>(`/shifts/rotations/${rotationId}/finalize`, { method: "POST", body: { lastDay, confirm: true, confirmationToken }, silentErrors: true }).then((response) => response.data);
    await invalidateCoverage("rotation finalized");
    return result;
  },
  /** Vista previa de sólo lectura: hasta 42 días, `take` 1–100 (contrato R4.7). Sin caché: depende de la fecha y de la configuración. */
  preview(query: { rotationId: string; from: string; to: string; page: number; take: number }) {
    const params = new URLSearchParams({ rotationId: query.rotationId, from: query.from, to: query.to, page: String(query.page), take: String(query.take) });
    return apiRequest<PreviewResponse>(`/shifts/expected?${params.toString()}`);
  },
  /** Membresías vigentes o futuras (`history` = también las terminadas). */
  members(rotationId: string, history: boolean) {
    return apiRequest<{ data: ShiftRotationMember[] }>(`/shifts/rotations/${rotationId}/members${history ? "?history=true" : ""}`).then((response) => response.data);
  },
  /** Alta en un equipo (hasta 50). `closeFixedAssignments` sólo si RRHH lo confirmó explícitamente. */
  async addMembers(rotationId: string, crewId: string, input: ShiftRotationAddMembersInput) {
    const result = await apiRequest<{ data: { members: ShiftRotationMember[]; closedFixedAssignments: number } }>(`/shifts/rotations/${rotationId}/crews/${crewId}/members`, { method: "POST", body: input, silentErrors: true }).then((response) => response.data);
    await invalidateCoverage("rotation members added");
    // La opción explícita puede cerrar o deshabilitar turnos fijos (conteos de Turnos).
    if (result.closedFixedAssignments) await invalidateCacheFamily("workforce-config", "rotation closed fixed assignments");
    return result;
  },
  async closeMember(rotationId: string, memberId: string, lastDay: string) {
    const result = await apiRequest<{ data: { member: ShiftRotationMember; withoutFixedShiftAfter: ShiftRotationWithoutFixedShift[] } }>(`/shifts/rotations/${rotationId}/members/${memberId}/close`, { method: "POST", body: { lastDay }, silentErrors: true }).then((response) => response.data);
    await invalidateCoverage("rotation member closed");
    return result;
  },
  async moveMember(rotationId: string, memberId: string, toCrewId: string, effectiveFrom: string) {
    const result = await apiRequest<{ data: { closed: ShiftRotationMember; opened: ShiftRotationMember } }>(`/shifts/rotations/${rotationId}/members/${memberId}/move`, { method: "POST", body: { toCrewId, effectiveFrom }, silentErrors: true }).then((response) => response.data);
    await invalidateCoverage("rotation member moved");
    return result;
  },
  /** Sólo un alta que todavía no rigió. */
  async cancelMember(rotationId: string, memberId: string) {
    const result = await apiRequest<unknown>(`/shifts/rotations/${rotationId}/members/${memberId}`, { method: "DELETE", silentErrors: true });
    await invalidateCoverage("rotation member cancelled");
    return result;
  },
  /** Sólo versiones futuras; la anterior vuelve a regir hasta la siguiente. */
  async removeVersion(rotationId: string, versionId: string) {
    const result = await apiRequest<unknown>(`/shifts/rotations/${rotationId}/versions/${versionId}`, { method: "DELETE", silentErrors: true });
    await invalidateCoverage("rotation version removed");
    return result;
  },
};
