import { apiRequest } from "./apiClient";
import { mapEmployeeFromApi } from "./employeeApiService";
import { hourConceptApiService } from "./hourConceptApiService";
import type { Employee, TimeEntry, TimeStatus, User } from "../../types";
import type { HoursExportRow } from "../../utils/hoursExport";

type ApiApprovalStatus =
  | "BORRADOR"
  | "PENDIENTE"
  | "EN_REVISION"
  | "APROBADO"
  | "RECHAZADO"
  | "DEVUELTO"
  | "CERRADO";

type ApiTimeEntry = {
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

type ApiEmployeePeriodRow = {
  employee: Parameters<typeof mapEmployeeFromApi>[0];
  summary: {
    total: number;
    status: ApiApprovalStatus;
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
    rows: Array<{
      CUIL: string;
      Apellido: string;
      Nombre: string;
      Legajo: string;
      Empresa: string;
      "Centro de costo": string;
      "Horas normales": string;
      "Horas especiales": string;
      "Horas trabajadas totales": string;
      Estado: string;
    }>;
  };
};

const countableStatuses = new Set<TimeStatus>(["Aprobado", "En revisión"]);
const exportableStatuses = new Set<TimeStatus>(["Aprobado"]);
const lockedStatuses = new Set<TimeStatus>(["Aprobado", "Cerrado", "Exportado"]);
const statusPriority: TimeStatus[] = ["En revisión", "Rechazado", "Pendiente", "Borrador", "Aprobado", "Cerrado", "Exportado"];

const statusFromApi: Record<ApiApprovalStatus, TimeStatus> = {
  BORRADOR: "Borrador",
  PENDIENTE: "Pendiente",
  EN_REVISION: "En revisión",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
  DEVUELTO: "Pendiente",
  CERRADO: "Cerrado",
};

const statusToApi: Partial<Record<TimeStatus, ApiApprovalStatus>> = {
  Borrador: "BORRADOR",
  Pendiente: "PENDIENTE",
  "En revisión": "EN_REVISION",
  Aprobado: "APROBADO",
  Rechazado: "RECHAZADO",
  Cerrado: "CERRADO",
};

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

function mapFromApi(item: ApiTimeEntry): TimeEntry {
  const date = item.date.slice(0, 10);
  const hours = numberValue(item.hours);
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
  };
}

function resolveEmployeePeriodStatus(entries: TimeEntry[]) {
  return statusPriority.find((status) => entries.some((entry) => entry.status === status)) || "Pendiente";
}

function summarizePeriodEntries(entries: TimeEntry[]) {
  const countable = entries.filter((entry) => countableStatuses.has(entry.status));
  const approved = entries.filter((entry) => entry.status === "Aprobado");
  const special = countable.filter((entry) => entry.isSpecial || entry.type !== "Hora normal");
  return {
    entries,
    countable,
    approved,
    total: countable.reduce((sum, entry) => sum + entry.hours, 0),
    normalHours: countable.filter((entry) => entry.type === "Hora normal").reduce((sum, entry) => sum + entry.hours, 0),
    specialHours: special.reduce((sum, entry) => sum + entry.hours, 0),
    approvedHours: approved.reduce((sum, entry) => sum + entry.hours, 0),
    reviewHours: entries.filter((entry) => entry.status === "En revisión").reduce((sum, entry) => sum + entry.hours, 0),
    daysWithEntries: new Set(entries.map((entry) => entry.day)).size,
    status: resolveEmployeePeriodStatus(entries),
  };
}

async function resolveHourConceptId(entry: Pick<TimeEntry, "conceptId" | "type">) {
  if (entry.conceptId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.conceptId)) return entry.conceptId;
  const concepts = await hourConceptApiService.getAll({ status: "ACTIVO" });
  const concept = concepts.find((item) => item.name === entry.type);
  if (!concept) throw new Error(`No se encontró la hora especial "${entry.type}" en backend.`);
  return concept.id;
}

function toExportRow(row: ApiExportResponse["data"]["rows"][number]): HoursExportRow {
  return {
    cuil: row.CUIL,
    apellido: row.Apellido,
    nombre: row.Nombre,
    legajo: row.Legajo,
    empresa: row.Empresa,
    centroCosto: row["Centro de costo"],
    horasNormales: numberValue(row["Horas normales"]),
    horasEspeciales: numberValue(row["Horas especiales"]),
    horasTotales: numberValue(row["Horas trabajadas totales"]),
    estado: row.Estado,
  };
}

