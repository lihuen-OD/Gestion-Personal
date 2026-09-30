import type { OrgStructureCatalog } from "../../types/orgStructure.types";

// Catálogo de prueba con todos los niveles, un centro de costo compartido,
// uno ubicado por área y registros sin padre válido ("Sin asignar").
export const treeCatalog: OrgStructureCatalog = {
  companies: [{ id: "c1", code: "EMP-1", name: "Los O'Dwyer", legalName: "Los O'Dwyer SA", cuit: "30-1", status: "ACTIVO" }],
  businessUnits: [
    { id: "bu1", code: "UN-1", name: "Producción", companyId: "c1", status: "ACTIVO" },
    { id: "bu-orphan", code: "UN-9", name: "Unidad huérfana", companyId: "c-missing", status: "INACTIVO" },
  ],
  establishments: [{ id: "e1", code: "EST-1", name: "Planta 1", companyId: "c1", businessUnitId: "bu1", province: "Córdoba", department: "Capital", locality: "Córdoba", address: "Calle", status: "ACTIVO" }],
  areas: [{ id: "a1", code: "AREA-1", name: "Administración", establishmentId: "e1", status: "ACTIVO" }],
  sectors: [
    { id: "s1", code: "SEC-1", name: "Recursos Humanos", areaId: "a1", status: "ACTIVO" },
    { id: "s2", code: "SEC-2", name: "Compras", areaId: "a1", status: "ACTIVO" },
  ],
  costCenters: [
    { id: "cc1", code: "RH-001", name: "Centro RRHH", companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: [], sectorIds: ["s1"], status: "ACTIVO" },
    { id: "cc2", code: "CC-002", name: "Compartido", companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: [], sectorIds: ["s1", "s2"], status: "ACTIVO" },
    { id: "cc3", code: "CC-003", name: "Del área", companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: ["a1"], sectorIds: [], status: "ACTIVO" },
    { id: "cc4", code: "CC-004", name: "Sin relaciones", companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: [], sectorIds: ["s-missing"], status: "ACTIVO" },
  ],
};
