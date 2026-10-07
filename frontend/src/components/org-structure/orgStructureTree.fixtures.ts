import type { OrgStructureCatalog } from "../../types/orgStructure.types";

// Catálogo de prueba del modelo nuevo (Organización y Ubicaciones) con
// registros de la estructura anterior pendientes de recarga y centros de
// costo vinculados a ambos árboles.
export const treeCatalog: OrgStructureCatalog = {
  companies: [{ id: "c1", code: "EMP-1", name: "Los O'Dwyer", legalName: "Los O'Dwyer SA", cuit: "30-1", status: "ACTIVO" }],
  businessUnits: [{ id: "bu1", code: "UN-1", name: "Producción", companyId: "c1", status: "ACTIVO" }],
  sectors: [
    { id: "s1", code: "SEC-1", name: "Recursos Humanos", businessUnitId: "bu1", status: "ACTIVO" },
    { id: "s2", code: "SEC-2", name: "Compras", businessUnitId: "bu1", status: "ACTIVO" },
    { id: "s-old", code: "SEC-90", name: "Depósito anterior", areaId: "a-old", pendingReload: true, status: "ACTIVO" },
  ],
  areas: [
    { id: "a1", code: "AREA-1", name: "Liquidaciones", sectorId: "s1", status: "ACTIVO" },
    { id: "a-old", code: "AREA-90", name: "Administración anterior", establishmentId: "e-old", pendingReload: true, status: "ACTIVO" },
  ],
  zones: [{ id: "z1", code: "ZN-1", name: "Litoral", status: "ACTIVO" }],
  establishments: [
    { id: "e1", code: "EST-1", name: "Planta 1", zoneId: "z1", province: "Santa Fe", department: "Rosario", locality: "Rosario", address: "Calle", status: "ACTIVO" },
    { id: "e-old", code: "EST-90", name: "Casa central anterior", companyId: "c1", businessUnitId: "bu1", pendingReload: true, province: "", department: "", locality: "", address: "", status: "ACTIVO" },
  ],
  costCenters: [
    { id: "cc1", code: "RH-001", name: "Centro RRHH", companyIds: [], businessUnitIds: [], establishmentIds: ["e1"], areaIds: [], sectorIds: ["s1"], status: "ACTIVO" },
    { id: "cc2", code: "CC-002", name: "Con vínculo anterior", companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: [], sectorIds: ["s-old"], status: "ACTIVO" },
  ],
};
