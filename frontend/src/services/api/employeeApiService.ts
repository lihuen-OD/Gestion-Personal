import { apiRequest } from "./apiClient";
import { hourConceptApiService, mapHourConceptFromApi } from "./hourConceptApiService";
import { mapNoveltyFromApi } from "./noveltyApiService";
import { mapNoveltyTypeFromApi } from "./noveltyTypeApiService";
import { orgStructureApiService } from "./orgStructureApiService";
import { positionApiService } from "./positionApiService";
import { mapTimeEntryFromApi, type ApiTimeEntry } from "./timeEntryApiService";
import { userApiService } from "./userApiService";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";
import { currentCacheScope } from "../cache/cacheKey";
import { calculateLaborStatus, resolveCurrentLaborPeriod } from "../employeeStatusService";
import type { Employee, EmployeeStatus, LaborMovement, Novelty, TimeEntry } from "../../types";
import type { HourConcept } from "../../types/hourConcept.types";
import type { NoveltyType } from "../../types/noveltyType.types";

type ApiEmployeeStatus = "ACTIVO" | "INACTIVO";

type ApiEmployee = {
  id: string;
  legajo: string;
  legajoFinnegans?: string | null;
  cuil?: string;
  dni?: string;
  firstName: string;
  lastName: string;
  birthDate?: string | null;
  gender?: string | null;
  civilStatus?: string | null;
  nationality?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  emergencyContact?: string | null;
  emergencyRelation?: string | null;
  emergencyPhone?: string | null;
  status: ApiEmployeeStatus;
  healthInsurance?: string | null;
  agreement?: string | null;
  receiptCategory?: string | null;
  internalCategory?: string | null;
  sector?: {
    id: string;
    name: string;
    area?: {
      name?: string | null;
      establishment?: { name?: string | null; businessUnit?: { name?: string | null } | null } | null;
    } | null;
  } | null;
  costCenter?: { id: string; name: string; code?: string | null } | null;
  position?: { id: string; name: string; code?: string | null } | null;
  companies?: Array<{ isPrimary?: boolean; company: { id: string; name: string } }>;
  address?: {
    province?: string | null;
    department?: string | null;
    city?: string | null;
    street?: string | null;
    streetNumber?: string | null;
    postalCode?: string | null;
    latitude?: string | number | null;
    longitude?: string | number | null;
    mapLabel?: string | null;
  } | null;
  transport?: {
    usesCompanyTransport?: boolean;
    locality?: string | null;
    pickupAddress?: string | null;
    pickupReference?: string | null;
    busLine?: string | null;
    schedule?: string | null;
    observation?: string | null;
  } | null;
  assignments?: Array<{
    type: "DIRECT_MANAGER" | "TIME_RESPONSIBLE";
    userId?: string | null;
    personName?: string | null;
    role?: string | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    status?: string | null;
    notes?: string | null;
  }>;
  hourConcepts?: Array<{
    hourConceptId: string;
    hourConcept: Parameters<typeof mapHourConceptFromApi>[0];
  }>;
  laborMovements?: Array<{
    id: string;
    employeeId?: string;
    type: "ALTA" | "BAJA";
    effectiveFrom: string;
    reason: string;
    observation?: string | null;
    createdAt: string;
    createdByUserId?: string | null;
    createdBy?: { id: string; name: string } | null;
  }>;
  createdAt?: string;
  updatedAt?: string;
};

type ApiEmployeeListResponse = { data: ApiEmployee[] };
type ApiEmployeeItemResponse = { data: ApiEmployee };
type ApiLaborStatusSyncResponse = { data: { scanned: number; updated: number } };
type ApiListMeta = { total: number; page: number; pageSize: number; hasMore: boolean };
type ApiEmployeePaginatedResponse = ApiEmployeeListResponse & { meta: ApiListMeta };
type ApiEmployeeSummaryResponse = {
  data: {
    total: number;
    active: number;
    inactive: number;
    missingTimeResponsible: number;
    pendingTimeLoads: number;
  };
};

// Etapa 11B: Horas Especiales por día en el detalle por legajo — mismo
// criterio ya usado en la grilla de período (11A/11A.1), sólo se incluye la
// clave del día cuando hay un multiplicador > 1.
export type ApiTimeGridSpecialHourDay = {
  multiplier: number;
  additionalMinutes: number;
  liquidableTotalMinutes: number;
  ruleNames: string[];
  conflict: boolean;
};

