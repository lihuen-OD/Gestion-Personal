import { apiRequest } from "./apiClient";
import { appendSortParams } from "./listQuery";
import type { SortState } from "../../utils/sort";

// Whitelists server-side (time-entries/timeEntries.schemas.ts): "Por registro"
// ordena por cualquiera de TimeEntryListSortKey; "Por persona" y "Personas
// habilitadas" paginan empleados y sólo aceptan legajo/empleado.
export type TimeEntryListSortKey = "legajo" | "employee" | "date" | "hourConcept" | "hours" | "status";
export type EmployeeRowSortKey = "legajo" | "employee";
import { mapEmployeeFromApi } from "./employeeApiService";
import { hourConceptApiService } from "./hourConceptApiService";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";
import type { Employee, TimeEntry, TimeStatus, User } from "../../types";
import type { HoursExportColumn } from "../../utils/hoursExport";
import type { PeriodAccounting, PeriodAccountingSummary } from "../../types/workedTimeAccounting.types";

type ApiApprovalStatus =
  | "BORRADOR"
  | "PENDIENTE"
  | "EN_REVISION"
  | "APROBADO"
  | "RECHAZADO"
  | "DEVUELTO"
  | "CERRADO";

export type HomeSummary =
  | { role: "carga"; period: string; paraCargar: number; devueltosParaCorregir: number; enviadoEsperandoRevision: number }
  | { role: "revision"; period: string; paraRevisarHoy: number; novedadesPendientes: number; fichadasObservadas: number };

export type ApiTimeEntry = {
  id: string;
  employeeId: string;
  hourConceptId: string;
  workShiftId?: string | null;
  date: string;
  hours: string | number;
  totalMinutes?: number | null;
  segmentStartAt?: string | null;
  segmentEndAt?: string | null;
  source?: string | null;
  status: ApiApprovalStatus;
  observation?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  // Etapa 11B: Horas Especiales en la Bandeja de revisión — appliedMultiplier
  // ya viajaba en la respuesta cruda del backend (escalar de TimeEntry, sin
  // select restrictivo en el listado plano) pero se perdía en el mapeo al
  // tipo TimeEntry del frontend. timeSegment sólo existe para entradas del
  // fichador (una carga manual no genera TimeSegment, ver 11A).
  appliedMultiplier?: string | number | null;
  timeSegment?: {
    specialHourRuleApplications: Array<{ wasConflicting: boolean; doubleHourRule: { name: string } }>;
  } | null;
  employee?: {
    id: string;
    legajo: string;
    cuil: string;
    firstName: string;
    lastName: string;
    status: string;
  };
  hourConcept?: {
    id: string;
    code: string;
    name: string;
    kind: string;
    status: string;
  };
};

// Por día: novedad e indicador de Hora Especial. Las horas viven en
// `summary.accounting.days[day]` (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md).
export type EmployeePeriodDay = {
  day: number;
  novelty: { label: string } | null;
  specialHourRuleNames: string[];
  specialHourConflict: boolean;
};

type ApiEmployeePeriodRow = {
  employee: Parameters<typeof mapEmployeeFromApi>[0];
  summary: {
    incidents?: number;
    status: ApiApprovalStatus;
    // Contabilidad única calculada por el backend: base, Horas normales,
    // conceptos dentro de la jornada, horas adicionales, total trabajado y
    // equivalencia para liquidación. "Por persona" la recibe sin `days`.
    accounting: PeriodAccountingSummary;
    specialHourRuleNames?: string[];
    specialHourConflict?: boolean;
    dailyBreakdown?: EmployeePeriodDay[];
  };
};

