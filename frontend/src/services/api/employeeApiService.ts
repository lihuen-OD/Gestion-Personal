import { apiRequest } from "./apiClient";
import { hourConceptApiService } from "./hourConceptApiService";
import { orgStructureApiService } from "./orgStructureApiService";
import { positionApiService } from "./positionApiService";
import { userApiService } from "./userApiService";
import { calculateLaborStatus } from "../employeeStatusService";
import type { Employee, EmployeeStatus, LaborMovement } from "../../types";

type ApiEmployeeStatus = "ACTIVO" | "INACTIVO";

type ApiEmployee = {
  id: string;
  legajo: string;
  legajoFinnegans?: string | null;
  cuil: string;
  dni: string;
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
  hourConcepts?: Array<{ hourConcept: { id: string; name: string } }>;
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

export type EmployeeListFilters = {
  search?: string;
  companyId?: string;
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
  const startMovement = laborMovements.find((movement) => movement.type === "ALTA");
  const endMovement = laborMovements.find((movement) => movement.type === "BAJA");
  const status = laborMovements.length ? calculateLaborStatus(laborMovements).status : toFrontendStatus(item.status);

  return {
    id: item.id,
    legajo: item.legajo,
    legajoInterno: item.legajo,
    legajoFinnegans: item.legajoFinnegans || "",
    firstName: item.firstName,
    lastName: item.lastName,
    dni: item.dni,
    cuil: item.cuil,
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
    startDate: startMovement?.effectiveFrom || "",
    endDate: endMovement?.effectiveFrom,
    exitReason: endMovement?.reason,
    transport: Boolean(item.transport?.usesCompanyTransport),
    transportRoute: item.transport?.busLine || "",
    transportNotes: item.transport?.observation || item.transport?.pickupReference || "",
    enabledHours: (item.hourConcepts || []).map((link) => link.hourConcept.name),
    status,
    laborMovements,
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
  const [catalog, positions] = await Promise.all([
    orgStructureApiService.getCatalog().catch(() => null),
    positionApiService.getAll().catch(() => []),
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
    locality: employee.city || null,
    pickupAddress: employee.addressStreet || null,
    pickupReference: null,
    busLine: employee.transportRoute || null,
    schedule: null,
    observation: employee.transportNotes || null,
  };
}

async function assignmentsPayload(employee: Employee) {
  const users = await userApiService.getAll().catch(() => []);
  const userByName = new Map(users.map((user) => [user.employeeName || user.name, user]));
  const assignments = [
    ...(employee.directManagers || (employee.directManager ? [employee.directManager] : [])).map((personName) => ({
      type: "DIRECT_MANAGER" as const,
      personName,
      role: null,
      effectiveFrom: employee.directManagerFrom || null,
      effectiveTo: employee.directManagerTo || null,
      status: employee.directManagerStatus || null,
      notes: employee.directManagerNotes || null,
    })),
    ...(employee.timeResponsibles || (employee.timeResponsible ? [employee.timeResponsible] : [])).map((personName) => {
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
  const concepts = await hourConceptApiService.getAll().catch(() => []);
  const hourConceptIds = compact(employee.enabledHours.map((name) => concepts.find((item) => item.name === name)?.id));
  return { hourConceptIds };
}

async function syncEmployeeExtras(employeeId: string, employee: Employee, options: { createInitialMovement?: boolean } = {}) {
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

  if (employee.enabledHours?.length) {
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

export const employeeApiService = {
  async list(filters: EmployeeListFilters = {}) {
    const params = new URLSearchParams();
    params.set("page", String(filters.page || 1));
    params.set("take", String(filters.take || 25));
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    if (filters.companyId) params.set("companyId", filters.companyId);
    if (filters.status) params.set("status", filters.status);
    const response = await apiRequest<ApiEmployeePaginatedResponse>(`/employees?${params.toString()}`);
    return {
      items: response.data.map(mapEmployeeFromApi),
      meta: response.meta,
    };
  },
  async getAll() {
    const response = await this.list({ take: 200 });
    return response.items;
  },
  async getSummary() {
    const response = await apiRequest<ApiEmployeeSummaryResponse>("/employees/summary");
    return response.data;
  },
  async getOrgChart() {
    const response = await apiRequest<ApiEmployeeListResponse>("/employees/org-chart?take=1000");
    return response.data.map(mapEmployeeFromApi);
  },
  async getById(id: string) {
    const response = await apiRequest<ApiEmployeeItemResponse>(`/employees/${id}`);
    return mapEmployeeFromApi(response.data);
  },
  async getPositionValidation(id: string) {
    const response = await apiRequest<ApiEmployeePositionValidationResponse>(`/employees/${id}/position-validation`);
    return response.data;
  },
  async create(employee: Employee) {
    const response = await apiRequest<ApiEmployeeItemResponse>("/employees", {
      method: "POST",
      body: await mapEmployeeToApi(employee, "create"),
    });
    await syncEmployeeExtras(response.data.id, employee, { createInitialMovement: true });
    return this.getById(response.data.id);
  },
  async update(employee: Employee) {
    const response = await apiRequest<ApiEmployeeItemResponse>(`/employees/${employee.id}`, {
      method: "PATCH",
      body: await mapEmployeeToApi(employee, "update"),
    });
    await syncEmployeeExtras(response.data.id, employee);
    return this.getById(response.data.id);
  },
  async updateAddress(employee: Employee) {
    await apiRequest<ApiEmployeeItemResponse>(`/employees/${employee.id}/address`, {
      method: "PUT",
      body: addressPayload(employee),
    });
    return this.getById(employee.id);
  },
  async updateTransport(employee: Employee) {
    await apiRequest<ApiEmployeeItemResponse>(`/employees/${employee.id}/transport`, {
      method: "PUT",
      body: transportPayload(employee),
    });
    return this.getById(employee.id);
  },
  async replaceAssignments(employee: Employee) {
    await apiRequest<ApiEmployeeItemResponse>(`/employees/${employee.id}/assignments`, {
      method: "PUT",
      body: await assignmentsPayload(employee),
    });
    return this.getById(employee.id);
  },
  async replaceHourConcepts(employee: Employee) {
    await apiRequest<ApiEmployeeItemResponse>(`/employees/${employee.id}/hour-concepts`, {
      method: "PUT",
      body: await hourConceptsPayload(employee),
    });
    return this.getById(employee.id);
  },
  async createLaborMovement(
    employeeId: string,
    input: { type: "ALTA" | "BAJA"; effectiveFrom: string; reason: string; observation?: string | null },
  ) {
    await apiRequest<ApiEmployeeItemResponse>(`/employees/${employeeId}/labor-movements`, {
      method: "POST",
      body: input,
    });
    return this.getById(employeeId);
  },
  async syncLaborStatuses() {
    const response = await apiRequest<ApiLaborStatusSyncResponse>("/employees/sync-labor-statuses", {
      method: "POST",
    });
    return response.data;
  },
};