type ApiTimeGridResponse = {
  data: {
    employee: ApiEmployee;
    entries: ApiTimeEntry[];
    novelties: Parameters<typeof mapNoveltyFromApi>[0][];
    noveltyTypes: Parameters<typeof mapNoveltyTypeFromApi>[0][];
    hourConcepts: Parameters<typeof mapHourConceptFromApi>[0][];
    rows: Array<{
      concept: Parameters<typeof mapHourConceptFromApi>[0];
      role: "NORMAL_BASE" | "ADDITIONAL";
      minutesByDay: Record<string, number>;
      totalMinutes: number;
    }>;
    totalWorkedMinutes: number;
    attendanceIssues: number;
    specialHoursByDay?: Record<string, ApiTimeGridSpecialHourDay>;
    specialHourAdditionalMinutes?: number;
    specialHourLiquidableTotalMinutes?: number;
  };
};

export type EmployeeTimeGridRow = {
  concept: HourConcept;
  role: "NORMAL_BASE" | "ADDITIONAL";
  minutesByDay: Record<string, number>;
  totalMinutes: number;
};

export type EmployeeTimeGrid = {
  employee: Employee;
  entries: TimeEntry[];
  novelties: Novelty[];
  noveltyTypes: NoveltyType[];
  hourConcepts: HourConcept[];
  rows: EmployeeTimeGridRow[];
  totalWorkedMinutes: number;
  attendanceIssues: number;
  specialHoursByDay: Record<string, ApiTimeGridSpecialHourDay>;
  specialHourAdditionalMinutes: number;
  specialHourLiquidableTotalMinutes: number;
};

export type ManualHourConceptBreakdownInput = {
  date: string;
  hourConceptId: string;
  minutes: number;
  observation?: string | null;
};

export type RecalculateAutomaticHourConceptBreakdownsResult = {
  employeeId: string;
  period: string;
  processedShifts: number;
  eligibleConcepts: number;
  generated: number;
  removed: number;
};

export type EmployeeListFilters = {
  search?: string;
  companyId?: string;
  // El backend ya soporta estos dos con WHERE indexado (ver auditoría 8E) —
  // antes no estaban conectados acá, así que ningún filtro de sector/centro
  // de costo llegaba nunca a /employees.
  sectorId?: string;
  costCenterId?: string;
  status?: "ACTIVO" | "INACTIVO";
  page?: number;
  take?: number;
};

export type EmployeeSummary = ApiEmployeeSummaryResponse["data"];

export type EmployeePositionValidation = {
  tone: "success" | "warning" | "danger" | "neutral";
  title: string;
  categoryText: string;
  checks: Array<{ label: string; value: string; allowed: string[]; ok: boolean; missing: boolean }>;
  category: { status: string; value: string; range: string[] };
};

type ApiEmployeePositionValidationResponse = { data: EmployeePositionValidation };

const emptyMap = { lat: null, lng: null, source: "API" as const, label: "" };

function dateOnly(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

function toFrontendStatus(status: ApiEmployeeStatus): EmployeeStatus {
  return status === "INACTIVO" ? "Inactivo" : "Activo";
}

function toApiStatus(status: EmployeeStatus): ApiEmployeeStatus {
  return status === "Inactivo" ? "INACTIVO" : "ACTIVO";
}

function compact(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean))) as string[];
}

function asNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapLaborMovements(items: ApiEmployee["laborMovements"] = [], employeeId?: string): LaborMovement[] {
  return items.filter((item) => !item.employeeId || !employeeId || item.employeeId === employeeId).map((item) => ({
    id: item.id,
    type: item.type,
    effectiveFrom: dateOnly(item.effectiveFrom),
    reason: item.reason,
    observation: item.observation || "",
    createdAt: item.createdAt,
    createdByUserId: item.createdByUserId || item.createdBy?.id || "",
    createdByUserName: item.createdBy?.name || "Sistema",
  }));
}