type ApiListResponse = { data: ApiTimeEntry[] };
type ApiItemResponse = { data: ApiTimeEntry };
type ApiWorkShiftPreviewResponse = {
  data: {
    employee: {
      id: string;
      legajo: string;
      dni: string;
      cuil: string;
      firstName: string;
      lastName: string;
      status: string;
    };
    hourConcept: {
      id: string;
      code: string;
      name: string;
      kind: string;
      status: string;
    };
    totalMinutes: number;
    totalHours: number;
    segments: Array<{
      date: string;
      startAt: string;
      endAt: string;
      minutes: number;
      hours: number;
      label: string;
    }>;
  };
};
type ApiWorkShiftCreateResponse = {
  data: {
    workShift: {
      id: string;
      employeeId: string;
      startAt: string;
      endAt: string;
      totalMinutes: number;
      source: string;
      status: string;
    };
    entries: ApiTimeEntry[];
    preview: ApiWorkShiftPreviewResponse["data"];
  };
};
type ApiListMeta = { total: number; page: number; pageSize: number; hasMore: boolean };
type ApiEmployeePeriodRowsResponse = { data: ApiEmployeePeriodRow[]; meta: ApiListMeta };
type ApiSummaryResponse = {
  data: {
    activeEmployees: number;
    employeesWithEntries: number;
    pendingEmployees: number;
    reviewEmployees: number;
    countableHours: number;
    coverage: number;
  };
};
type ApiExportResponse = {
  data: {
    total: number;
    // Columnas definidas por el backend (fijas + 2 por concepto del período:
    // horas reales y para liquidación). El frontend no arma columnas propias.
    columns: HoursExportColumn[];
    rows: Array<Record<string, string>>;
    definitive: boolean;
  };
};

const countableStatuses = new Set<TimeStatus>(["Aprobado", "En revisión"]);
const exportableStatuses = new Set<TimeStatus>(["Aprobado"]);
const lockedStatuses = new Set<TimeStatus>(["Aprobado", "Cerrado", "Exportado"]);

const statusFromApi: Record<ApiApprovalStatus, TimeStatus> = {
  BORRADOR: "Borrador",
  PENDIENTE: "Pendiente",
  EN_REVISION: "En revisión",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
  DEVUELTO: "Devuelto",
  CERRADO: "Cerrado",
};

const statusToApi: Partial<Record<TimeStatus, ApiApprovalStatus>> = {
  Borrador: "BORRADOR",
  Pendiente: "PENDIENTE",
  "En revisión": "EN_REVISION",
  Devuelto: "DEVUELTO",
  Aprobado: "APROBADO",
  Rechazado: "RECHAZADO",
  Cerrado: "CERRADO",
};

// Etapa 15M.20: reexporta el mismo mapeo ApprovalStatus -> TimeStatus que ya
// usa esta pantalla (arriba), para que otras vistas que muestran el status
// crudo de un TimeEntry (p.ej. WorkShiftSegmentsPanel en Asistencia) lo
// reusen en vez de duplicar un tercer diccionario para el mismo enum.
export function timeEntryStatusFromApi(status: string): TimeStatus {
  return statusFromApi[status as ApiApprovalStatus] || "Pendiente";
}

async function invalidateTimeEntryDependentCaches(reason: string) {
  await Promise.all([
    invalidateCacheFamily("dashboard", reason),
    invalidateCacheFamily("pending", reason),
    invalidateCacheFamily("time-entries", reason),
  ]);
}

function isTimeEntriesSummary(value: ApiSummaryResponse["data"]) {
  return Boolean(value && typeof value.activeEmployees === "number" && typeof value.pendingEmployees === "number" && typeof value.reviewEmployees === "number");
}

function isEmployeePeriodRowsResponse(value: { items: Array<{ employee: Employee; summary: unknown }>; meta?: unknown }) {
  return Boolean(value && Array.isArray(value.items) && value.items.every((row) => typeof row.employee?.id === "string"));
}

// Etapa 14G.4: `list`/`listByEmployee` (Bandeja de revisión, HoursPage.tsx
// pendingOnly) no pasaban por `cachedData` — sin dedupe in-flight, el
// doble-montaje de React StrictMode en dev disparaba 2 llamadas de red reales
// (mismo síntoma ya resuelto en `getSummary`/`getPeriodEmployees` acá mismo y
// en otras pantallas, ver 14D.5/14F.2). Misma validación mínima que
// `isEmployeePeriodRowsResponse` pero para la vista plana (`items` de
// TimeEntry, no de `{employee, summary}`).
function isTimeEntryListResponse(value: { items: Array<{ id: string }>; meta?: unknown }) {
  return Boolean(value && Array.isArray(value.items) && value.items.every((item) => typeof item.id === "string"));
}

