import { mockOrgStructure } from "../data/mockOrgStructure";
import type { Employee } from "../types";
import type {
  OrgArea,
  OrgBusinessUnit,
  OrgCompany,
  OrgCostCenter,
  OrgEstablishment,
  OrgSector,
  OrgStructureCatalog,
  OrgStructureEntityType,
  OrgStructureStatus,
} from "../types/orgStructure.types";
import { employeeMockService } from "./employeeMockService";
import { readStore, writeStore } from "./storage";

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
const norm = (value: string) => value.trim().toLowerCase();
const active = <T extends { status: OrgStructureStatus }>(items: T[]) => items.filter((item) => item.status === "ACTIVO");

function catalog() {
  return readStore<OrgStructureCatalog>("orgStructure")[0] || mockOrgStructure;
}

function namesFromEmployees(selector: (employee: Employee) => string | string[]) {
  return employeeMockService.getAll().flatMap((employee) => selector(employee)).filter(Boolean) as string[];
}

function byNames<T extends { id: string; name: string }>(items: T[], names: string[]) {
  const wanted = new Set(names.map(norm));
  return items.filter((item) => wanted.has(norm(item.name))).map((item) => item.id);
}

function withFallback(values: string[], fallback: string[]) {
  return unique([...values, ...fallback]);
}

function nextCode(prefix: string, items: { code: string }[]) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export const orgStructureMockService = {
  getCatalog: catalog,
  saveCatalog: (value: OrgStructureCatalog) => {
    writeStore("orgStructure", [value]);
    return value;
  },
  getCompanyNames: () => withFallback(active(catalog().companies).map((item) => item.name), namesFromEmployees((employee) => employee.companies?.length ? employee.companies : employee.company)),
  getBusinessUnitNames: () => withFallback(active(catalog().businessUnits).map((item) => item.name), namesFromEmployees((employee) => employee.businessUnit)),
  getEstablishmentNames: () => withFallback(active(catalog().establishments).map((item) => item.name), namesFromEmployees((employee) => employee.establishment)),
  getAreaNames: () => withFallback(active(catalog().areas).map((item) => item.name), []),
  getSectorNames: () => withFallback(active(catalog().sectors).map((item) => item.name), namesFromEmployees((employee) => employee.sector)),
  getCostCenterNames: () => withFallback(active(catalog().costCenters).map((item) => item.name), namesFromEmployees((employee) => employee.costCenter)),
  getOptions: () => ({
    companies: orgStructureMockService.getCompanyNames(),
    businessUnits: orgStructureMockService.getBusinessUnitNames(),
    establishments: orgStructureMockService.getEstablishmentNames(),
    areas: orgStructureMockService.getAreaNames(),
    sectors: orgStructureMockService.getSectorNames(),
    costCenters: orgStructureMockService.getCostCenterNames(),
  }),
  inferIds: (data: { companies?: string[]; company?: string; businessUnit?: string; establishment?: string; area?: string; sector?: string; costCenter?: string }) => {
    const current = catalog();
    const companyIds = byNames(current.companies, data.companies?.length ? data.companies : [data.company || ""]);
    const businessUnitIds = byNames(current.businessUnits, [data.businessUnit || ""]);
    const establishmentIds = byNames(current.establishments, [data.establishment || ""]);
    const areaIds = byNames(current.areas, [data.area || ""]);
    const sectorIds = byNames(current.sectors, [data.sector || ""]);
    const costCenterIds = byNames(current.costCenters, [data.costCenter || ""]);
    return { companyIds, businessUnitIds, establishmentIds, areaIds, sectorIds, costCenterIds };
  },
  validateCombination: (data: { companies?: string[]; company?: string; businessUnit?: string; establishment?: string; area?: string; sector?: string; costCenter?: string }) => {
    const current = catalog();
    const ids = orgStructureMockService.inferIds(data);
    const warnings: string[] = [];
    const units = current.businessUnits.filter((item) => ids.businessUnitIds.includes(item.id));
    const establishments = current.establishments.filter((item) => ids.establishmentIds.includes(item.id));
    const areas = current.areas.filter((item) => ids.areaIds.includes(item.id));
    const sectors = current.sectors.filter((item) => ids.sectorIds.includes(item.id));
    const centers = current.costCenters.filter((item) => ids.costCenterIds.includes(item.id));
    if (ids.companyIds.length && units.some((item) => !item.companyIds.some((id) => ids.companyIds.includes(id)))) warnings.push("La unidad de negocio no está vinculada a la empresa seleccionada.");
    if (ids.companyIds.length && establishments.some((item) => !item.companyIds.some((id) => ids.companyIds.includes(id)))) warnings.push("El establecimiento no está vinculado a la empresa seleccionada.");
    if (ids.businessUnitIds.length && establishments.some((item) => !item.businessUnitIds.some((id) => ids.businessUnitIds.includes(id)))) warnings.push("El establecimiento no pertenece a la unidad de negocio seleccionada.");
    if (ids.businessUnitIds.length && areas.some((item) => !item.businessUnitIds.some((id) => ids.businessUnitIds.includes(id)))) warnings.push("El área/departamento no pertenece a la unidad de negocio seleccionada.");
    if (ids.establishmentIds.length && sectors.some((item) => !item.establishmentIds.some((id) => ids.establishmentIds.includes(id)))) warnings.push("El sector no está habilitado para el establecimiento seleccionado.");
    if (ids.areaIds.length && sectors.some((item) => !item.areaIds.some((id) => ids.areaIds.includes(id)))) warnings.push("El sector no pertenece al área/departamento seleccionado.");
    if (centers.some((item) => ids.companyIds.length && !item.companyIds.some((id) => ids.companyIds.includes(id)))) warnings.push("El centro de costo no corresponde a la empresa seleccionada.");
    if (centers.some((item) => ids.sectorIds.length && !item.sectorIds.some((id) => ids.sectorIds.includes(id)))) warnings.push("El centro de costo no corresponde al sector seleccionado.");
    return { ok: warnings.length === 0, warnings };
  },
  nextCode: (type: OrgStructureEntityType) => {
    const current = catalog();
    if (type === "COMPANY") return nextCode("EMP", current.companies);
    if (type === "BUSINESS_UNIT") return nextCode("UN", current.businessUnits);
    if (type === "ESTABLISHMENT") return nextCode("EST", current.establishments);
    if (type === "AREA") return nextCode("AREA", current.areas);
    if (type === "SECTOR") return nextCode("SEC", current.sectors);
    return nextCode("CC", current.costCenters);
  },
  upsert: (type: OrgStructureEntityType, item: OrgCompany | OrgBusinessUnit | OrgEstablishment | OrgArea | OrgSector | OrgCostCenter) => {
    const current = catalog();
    const key = type === "COMPANY" ? "companies" : type === "BUSINESS_UNIT" ? "businessUnits" : type === "ESTABLISHMENT" ? "establishments" : type === "AREA" ? "areas" : type === "SECTOR" ? "sectors" : "costCenters";
    const list = current[key] as Array<typeof item>;
    const exists = list.some((entry) => entry.id === item.id);
    return orgStructureMockService.saveCatalog({ ...current, [key]: exists ? list.map((entry) => entry.id === item.id ? item : entry) : [item, ...list] });
  },
};