export function mapEmployeeFromApi(item: ApiEmployee): Employee {
  const companies = compact((item.companies || []).map((link) => link.company?.name));
  const primaryCompany = item.companies?.find((link) => link.isPrimary)?.company.name || companies[0] || "";
  const directManagers = compact((item.assignments || []).filter((link) => link.type === "DIRECT_MANAGER").map((link) => link.personName));
  const timeResponsibles = compact((item.assignments || []).filter((link) => link.type === "TIME_RESPONSIBLE").map((link) => link.personName));
  const directManagerAssignment = item.assignments?.find((link) => link.type === "DIRECT_MANAGER");
  const timeResponsibleAssignment = item.assignments?.find((link) => link.type === "TIME_RESPONSIBLE");
  const address = item.address;
  const mapLocation = {
    lat: asNumber(address?.latitude),
    lng: asNumber(address?.longitude),
    source: "API" as const,
    label: address?.mapLabel || [address?.street, address?.streetNumber, address?.city].filter(Boolean).join(" "),
  };
  const laborMovements = mapLaborMovements(item.laborMovements, item.id);
  const currentLaborPeriod = resolveCurrentLaborPeriod(laborMovements);
  const status = laborMovements.length ? calculateLaborStatus(laborMovements).status : toFrontendStatus(item.status);

  return {
    id: item.id,
    legajo: item.legajo,
    legajoInterno: item.legajo,
    legajoFinnegans: item.legajoFinnegans || "",
    firstName: item.firstName,
    lastName: item.lastName,
    dni: item.dni || "",
    cuil: item.cuil || "",
    birthDate: dateOnly(item.birthDate),
    gender: item.gender || "",
    civilStatus: item.civilStatus || "",
    nationality: item.nationality || "Argentina",
    phone: item.phone || "",
    mobile: item.mobile || "",
    email: item.email || "",
    address: address?.street || "",
    addressStreet: address?.street || "",
    addressNumber: address?.streetNumber || "",
    city: address?.city || "",
    department: address?.department || "",
    province: address?.province || "",
    zip: address?.postalCode || "",
    domicilio: {
      calle: address?.street || "",
      numero: address?.streetNumber || "",
      provinciaId: "",
      provinciaNombre: address?.province || "",
      departamentoId: "",
      departamentoNombre: address?.department || "",
      localidadId: "",
      localidadNombre: address?.city || "",
      codigoPostal: address?.postalCode || "",
      ubicacionMapa: mapLocation,
      direccionNormalizada: mapLocation.label,
      fuenteGeocoding: address?.mapLabel ? "MANUAL_MARKER" : undefined,
    },
    emergencyContact: item.emergencyContact || "",
    emergencyRelation: item.emergencyRelation || "",
    emergencyPhone: item.emergencyPhone || "",
    company: primaryCompany,
    companies,
    businessUnit: item.sector?.area?.establishment?.businessUnit?.name || "",
    establishment: item.sector?.area?.establishment?.name || "",
    costCenter: item.costCenter?.name || "",
    sector: item.sector?.name || "",
    position: item.position?.name || "",
    positionId: item.position?.id,
    puestoId: item.position?.id,
    puestoNombre: item.position?.name || "",
    receiptCategory: item.receiptCategory || "",
    internalCategory: item.internalCategory || "",
    agreement: item.agreement || "",
    healthInsurance: item.healthInsurance || "",
    directManager: directManagers[0] || "",
    directManagers,
    timeResponsible: timeResponsibles[0] || "",
    timeResponsibles,
    startDate: currentLaborPeriod.startDate,
    endDate: currentLaborPeriod.endDate,
    exitReason: currentLaborPeriod.exitReason,
    transport: Boolean(item.transport?.usesCompanyTransport),
    transportLocality: item.transport?.locality || "",
    transportRoute: item.transport?.busLine || "",
    transportNotes: item.transport?.observation || item.transport?.pickupReference || "",
    enabledHours: (item.hourConcepts || [])
      .filter((link) => link.hourConcept.systemRole !== "NORMAL_BASE")
      .map((link) => link.hourConcept.name),
    enabledHourConcepts: (item.hourConcepts || [])
      .filter((link) => link.hourConcept.systemRole !== "NORMAL_BASE" && Boolean(link.hourConcept.loadMode))
      .map((link) => ({ ...mapHourConceptFromApi(link.hourConcept), enabled: true as const })),
    status,
    laborMovements,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    directManagerFrom: dateOnly(directManagerAssignment?.effectiveFrom),
    directManagerTo: dateOnly(directManagerAssignment?.effectiveTo),
    directManagerStatus: directManagerAssignment?.status || "",
    directManagerNotes: directManagerAssignment?.notes || "",
    timeResponsibleRole: timeResponsibleAssignment?.role || "",
    timeResponsibleFrom: dateOnly(timeResponsibleAssignment?.effectiveFrom),
    timeResponsibleTo: dateOnly(timeResponsibleAssignment?.effectiveTo),
    timeResponsibleStatus: timeResponsibleAssignment?.status || "",
    timeResponsibleNotes: timeResponsibleAssignment?.notes || "",
    mapLocation: mapLocation.label,
    locationMap: mapLocation,
    novelties: [],
    documents: [],
    historyEvents: [],
    audit: [],
    routeHistory: [],
  };
}