function numberValue(value: string | number | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function periodFromDate(date: string) {
  return date.slice(0, 7);
}

function dayFromDate(date: string) {
  return Number(date.slice(8, 10));
}

function dateFromEntry(entry: Pick<TimeEntry, "period" | "day" | "date">) {
  return entry.date || `${entry.period}-${String(entry.day).padStart(2, "0")}`;
}

export function mapTimeEntryFromApi(item: ApiTimeEntry): TimeEntry {
  const date = item.date.slice(0, 10);
  const hours = numberValue(item.hours);
  // Etapa 11B: multiplicador de Hora Especial de esta fila — 1/ausente
  // significa "sin regla aplicada", igual criterio que la grilla (11A/11A.1).
  const specialHourMultiplier = numberValue(item.appliedMultiplier) || 1;
  return {
    id: item.id,
    employeeId: item.employeeId,
    period: periodFromDate(date),
    day: dayFromDate(date),
    type: item.hourConcept?.name || "Hora normal",
    hours,
    notes: item.observation || "",
    status: statusFromApi[item.status] || "Pendiente",
    date,
    totalMinutes: item.totalMinutes ?? Math.round(hours * 60),
    origin: "MANUAL",
    startTime: item.segmentStartAt || undefined,
    endTime: item.segmentEndAt || undefined,
    createdBy: item.createdByUserId || undefined,
    updatedBy: item.updatedByUserId || undefined,
    conceptId: item.hourConceptId,
    isSpecial: item.hourConcept?.kind !== "NORMAL",
    employeeLegajo: item.employee?.legajo,
    employeeName: item.employee ? `${item.employee.lastName}, ${item.employee.firstName}` : undefined,
    // Sólo el multiplicador y la regla: la equivalencia para liquidación de
    // un registro de Horas base aislado no existe (depende de los conceptos
    // dentro de la jornada de ese día) — la calcula el backend por persona.
    ...(specialHourMultiplier > 1
      ? {
          specialHourMultiplier,
          specialHourRuleNames: (item.timeSegment?.specialHourRuleApplications ?? []).map((application) => application.doubleHourRule.name),
          specialHourConflict: (item.timeSegment?.specialHourRuleApplications ?? []).some((application) => application.wasConflicting),
        }
      : {}),
  };
}

async function resolveHourConceptId(entry: Pick<TimeEntry, "conceptId" | "type">) {
  if (entry.conceptId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.conceptId)) return entry.conceptId;
  const concepts = await hourConceptApiService.getAll({ status: "ACTIVO" });
  const concept = concepts.find((item) => item.name === entry.type);
  if (!concept) throw new Error(`No se encontró la hora especial "${entry.type}" entre los conceptos disponibles.`);
  return concept.id;
}