export const timeEntryApiService = {
  async list(filters: { period?: string; employeeId?: string; status?: TimeStatus; search?: string; costCenterId?: string; page?: number; take?: number } = {}) {
    const params = new URLSearchParams();
    params.set("page", String(filters.page || 1));
    params.set("take", String(filters.take || 25));
    if (filters.period) params.set("period", filters.period);
    if (filters.employeeId) params.set("employeeId", filters.employeeId);
    if (filters.status && statusToApi[filters.status]) params.set("status", statusToApi[filters.status]!);
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    if (filters.costCenterId) params.set("costCenterId", filters.costCenterId);
    const query = params.toString();
    const response = await apiRequest<ApiListResponse & { meta: ApiListMeta }>(`/time-entries${query ? `?${query}` : ""}`);
    return {
      items: response.data.map(mapFromApi),
      meta: response.meta,
    };
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
    return {
      workShift: response.data.workShift,
      preview: response.data.preview,
      entries: response.data.entries.map(mapFromApi),
    };
  },

  async getSummary(period: string) {
    const params = new URLSearchParams({ period });
    const response = await apiRequest<ApiSummaryResponse>(`/time-entries/summary?${params.toString()}`);
    return response.data;
  },

  async getPeriodEmployees(filters: { period: string; search?: string; costCenterId?: string; page?: number; take?: number }) {
    const params = new URLSearchParams();
    params.set("period", filters.period);
    params.set("page", String(filters.page || 1));
    params.set("take", String(filters.take || 25));
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    if (filters.costCenterId) params.set("costCenterId", filters.costCenterId);
    const response = await apiRequest<ApiEmployeePeriodRowsResponse>(`/time-entries/period-employees?${params.toString()}`);
    return {
      items: response.data.map((row) => ({
        employee: mapEmployeeFromApi(row.employee),
        summary: {
          total: row.summary.total,
          status: statusFromApi[row.summary.status] || "Pendiente",
        },
      })),
      meta: response.meta,
    };
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
    return mapFromApi(response.data);
  },

  async update(id: string, entry: Partial<TimeEntry>) {
    const body: Record<string, unknown> = {};
    if (entry.conceptId || entry.type) body.hourConceptId = await resolveHourConceptId({ conceptId: entry.conceptId, type: entry.type || "Hora normal" });
    if (entry.period && entry.day) body.date = dateFromEntry(entry as Pick<TimeEntry, "period" | "day" | "date">);
    if (entry.hours !== undefined) body.hours = entry.hours;
    if (entry.notes !== undefined) body.observation = entry.notes || null;
    const response = await apiRequest<ApiItemResponse>(`/time-entries/${id}`, { method: "PATCH", body });
    return mapFromApi(response.data);
  },

  async save(entry: Omit<TimeEntry, "id">) {
    const existing = (await this.getByEmployee(entry.employeeId, entry.period)).find(
      (item) => item.day === entry.day && (item.conceptId === entry.conceptId || item.type === entry.type),
    );
    const saved = existing ? await this.update(existing.id, entry) : await this.create(entry);
    if (entry.status === "En revisión" && saved.status !== "En revisión") {
      return this.submit(saved.id);
    }
    return saved;
  },

  async submit(id: string) {
    const response = await apiRequest<ApiItemResponse>(`/time-entries/${id}/submit`, { method: "POST" });
    return mapFromApi(response.data);
  },

  async approve(id: string) {
    const response = await apiRequest<ApiItemResponse>(`/time-entries/${id}/approve`, { method: "POST" });
    return mapFromApi(response.data);
  },

  async reject(id: string, reason: string) {
    const response = await apiRequest<ApiItemResponse>(`/time-entries/${id}/reject`, {
      method: "POST",
      body: { reason },
    });
    return mapFromApi(response.data);
  },

  async returnForCorrection(id: string, reason: string) {
    const response = await apiRequest<ApiItemResponse>(`/time-entries/${id}/return`, {
      method: "POST",
      body: { reason },
    });
    return mapFromApi(response.data);
  },

  async getPeriodExportRows(period: string, includeInReview = false) {
    const params = new URLSearchParams({ period, includeInReview: String(includeInReview) });
    const response = await apiRequest<ApiExportResponse>(`/time-entries/export?${params.toString()}`);
    return response.data.rows.map(toExportRow);
  },

  canEdit: (entry?: TimeEntry) => !entry || !lockedStatuses.has(entry.status),
  canReview: (user: User) => user.role === "Nivel 1 - RRHH" || user.role.startsWith("Nivel 2"),
  isCountableStatus: (status: TimeStatus) => countableStatuses.has(status),
  isExportableStatus: (status: TimeStatus) => exportableStatuses.has(status),
  getEmployeePeriodSummary: (entries: TimeEntry[], employeeId: string) => summarizePeriodEntries(entries.filter((entry) => entry.employeeId === employeeId)),
  getPeriodExportRowsFromEntries: (period: string, employees: Employee[], entries: TimeEntry[]) => {
    return employees.map((employee) => {
      const summary = summarizePeriodEntries(entries.filter((entry) => entry.employeeId === employee.id && entry.period === period));
      return {
        cuil: employee.cuil,
        apellido: employee.lastName,
        nombre: employee.firstName,
        legajo: employee.legajoInterno || employee.legajoFinnegans || employee.legajo || "Sin cargar",
        empresa: employee.company,
        centroCosto: employee.costCenter,
        horasNormales: summary.approved.filter((entry) => entry.type === "Hora normal").reduce((sum, entry) => sum + entry.hours, 0),
        horasEspeciales: summary.approved.filter((entry) => entry.type !== "Hora normal").reduce((sum, entry) => sum + entry.hours, 0),
        horasTotales: summary.approved.reduce((sum, entry) => sum + entry.hours, 0),
        estado: summary.status,
      };
    }).filter((row) => row.horasTotales > 0);
  },
};