async function resolveRelations(employee: Employee) {
  // Etapa 14D.4: sólo hace falta id/name para resolver positionId por
  // nombre (`puestoNombre`) al guardar — getOptions() (catálogo liviano)
  // en vez de getAll() (registro completo de Position).
  const [catalog, positions] = await Promise.all([
    orgStructureApiService.getCatalog().catch(() => null),
    positionApiService.getOptions().catch(() => []),
  ]);
  const companyNames = compact([...(employee.companies || []), employee.company]);
  const companyIds = compact(companyNames.map((name) => catalog?.companies.find((item) => item.name === name)?.id));
  const primaryCompanyId = companyIds[0] || undefined;
  const sectorId = catalog?.sectors.find((item) => item.name === employee.sector)?.id;
  const costCenterId = catalog?.costCenters.find((item) => item.name === employee.costCenter || item.code === employee.costCenter)?.id;
  const positionId = employee.positionId || employee.puestoId || positions.find((item) => item.name === employee.puestoNombre || item.name === employee.position)?.id;
  return {
    companyIds,
    primaryCompanyId,
    sectorId,
    costCenterId,
    positionId,
    companiesResolved: Boolean(catalog) && (!companyNames.length || companyIds.length === companyNames.length),
    sectorResolved: Boolean(catalog) && (!employee.sector || Boolean(sectorId)),
    costCenterResolved: Boolean(catalog) && (!employee.costCenter || Boolean(costCenterId)),
    positionResolved: Boolean(employee.positionId || employee.puestoId) || !(employee.puestoNombre || employee.position) || Boolean(positionId),
  };
}

async function mapEmployeeToApi(employee: Employee, mode: "create" | "update" = "create") {
  const relations = await resolveRelations(employee);
  const shouldSendAllRelations = mode === "create";
  const createHourConcepts = mode === "create" && employee.enabledHours?.length ? await hourConceptsPayload(employee) : { hourConceptIds: [] };
  return {
    legajo: employee.legajoInterno || employee.legajo,
    legajoFinnegans: employee.legajoFinnegans || null,
    cuil: employee.cuil,
    dni: employee.dni,
    firstName: employee.firstName,
    lastName: employee.lastName,
    birthDate: employee.birthDate || null,
    gender: employee.gender || null,
    civilStatus: employee.civilStatus || null,
    nationality: employee.nationality || null,
    email: employee.email || null,
    phone: employee.phone || null,
    mobile: employee.mobile || null,
    emergencyContact: employee.emergencyContact || null,
    emergencyRelation: employee.emergencyRelation || null,
    emergencyPhone: employee.emergencyPhone || null,
    status: toApiStatus(employee.status),
    ...(shouldSendAllRelations || relations.positionResolved ? { positionId: relations.positionId || null } : {}),
    ...(shouldSendAllRelations || relations.sectorResolved ? { sectorId: relations.sectorId || null } : {}),
    ...(shouldSendAllRelations || relations.costCenterResolved ? { costCenterId: relations.costCenterId || null } : {}),
    healthInsurance: employee.healthInsurance || null,
    agreement: employee.agreement || null,
    receiptCategory: employee.receiptCategory || null,
    internalCategory: employee.internalCategory || null,
    ...(shouldSendAllRelations || relations.companiesResolved
      ? {
          companyIds: relations.companyIds,
          primaryCompanyId: relations.primaryCompanyId || null,
        }
      : {}),
    address: {
      province: employee.province || employee.domicilio?.provinciaNombre || null,
      department: employee.department || employee.domicilio?.departamentoNombre || null,
      city: employee.city || employee.domicilio?.localidadNombre || null,
      street: employee.addressStreet || employee.domicilio?.calle || null,
      streetNumber: employee.addressNumber || employee.domicilio?.numero || null,
      postalCode: employee.zip || employee.domicilio?.codigoPostal || null,
      latitude: employee.domicilio?.ubicacionMapa?.lat ?? employee.locationMap?.lat ?? null,
      longitude: employee.domicilio?.ubicacionMapa?.lng ?? employee.locationMap?.lng ?? null,
      mapLabel: employee.domicilio?.ubicacionMapa?.label || employee.locationMap?.label || employee.mapLocation || null,
    },
    ...(mode === "create" && createHourConcepts.hourConceptIds.length
      ? { hourConceptIds: createHourConcepts.hourConceptIds }
      : {}),
    ...(mode === "create" && employee.startDate
      ? {
          initialLaborMovement: {
            type: "ALTA",
            effectiveFrom: employee.startDate,
            reason: employee.laborMovements?.[0]?.reason || "Alta inicial",
            observation: employee.laborMovements?.[0]?.observation || null,
          },
        }
      : {}),
  };
}

function addressPayload(employee: Employee) {
  return {
    province: employee.province || employee.domicilio?.provinciaNombre || null,
    department: employee.department || employee.domicilio?.departamentoNombre || null,
    city: employee.city || employee.domicilio?.localidadNombre || null,
    street: employee.addressStreet || employee.domicilio?.calle || null,
    streetNumber: employee.addressNumber || employee.domicilio?.numero || null,
    postalCode: employee.zip || employee.domicilio?.codigoPostal || null,
    latitude: employee.domicilio?.ubicacionMapa?.lat ?? employee.locationMap?.lat ?? null,
    longitude: employee.domicilio?.ubicacionMapa?.lng ?? employee.locationMap?.lng ?? null,
    mapLabel: employee.domicilio?.ubicacionMapa?.label || employee.locationMap?.label || employee.mapLocation || null,
  };
}

