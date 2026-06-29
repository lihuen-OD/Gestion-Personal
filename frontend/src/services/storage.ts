import { mockAuditParameters } from "../data/mockAuditParameters";
import { mockAudit, mockDocuments, mockEmployees, mockNovelties, mockTimeEntries, mockUsers } from "../data/mockData";
import { mockDocumentCategories } from "../data/mockDocumentCategories";
import { mockHourConcepts } from "../data/mockHourConcepts";
import { mockNoveltyTypes } from "../data/mockNoveltyTypes";
import { mockOrgStructure } from "../data/mockOrgStructure";
import { mockPositions } from "../data/mockPositions";
import { locationMockService } from "./locationMockService";
import type { Employee, EmployeeAddress, EmployeeLocationMap, LaborMovement, TimeEntry } from "../types";
import type { Position } from "../types/position.types";

export type StoreKey = "employees" | "users" | "timeEntries" | "novelties" | "noveltyTypes" | "hourConcepts" | "documentCategories" | "auditParameters" | "orgStructure" | "audit" | "documents" | "changeLogs" | "fieldHistory" | "blockHistory" | "positions" | "positionHistory";
const seeds = { employees: mockEmployees, users: mockUsers, timeEntries: mockTimeEntries, novelties: mockNovelties, noveltyTypes: mockNoveltyTypes, hourConcepts: mockHourConcepts, documentCategories: mockDocumentCategories, auditParameters: mockAuditParameters, orgStructure: [mockOrgStructure], audit: mockAudit, documents: mockDocuments, changeLogs: [], fieldHistory: [], blockHistory: [], positions: mockPositions, positionHistory: mockPositions.flatMap((position) => position.history) };
const key = (name: StoreKey) => `losod_demo_${name}`;
const seedVersion = "2026-06-novedades-horas-finnegans-v1";

function normalizeLocationMap(value: unknown, employee: Partial<Employee>): EmployeeLocationMap {
  if (value && typeof value === "object" && "source" in value) return value as EmployeeLocationMap;
  return { lat: null, lng: null, source: "MOCK", label: typeof value === "string" ? value : [employee.city, employee.department, employee.province].filter(Boolean).join(", ") };
}

function normalizeAddress(employee: Partial<Employee> & Record<string, unknown>, locationMap: EmployeeLocationMap): EmployeeAddress {
  const legajoInterno = String(employee.legajoInterno || employee.legajo || "");
  const addressStreet = String(employee.addressStreet || employee.address || employee.direccion || "");
  const city = String(employee.city || employee.localidad || "");
  const department = String(employee.department || employee.departamento || "");
  const province = String(employee.province || employee.provincia || "");
  if (employee.domicilio && typeof employee.domicilio === "object") {
    const current = employee.domicilio as Partial<EmployeeAddress>;
    return {
      calle: current.calle || addressStreet,
      numero: current.numero || String(employee.addressNumber || employee.numeroDireccion || "S/N"),
      provinciaId: current.provinciaId || locationMockService.getProvinceByName(current.provinciaNombre || province)?.id || "",
      provinciaNombre: current.provinciaNombre || province,
      departamentoId: current.departamentoId || locationMockService.getDepartmentByName(current.departamentoNombre || department)?.id || "",
      departamentoNombre: current.departamentoNombre || department,
      localidadId: current.localidadId || "",
      localidadNombre: current.localidadNombre || city,
      codigoPostal: current.codigoPostal || String(employee.zip || ""),
      ubicacionMapa: normalizeLocationMap(current.ubicacionMapa || locationMap, employee),
      referencia: current.referencia || "",
      direccionNormalizada: current.direccionNormalizada || "",
      fuenteGeocoding: current.fuenteGeocoding,
      precisionGeocoding: current.precisionGeocoding,
    };
  }
  const provinceId = locationMockService.getProvinceByName(province)?.id || "";
  const departmentId = locationMockService.getDepartmentsByProvince(provinceId).find((item) => item.name === department)?.id || "";
  const localityId = locationMockService.getLocalityByName(departmentId, city)?.id || "";
  return { calle: addressStreet, numero: String(employee.addressNumber || employee.numeroDireccion || "S/N"), provinciaId: provinceId, provinciaNombre: province, departamentoId: departmentId, departamentoNombre: department, localidadId: localityId, localidadNombre: city, codigoPostal: String(employee.zip || ""), ubicacionMapa: locationMap };
}