export const timeEntryApiService = {
  async list(filters: { period?: string; employeeId?: string; status?: TimeStatus; search?: string; costCenterId?: string; page?: number; take?: number; sort?: SortState<TimeEntryListSortKey> } = {}) {
    const params = new URLSearchParams();
    params.set("page", String(filters.page || 1));
    params.set("take", String(filters.take || 25));
    if (filters.period) params.set("period", filters.period);
    if (filters.employeeId) params.set("employeeId", filters.employeeId);
    if (filters.status && statusToApi[filters.status]) params.set("status", statusToApi[filters.status]!);
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    if (filters.costCenterId) params.set("costCenterId", filters.costCenterId);
    appendSortParams(params, filters.sort);
    const key = `/time-entries?${params.toString()}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.timeEntriesAggregates,
      fetcher: () => apiRequest<ApiListResponse & { meta: ApiListMeta }>(key, { apiCache: false }).then((response) => ({
        items: response.data.map(mapTimeEntryFromApi),
        meta: response.meta,
      })),
      validate: isTimeEntryListResponse,
    });
  },

  async listByEmployee(filters: { period?: string; status?: TimeStatus; search?: string; costCenterId?: string; page?: number; take?: number; sort?: SortState<EmployeeRowSortKey> } = {}) {
    const params = new URLSearchParams();
    params.set("view", "byEmployee");
    params.set("page", String(filters.page || 1));
    params.set("take", String(filters.take || 25));
    if (filters.period) params.set("period", filters.period);
    if (filters.status && statusToApi[filters.status]) params.set("status", statusToApi[filters.status]!);
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    if (filters.costCenterId) params.set("costCenterId", filters.costCenterId);
    appendSortParams(params, filters.sort);
    const key = `/time-entries?${params.toString()}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.timeEntriesAggregates,
      fetcher: () => apiRequest<ApiEmployeePeriodRowsResponse>(key, { apiCache: false }).then((response) => ({
        items: response.data.map((row) => ({
          employee: mapEmployeeFromApi(row.employee),
          summary: {
            status: statusFromApi[row.summary.status] || "Pendiente",
            accounting: row.summary.accounting,
            specialHourRuleNames: row.summary.specialHourRuleNames || [],
            specialHourConflict: row.summary.specialHourConflict || false,
          },
        })),
        meta: response.meta,
      })),
      validate: isEmployeePeriodRowsResponse,
    });
  },

  async getAll(filters: { period?: string; employeeId?: string; status?: TimeStatus; take?: number } = {}) {
    const response = await this.list({ ...filters, take: filters.take || 500 });
    return response.items;
  },

  getByPeriod(period: string) {
    return this.getAll({ period });
  },

  async previewWorkShift(input: { employeeId?: string; dni?: string; hourConceptId?: string; startAt: string; endAt: string; observation?: string }) {
    const response = await apiRequest<ApiWorkShiftPreviewResponse>("/time-entries/work-shifts/preview", {
      method: "POST",
      body: { ...input, source: "ADMIN" },
    });
    return response.data;
  },

  async createWorkShift(input: { employeeId?: string; dni?: string; hourConceptId?: string; startAt: string; endAt: string; observation?: string }) {
    const response = await apiRequest<ApiWorkShiftCreateResponse>("/time-entries/work-shifts", {
      method: "POST",
      body: { ...input, source: "ADMIN", confirm: true },
    });
    await invalidateTimeEntryDependentCaches("work shift created");
    return {
      workShift: response.data.workShift,
      preview: response.data.preview,
      entries: response.data.entries.map(mapTimeEntryFromApi),
    };
  },

  // Etapa 14G.9: `getHomeSummary` no tenía dedupe in-flight -- doble-montaje
  // de StrictMode disparaba 2 llamadas de red reales, documentado como
  // pendiente desde 14G.2 (comentario de `homeCounts` en timeEntries.
  // service.ts) y confirmado con el journey de 14G.8 ("Entrar a Inicio":
  // `GET /time-entries/home-summary` x2). Misma familia "time-entries" que
  // el resto de este servicio -- toda mutación de horas ya invalida esta
  // familia vía `invalidateTimeEntryDependentCaches`, sin código nuevo de
  // invalidación.
  async getHomeSummary() {
    const key = "/time-entries/home-summary";
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.timeEntriesAggregates,
      fetcher: () => apiRequest<{ data: HomeSummary }>(key, { apiCache: false }).then((response) => response.data),
      validate: (value: HomeSummary) => Boolean(value && (value.role === "carga" || value.role === "revision")),
    });
  },

  async getSummary(period: string) {
    const params = new URLSearchParams({ period });
    const key = `/time-entries/summary?${params.toString()}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.timeEntriesAggregates,
      fetcher: () => apiRequest<ApiSummaryResponse>(key, { apiCache: false }).then((response) => response.data),
      validate: isTimeEntriesSummary,
    });
  },

  async getPeriodEmployees(filters: { period: string; search?: string; costCenterId?: string; page?: number; take?: number; sort?: SortState<EmployeeRowSortKey> }) {
    const params = new URLSearchParams();
    params.set("period", filters.period);
    params.set("page", String(filters.page || 1));
    params.set("take", String(filters.take || 25));
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    if (filters.costCenterId) params.set("costCenterId", filters.costCenterId);
    appendSortParams(params, filters.sort);
    const key = `/time-entries/period-employees?${params.toString()}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.timeEntriesAggregates,
      fetcher: () => apiRequest<ApiEmployeePeriodRowsResponse>(key, { apiCache: false }).then((response) => ({
        items: response.data.map((row) => ({
          employee: mapEmployeeFromApi(row.employee),
          summary: {
            incidents: row.summary.incidents || 0,
            status: statusFromApi[row.summary.status] || "Pendiente",
            accounting: row.summary.accounting as PeriodAccounting,
            dailyBreakdown: row.summary.dailyBreakdown || [],
          },
        })),
        meta: response.meta,
      })),
      validate: isEmployeePeriodRowsResponse,
    });
  },

  getByEmployee(employeeId: string, period: string) {
    return this.getAll({ employeeId, period });
  },

  async create(entry: Omit<TimeEntry, "id">) {
    const response = await apiRequest<ApiItemResponse>("/time-entries", {
      method: "POST",
      body: {
        employeeId: entry.employeeId,
        hourConceptId: await resolveHourConceptId(entry),
        date: dateFromEntry(entry),
        hours: entry.hours,
        observation: entry.notes || null,
      },
    });
    await invalidateTimeEntryDependentCaches("time entry created");
    return mapTimeEntryFromApi(response.data);
  },

  async update(id: string, entry: Partial<TimeEntry> & { correctionReason?: string }) {
    const body: Record<string, unknown> = {};
    if (entry.conceptId || entry.type) body.hourConceptId = await resolveHourConceptId({ conceptId: entry.conceptId, type: entry.type || "Hora normal" });
    if (entry.period && entry.day) body.date = dateFromEntry(entry as Pick<TimeEntry, "period" | "day" | "date">);
    if (entry.hours !== undefined) body.hours = entry.hours;
    if (entry.notes !== undefined) body.observation = entry.notes || null;
    if (entry.correctionReason) body.correctionReason = entry.correctionReason;
    const response = await apiRequest<ApiItemResponse>(`/time-entries/${id}`, { method: "PATCH", body });
    await invalidateTimeEntryDependentCaches("time entry updated");
    return mapTimeEntryFromApi(response.data);
  },

  async save(entry: Omit<TimeEntry, "id">, options?: { knownExistingId?: string | null }) {
    // Etapa 14C.2 (ampliada): si el llamador ya sabe (por el estado local,
    // ya cargado) si la fila tiene un TimeEntry existente o no, se salta el
    // GET redundante que hacía este método antes de decidir create/update.
    const existingId =
      options && "knownExistingId" in options
        ? options.knownExistingId
        : (await this.getByEmployee(entry.employeeId, entry.period)).find(
            (item) => item.day === entry.day && (item.conceptId === entry.conceptId || item.type === entry.type),
          )?.id;
    const saved = existingId ? await this.update(existingId, entry) : await this.create(entry);
    if (entry.status === "En revisión" && saved.status !== "En revisión") {
      return this.submit(saved.id);
    }
    return saved;
  },

  async submit(id: string) {
    const response = await apiRequest<ApiItemResponse>(`/time-entries/${id}/submit`, { method: "POST" });
    await invalidateTimeEntryDependentCaches("time entry submitted");
    return mapTimeEntryFromApi(response.data);
  },

  async approve(id: string) {
    const response = await apiRequest<ApiItemResponse>(`/time-entries/${id}/approve`, { method: "POST" });
    await invalidateTimeEntryDependentCaches("time entry approved");
    return mapTimeEntryFromApi(response.data);
  },

  async reject(id: string, reason: string) {
    const response = await apiRequest<ApiItemResponse>(`/time-entries/${id}/reject`, {
      method: "POST",
      body: { reason },
    });
    await invalidateTimeEntryDependentCaches("time entry rejected");
    return mapTimeEntryFromApi(response.data);
  },

  async returnForCorrection(id: string, reason: string) {
    const response = await apiRequest<ApiItemResponse>(`/time-entries/${id}/return`, {
      method: "POST",
      body: { reason },
    });
    await invalidateTimeEntryDependentCaches("time entry returned");
    return mapTimeEntryFromApi(response.data);
  },

  async getPeriodExport(period: string, includeInReview = false) {
    const params = new URLSearchParams({ period, includeInReview: String(includeInReview) });
    const response = await apiRequest<ApiExportResponse>(`/time-entries/export?${params.toString()}`);
    return { columns: response.data.columns, rows: response.data.rows };
  },

  canEdit: (entry?: TimeEntry) => !entry || !lockedStatuses.has(entry.status),
  canReview: (user: User) => user.role === "Nivel 1 - RRHH" || user.role.startsWith("Nivel 2"),
  // Etapa 6L.3 (ajuste): aprobar/rechazar/devolver una carga horaria es
  // exclusivo de RRHH — a diferencia de canReview (que también habilita la
  // corrección administrativa de una carga ya aprobada, sin cambios acá).
  canApprove: (user: User) => user.role === "Nivel 1 - RRHH",
  isCountableStatus: (status: TimeStatus) => countableStatuses.has(status),
  isExportableStatus: (status: TimeStatus) => exportableStatuses.has(status),
};