function transportPayload(employee: Employee) {
  return {
    usesCompanyTransport: Boolean(employee.transport),
    locality: employee.transportLocality || employee.city || null,
    pickupAddress: employee.addressStreet || null,
    pickupReference: null,
    busLine: employee.transportRoute || null,
    schedule: null,
    observation: employee.transportNotes || null,
  };
}

async function assignmentsPayload(employee: Employee) {
  const directManagerNames = employee.directManagers || (employee.directManager ? [employee.directManager] : []);
  const timeResponsibleNames = employee.timeResponsibles || (employee.timeResponsible ? [employee.timeResponsible] : []);
  if (!directManagerNames.length && !timeResponsibleNames.length) return { assignments: [] };

  const users = timeResponsibleNames.length ? await userApiService.getAll().catch(() => []) : [];
  const userByName = new Map(users.map((user) => [user.employeeName || user.name, user]));
  const assignments = [
    ...directManagerNames.map((personName) => ({
      type: "DIRECT_MANAGER" as const,
      personName,
      role: null,
      effectiveFrom: employee.directManagerFrom || null,
      effectiveTo: employee.directManagerTo || null,
      status: employee.directManagerStatus || null,
      notes: employee.directManagerNotes || null,
    })),
    ...timeResponsibleNames.map((personName) => {
      const linkedUser = userByName.get(personName);
      return {
        type: "TIME_RESPONSIBLE" as const,
        userId: linkedUser?.id || null,
        personName,
        role: employee.timeResponsibleRole || null,
        effectiveFrom: employee.timeResponsibleFrom || null,
        effectiveTo: employee.timeResponsibleTo || null,
        status: employee.timeResponsibleStatus || null,
        notes: employee.timeResponsibleNotes || null,
      };
    }),
  ].filter((item) => item.personName?.trim());
  return { assignments };
}

async function hourConceptsPayload(employee: Employee) {
  if (employee.enabledHourConcepts) {
    return { hourConceptIds: Array.from(new Set(employee.enabledHourConcepts.map((concept) => concept.id))) };
  }
  const concepts = await hourConceptApiService.getAll().catch(() => []);
  const assignable = concepts.filter((item) => item.systemRole !== "NORMAL_BASE" && item.status === "ACTIVO" && Boolean(item.loadMode));
  const hourConceptIds = compact(employee.enabledHours.map((name) => assignable.find((item) => item.name === name)?.id));
  return { hourConceptIds };
}

async function syncEmployeeExtras(
  employeeId: string,
  employee: Employee,
  options: { createInitialMovement?: boolean; syncHourConcepts?: boolean } = {},
) {
  const requests: Promise<unknown>[] = [];

  if (employee.transport || employee.transportRoute || employee.transportNotes) {
    requests.push(
      apiRequest(`/employees/${employeeId}/transport`, {
        method: "PUT",
        body: transportPayload(employee),
      }),
    );
  }

  const { assignments } = await assignmentsPayload(employee);
  if (assignments.length) {
    requests.push(
      apiRequest(`/employees/${employeeId}/assignments`, {
        method: "PUT",
        body: { assignments },
      }),
    );
  }

  if (options.syncHourConcepts !== false && employee.enabledHours?.length) {
    const { hourConceptIds } = await hourConceptsPayload(employee);
    if (hourConceptIds.length) {
      requests.push(
        apiRequest(`/employees/${employeeId}/hour-concepts`, {
          method: "PUT",
          body: { hourConceptIds },
        }),
      );
    }
  }

  if (options.createInitialMovement && employee.startDate) {
    requests.push(
      apiRequest(`/employees/${employeeId}/labor-movements`, {
        method: "POST",
        body: {
          type: "ALTA",
          effectiveFrom: employee.startDate,
          reason: employee.laborMovements?.[0]?.reason || "Alta inicial",
          observation: employee.laborMovements?.[0]?.observation || null,
        },
      }),
    );
  }

  await Promise.all(requests);
}

async function invalidateEmployeeDependentCaches(reason: string) {
  employeeListSnapshots.clear();
  await Promise.all([
    invalidateCacheFamily("employees", reason),
    invalidateCacheFamily("dashboard", reason),
    invalidateCacheFamily("positions", reason),
  ]);
}