function normalizeLaborMovements(employee: Partial<Employee> & Record<string, unknown>): LaborMovement[] {
  const existing = Array.isArray(employee.laborMovements) ? employee.laborMovements as LaborMovement[] : [];
  if (existing.length) return existing;
  const movements: LaborMovement[] = [];
  const startDate = String(employee.startDate || employee.fechaIngreso || "");
  const endDate = String(employee.endDate || employee.fechaEgreso || "");
  const exitReason = String(employee.exitReason || employee.motivoEgreso || "");
  if (startDate) movements.push({ id: crypto.randomUUID(), type: "ALTA", effectiveFrom: startDate, reason: "Alta inicial", observation: "Movimiento normalizado desde datos existentes.", createdAt: `${startDate}T09:00:00.000Z`, createdByUserId: "system", createdByUserName: "Sistema" });
  if (endDate) movements.push({ id: crypto.randomUUID(), type: "BAJA", effectiveFrom: endDate, reason: exitReason || "Baja registrada", observation: "Movimiento normalizado desde datos existentes.", createdAt: `${endDate}T09:00:00.000Z`, createdByUserId: "system", createdByUserName: "Sistema" });
  return movements.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

function normalizeEmployee(employee: Partial<Employee> & Record<string, unknown>): Employee {
  const legajoInterno = String(employee.legajoInterno || employee.legajo || "");
  const addressStreet = String(employee.addressStreet || employee.address || employee.direccion || "");
  const city = String(employee.city || employee.localidad || "");
  const department = String(employee.department || employee.departamento || "");
  const province = String(employee.province || employee.provincia || "");
  const locationMap = normalizeLocationMap(employee.locationMap || employee.ubicacionMapa || employee.mapLocation, employee);
  const domicilio = normalizeAddress(employee, locationMap);
  return {
    ...employee,
    legajo: String(employee.legajo || legajoInterno),
    legajoInterno,
    legajoFinnegans: employee.legajoFinnegans ? String(employee.legajoFinnegans) : "",
    companies: Array.isArray(employee.companies) ? employee.companies.map(String) : [String(employee.company || "")].filter(Boolean),
    positionId: employee.positionId ? String(employee.positionId) : employee.puestoId ? String(employee.puestoId) : "",
    puestoId: employee.puestoId ? String(employee.puestoId) : employee.positionId ? String(employee.positionId) : "",
    puestoNombre: String(employee.puestoNombre || employee.position || employee.puesto || ""),
    healthInsurance: String(employee.healthInsurance || employee.obraSocial || "OSPRERA"),
    directManagers: Array.isArray(employee.directManagers) ? employee.directManagers.map(String) : [String(employee.directManager || "")].filter(Boolean),
    timeResponsibles: Array.isArray(employee.timeResponsibles) ? employee.timeResponsibles.map(String) : [String(employee.timeResponsible || "")].filter(Boolean),
    address: String(employee.address || addressStreet),
    addressStreet,
    addressNumber: String(employee.addressNumber || employee.numeroDireccion || "S/N"),
    city,
    department: domicilio.departamentoNombre || department,
    province: domicilio.provinciaNombre || province,
    zip: domicilio.codigoPostal || String(employee.zip || ""),
    domicilio,
    locationMap: domicilio.ubicacionMapa,
    laborMovements: normalizeLaborMovements(employee),
  } as Employee;
}

function normalizePosition(position: Partial<Position> & Record<string, unknown>): Position {
  return {
    ...position,
    businessUnitNames: Array.isArray(position.businessUnitNames) ? position.businessUnitNames.map(String) : [String(position.businessUnitName || "")].filter(Boolean),
    establishmentNames: Array.isArray(position.establishmentNames) ? position.establishmentNames.map(String) : [String(position.establishmentName || "")].filter(Boolean),
    sectorNames: Array.isArray(position.sectorNames) ? position.sectorNames.map(String) : [String(position.sector || "")].filter(Boolean),
    salaryRangeCategories: Array.isArray(position.salaryRangeCategories) ? position.salaryRangeCategories.map(String) : [],
  } as Position;
}

function normalizeTimeEntry(entry: Partial<TimeEntry> & Record<string, unknown>): TimeEntry {
  const period = String(entry.period || "");
  const day = Number(entry.day || 1);
  const hours = Number(entry.hours || 0);
  return {
    ...entry,
    period,
    day,
    hours,
    date: String(entry.date || `${period}-${String(day).padStart(2, "0")}`),
    totalMinutes: Number(entry.totalMinutes ?? Math.round(hours * 60)),
    origin: (entry.origin as TimeEntry["origin"]) || "MANUAL",
  } as TimeEntry;
}

function ensureSeedVersion() {
  if (localStorage.getItem("losod_demo_seed_version") === seedVersion) return;
  (Object.keys(seeds) as StoreKey[]).forEach((name) => {
    const raw = localStorage.getItem(key(name));
    if (!raw) return localStorage.setItem(key(name), JSON.stringify(seeds[name]));
    if (name === "employees") {
      const seedById = new Map(mockEmployees.map((employee) => [employee.id, employee]));
      const current = (JSON.parse(raw) as Array<Partial<Employee> & Record<string, unknown>>).map((employee) => {
        const normalized = normalizeEmployee(employee);
        const seed = seedById.get(normalized.id);
        return seed?.companies?.length ? { ...normalized, companies: seed.companies } : normalized;
      });
      const currentIds = new Set(current.map((employee) => employee.id));
      const additions = mockEmployees.filter((employee) => !currentIds.has(employee.id));
      localStorage.setItem(key(name), JSON.stringify([...current, ...additions]));
    } else if (["hourConcepts", "noveltyTypes"].includes(name)) {
      localStorage.setItem(key(name), JSON.stringify(seeds[name]));
    }
  });
  localStorage.setItem("losod_demo_seed_version", seedVersion);
}

export function readStore<T>(name: StoreKey): T[] {
  ensureSeedVersion();
  const raw = localStorage.getItem(key(name));
  if (!raw) {
    localStorage.setItem(key(name), JSON.stringify(seeds[name]));
    return structuredClone(seeds[name]) as T[];
  }
  const parsed = JSON.parse(raw);
  if (name === "employees") return (parsed as Array<Partial<Employee> & Record<string, unknown>>).map(normalizeEmployee) as T[];
  if (name === "positions") return (parsed as Array<Partial<Position> & Record<string, unknown>>).map(normalizePosition) as T[];
  if (name === "timeEntries") return (parsed as Array<Partial<TimeEntry> & Record<string, unknown>>).map(normalizeTimeEntry) as T[];
  return parsed as T[];
}

export function writeStore<T>(name: StoreKey, value: T[]) {
  localStorage.setItem(key(name), JSON.stringify(value));
}

export function resetDemoData() {
  (Object.keys(seeds) as StoreKey[]).forEach((name) => localStorage.setItem(key(name), JSON.stringify(seeds[name])));
  localStorage.setItem("losod_demo_seed_version", seedVersion);
}
