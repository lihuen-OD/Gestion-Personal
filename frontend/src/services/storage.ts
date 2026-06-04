import { mockAudit, mockDocuments, mockEmployees, mockNovelties, mockTimeEntries, mockUsers } from "../data/mockData";
import { locationMockService } from "./locationMockService";
import type { Employee, EmployeeAddress, EmployeeLocationMap, LaborMovement } from "../types";

export type StoreKey = "employees" | "users" | "timeEntries" | "novelties" | "audit" | "documents" | "changeLogs" | "fieldHistory" | "blockHistory";
const seeds = { employees: mockEmployees, users: mockUsers, timeEntries: mockTimeEntries, novelties: mockNovelties, audit: mockAudit, documents: mockDocuments, changeLogs: [], fieldHistory: [], blockHistory: [] };
const key = (name: StoreKey) => `losod_demo_${name}`;
const seedVersion = "2026-06-field-history-v1";

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

function ensureSeedVersion() {
  if (localStorage.getItem("losod_demo_seed_version") === seedVersion) return;
  (Object.keys(seeds) as StoreKey[]).forEach((name) => {
    const raw = localStorage.getItem(key(name));
    if (!raw) return localStorage.setItem(key(name), JSON.stringify(seeds[name]));
    if (name === "employees") {
      localStorage.setItem(key(name), JSON.stringify((JSON.parse(raw) as Array<Partial<Employee> & Record<string, unknown>>).map(normalizeEmployee)));
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
  return parsed as T[];
}

export function writeStore<T>(name: StoreKey, value: T[]) {
  localStorage.setItem(key(name), JSON.stringify(value));
}

export function resetDemoData() {
  (Object.keys(seeds) as StoreKey[]).forEach((name) => localStorage.setItem(key(name), JSON.stringify(seeds[name])));
  localStorage.setItem("losod_demo_seed_version", seedVersion);
}