// Etapa 11A: los 5 mutadores de HourConceptBreakdown manual/automático no
// invalidaban ningún cache de frontend — el backend ya limpiaba su propio
// cache de time-entries acá desde la Etapa 7A (clearTimeEntriesReadCaches en
// employees.controller.ts), pero esa es una capa independiente. Sin esto, la
// columna "Especiales" de la grilla de período (family "time-entries") y la
// Bandeja de revisión (family "pending", para los 4 mutadores que cambian
// status EN_REVISION) podían quedar hasta 30s desactualizadas tras guardar,
// aprobar, rechazar o devolver un desglose manual.
async function invalidateHourConceptBreakdownDependentCaches(reason: string) {
  await Promise.all([
    invalidateCacheFamily("time-entries", reason),
    invalidateCacheFamily("pending", reason),
  ]);
}

type EmployeeListResult = { items: Employee[]; meta: ApiListMeta };
export const ORG_CHART_EMPLOYEE_LIMIT = 1000;

export function orgChartReachedLimit(result: EmployeeListResult): boolean {
  return result.meta.hasMore || result.items.length >= ORG_CHART_EMPLOYEE_LIMIT;
}

const employeeListSnapshots = new Map<string, EmployeeListResult>();

export function employeeListRequest(filters: EmployeeListFilters = {}) {
  const params = new URLSearchParams();
  params.set("page", String(filters.page || 1));
  params.set("take", String(filters.take || 25));
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.sectorId) params.set("sectorId", filters.sectorId);
  if (filters.costCenterId) params.set("costCenterId", filters.costCenterId);
  if (filters.status) params.set("status", filters.status);
  const path = `/employees?${params.toString()}`;
  return { path, snapshotKey: `${currentCacheScope()}:${path}` };
}

function isEmployeeOptionsResponse(value: { items: Employee[]; meta?: unknown }) {
  return Boolean(value && Array.isArray(value.items) && value.items.every((item) => typeof item.id === "string" && typeof item.firstName === "string" && typeof item.lastName === "string"));
}

function isEmployeeSummary(value: EmployeeSummary) {
  return Boolean(value && typeof value.total === "number" && typeof value.active === "number" && typeof value.inactive === "number");
}

// Etapa 14D.5: validador mínimo para overview/overview-details — mismo
// criterio que isEmployeeOptionsResponse, sólo que sobre un Employee único.
function isEmployeeDetail(value: Employee) {
  return Boolean(value && typeof value.id === "string" && typeof value.firstName === "string" && typeof value.lastName === "string");
}

export const employeeApiService = {
  async list(filters: EmployeeListFilters = {}) {
    const { path, snapshotKey } = employeeListRequest(filters);
    const result = await cachedData({
      requestKey: `GET:${path}`,
      policy: cachePolicies.employeesList,
      fetcher: () => apiRequest<ApiEmployeePaginatedResponse>(path, { apiCache: false }).then((response) => ({
        items: response.data.map(mapEmployeeFromApi),
        meta: response.meta,
      })),
      validate: isEmployeeOptionsResponse,
    });
    employeeListSnapshots.set(snapshotKey, result);
    return result;
  },
  peekList(filters: EmployeeListFilters = {}) {
    return employeeListSnapshots.get(employeeListRequest(filters).snapshotKey);
  },
  async getAll() {
    const response = await this.list({ take: 200 });
    return response.items;
  },
  async getOptions(filters: EmployeeListFilters = {}) {
    const params = new URLSearchParams();
    params.set("page", String(filters.page || 1));
    params.set("take", String(filters.take || 500));
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    if (filters.companyId) params.set("companyId", filters.companyId);
    if (filters.status) params.set("status", filters.status);
    const key = `/employees/options?${params.toString()}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.employeesOptions,
      fetcher: () => apiRequest<ApiEmployeePaginatedResponse>(key, { apiCache: false }).then((response) => ({
        items: response.data.map(mapEmployeeFromApi),
        meta: response.meta,
      })),
      validate: isEmployeeOptionsResponse,
    });
  },
  async getSummary() {
    return cachedData({
      requestKey: "GET:/employees/summary",
      policy: cachePolicies.employeesSummary,
      fetcher: () => apiRequest<ApiEmployeeSummaryResponse>("/employees/summary", { apiCache: false }).then((response) => response.data),
      validate: isEmployeeSummary,
    });
  },
  async getOrgChart() {
    return cachedData({
      requestKey: `GET:/employees/org-chart?take=${ORG_CHART_EMPLOYEE_LIMIT}`,
      policy: cachePolicies.employeesOrgChart,
      fetcher: () => apiRequest<ApiEmployeePaginatedResponse>(`/employees/org-chart?take=${ORG_CHART_EMPLOYEE_LIMIT}`, { apiCache: false }).then((response) => ({
        items: response.data.map(mapEmployeeFromApi),
        meta: response.meta,
      })),
      validate: isEmployeeOptionsResponse,
    });
  },
  async getById(id: string) {
    const response = await apiRequest<ApiEmployeeItemResponse>(`/employees/${id}`);
    return mapEmployeeFromApi(response.data);
  },
  // Etapa 14D.5: antes era un fetch directo, sin dedupe in-flight — el
  // doble-montaje de React StrictMode en dev (y cualquier remount real)
  // disparaba 2 llamadas de red idénticas. `cachedData` comparte la misma
  // Promise entre invocaciones concurrentes y cachea 60s (familia
  // "employees", ya invalidada por los 8 mutadores existentes de legajo) —
  // ver docs/decisions/EMPLOYEE_DETAIL_LOAD_DEDUP_14D5.md.
  async getOverviewById(id: string) {
    return cachedData({
      requestKey: `GET:/employees/${id}/overview`,
      policy: cachePolicies.employeeDetailCore,
      fetcher: () => apiRequest<ApiEmployeeItemResponse>(`/employees/${id}/overview`, { apiCache: false }).then((response) => mapEmployeeFromApi(response.data)),
      validate: isEmployeeDetail,
    });
  },
  async getOverviewDetailsById(id: string) {
    return cachedData({
      requestKey: `GET:/employees/${id}/overview-details`,
      policy: cachePolicies.employeeDetailCore,
      fetcher: () => apiRequest<ApiEmployeeItemResponse>(`/employees/${id}/overview-details`, { apiCache: false }).then((response) => mapEmployeeFromApi(response.data)),
      validate: isEmployeeDetail,
    });
  },
  async getTimeGrid(id: string, period: string, options: { includeDetails?: boolean } = {}): Promise<EmployeeTimeGrid> {
    const params = new URLSearchParams({ period });
    if (options.includeDetails !== undefined) params.set("includeDetails", String(options.includeDetails));
    const response = await apiRequest<ApiTimeGridResponse>(`/employees/${id}/time-grid?${params.toString()}`);
    return {
      employee: mapEmployeeFromApi(response.data.employee),
      entries: response.data.entries.map(mapTimeEntryFromApi),
      novelties: response.data.novelties.map(mapNoveltyFromApi),
      noveltyTypes: response.data.noveltyTypes.map(mapNoveltyTypeFromApi),
      hourConcepts: response.data.hourConcepts.map(mapHourConceptFromApi),
      rows: response.data.rows.map((row) => ({ ...row, concept: mapHourConceptFromApi(row.concept) })),
      totalWorkedMinutes: response.data.totalWorkedMinutes,
      attendanceIssues: response.data.attendanceIssues || 0,
      specialHoursByDay: response.data.specialHoursByDay || {},
      specialHourAdditionalMinutes: response.data.specialHourAdditionalMinutes || 0,
      specialHourLiquidableTotalMinutes: response.data.specialHourLiquidableTotalMinutes ?? response.data.totalWorkedMinutes,
    };
  },
  async saveManualHourConceptBreakdown(employeeId: string, input: ManualHourConceptBreakdownInput) {
    const response = await apiRequest<{ data: unknown }>(`/employees/${employeeId}/hour-concept-breakdowns/manual`, {
      method: "PUT",
      body: input,
    });
    await invalidateHourConceptBreakdownDependentCaches("manual hour concept breakdown saved");
    return response.data;
  },
  // Etapa 6L.5: resolución RRHH de un desglose manual EN_REVISION desde la
  // bandeja — mismos endpoints agregados en 6L.3, sin UI hasta ahora.
  async approveManualHourConceptBreakdown(employeeId: string, breakdownId: string) {
    const response = await apiRequest<{ data: unknown }>(`/employees/${employeeId}/hour-concept-breakdowns/manual/${breakdownId}/approve`, {
      method: "POST",
    });
    await invalidateHourConceptBreakdownDependentCaches("manual hour concept breakdown approved");
    return response.data;
  },
  async rejectManualHourConceptBreakdown(employeeId: string, breakdownId: string, reason: string) {
    const response = await apiRequest<{ data: unknown }>(`/employees/${employeeId}/hour-concept-breakdowns/manual/${breakdownId}/reject`, {
      method: "POST",
      body: { reason },
    });
    await invalidateHourConceptBreakdownDependentCaches("manual hour concept breakdown rejected");
    return response.data;
  },
  async returnManualHourConceptBreakdown(employeeId: string, breakdownId: string, reason: string) {
    const response = await apiRequest<{ data: unknown }>(`/employees/${employeeId}/hour-concept-breakdowns/manual/${breakdownId}/return`, {
      method: "POST",
      body: { reason },
    });
    await invalidateHourConceptBreakdownDependentCaches("manual hour concept breakdown returned");
    return response.data;
  },
  async recalculateAutomaticHourConceptBreakdowns(employeeId: string, period: string) {
    const response = await apiRequest<{ data: RecalculateAutomaticHourConceptBreakdownsResult }>(
      `/employees/${employeeId}/hour-concept-breakdowns/recalculate-automatic`,
      { method: "POST", body: { period } },
    );
    await invalidateCacheFamily("time-entries", "automatic hour concept breakdowns recalculated");
    return response.data;
  },
  // Etapa 14D.2.1: `positionId` se pasa al backend (habilita el camino
  // paralelo del repositorio, ver docs/decisions/
  // POSITION_VALIDATION_PERFORMANCE_14D2_1.md). `sector`/`internalCategory`
  // NO viajan al backend (que los vuelve a derivar de la fuente real) —
  // sólo entran en la clave de caché, para que un cambio en cualquiera de
  // las 4 dimensiones que afectan el resultado dispare un fetch nuevo en
  // vez de servir un resultado cacheado que ya no corresponde.
  async getPositionValidation(id: string, options: { positionId?: string; sector?: string; internalCategory?: string } = {}) {
    const { positionId, sector, internalCategory } = options;
    const params = new URLSearchParams();
    if (positionId) params.set("positionId", positionId);
    const query = params.toString();
    const path = `/employees/${id}/position-validation${query ? `?${query}` : ""}`;
    return cachedData({
      requestKey: `GET:${path}:${sector || ""}:${internalCategory || ""}`,
      policy: cachePolicies.employeePositionValidation,
      fetcher: () => apiRequest<ApiEmployeePositionValidationResponse>(path, { apiCache: false }).then((response) => response.data),
      validate: (value) => Boolean(value && typeof value.tone === "string" && typeof value.title === "string"),
    });
  },
  async create(employee: Employee) {
    const response = await apiRequest<ApiEmployeeItemResponse>("/employees", {
      method: "POST",
      body: await mapEmployeeToApi(employee, "create"),
    });
    await syncEmployeeExtras(response.data.id, employee, { createInitialMovement: false, syncHourConcepts: false });
    await invalidateEmployeeDependentCaches("employee created");
    return mapEmployeeFromApi(response.data);
  },
  async update(employee: Employee) {
    await apiRequest(`/employees/${employee.id}`, {
      method: "PATCH",
      body: await mapEmployeeToApi(employee, "update"),
    });
    await invalidateEmployeeDependentCaches("employee updated");
    // El PATCH confirma y audita los campos modificables. La pantalla ya tiene
    // el overview completo; conservarlo evita pedir o reconstruir relaciones
    // que este guardado general no modifica.
    return employee;
  },
  async updateAddress(employee: Employee) {
    const response = await apiRequest<ApiEmployeeItemResponse>(`/employees/${employee.id}/address`, {
      method: "PUT",
      body: addressPayload(employee),
    });
    await invalidateEmployeeDependentCaches("employee address updated");
    return mapEmployeeFromApi(response.data);
  },
  async updateTransport(employee: Employee) {
    const response = await apiRequest<ApiEmployeeItemResponse>(`/employees/${employee.id}/transport`, {
      method: "PUT",
      body: transportPayload(employee),
    });
    await invalidateEmployeeDependentCaches("employee transport updated");
    return mapEmployeeFromApi(response.data);
  },
  async replaceAssignments(employee: Employee) {
    const response = await apiRequest<ApiEmployeeItemResponse>(`/employees/${employee.id}/assignments`, {
      method: "PUT",
      body: await assignmentsPayload(employee),
    });
    await invalidateEmployeeDependentCaches("employee assignments updated");
    return mapEmployeeFromApi(response.data);
  },
  async replaceHourConcepts(employee: Employee) {
    const response = await apiRequest<ApiEmployeeItemResponse>(`/employees/${employee.id}/hour-concepts`, {
      method: "PUT",
      body: await hourConceptsPayload(employee),
    });
    await invalidateEmployeeDependentCaches("employee hour concepts updated");
    return mapEmployeeFromApi(response.data);
  },
  async createLaborMovement(
    employeeId: string,
    input: { type: "ALTA" | "BAJA"; effectiveFrom: string; reason: string; observation?: string | null },
  ) {
    const response = await apiRequest<ApiEmployeeItemResponse>(`/employees/${employeeId}/labor-movements`, {
      method: "POST",
      body: input,
    });
    await invalidateEmployeeDependentCaches("employee labor movement created");
    return mapEmployeeFromApi(response.data);
  },
  async syncLaborStatuses() {
    const response = await apiRequest<ApiLaborStatusSyncResponse>("/employees/sync-labor-statuses", {
      method: "POST",
    });
    await invalidateEmployeeDependentCaches("labor statuses synced");
    return response.data;
  },
};
