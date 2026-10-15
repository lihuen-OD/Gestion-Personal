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
  provinces: [{ id: "p1", code: "SF", name: "Santa Fe", status: "ACTIVO" }],
  zones: [
    { id: "z1", code: "ZN-1", name: "Litoral", provinceId: "p1", status: "ACTIVO" },
    // Zona anterior a la provincia: pendiente de recarga, sigue en uso.
    { id: "z-old", code: "ZN-9", name: "Zona previa", status: "ACTIVO" },
  ],
  establishments: [
    { id: "e1", code: "EST-1", name: "Planta 1", zoneId: "z1", province: "Santa Fe", department: "Rosario", locality: "Rosario", address: "Calle", status: "ACTIVO" },
    { id: "e2", code: "EST-2", name: "Oficina Central", zoneId: "z-old", province: "", department: "", locality: "", address: "", status: "ACTIVO" },
    { id: "e-old", code: "EST-90", name: "Casa central anterior", companyId: "c1", businessUnitId: "bu1", pendingReload: true, province: "", department: "", locality: "", address: "", status: "ACTIVO" },
  ],
  establishmentUnits: [
    { id: "u2", code: "UNI-2", name: "Lote Sur", establishmentId: "e1", status: "ACTIVO" },
    { id: "u1", code: "UNI-1", name: "Lote Norte", establishmentId: "e1", status: "ACTIVO" },
  ],
  costCenters: [
    { id: "cc1", code: "RH-001", name: "Centro RRHH", companyIds: [], businessUnitIds: [], establishmentIds: ["e1"], areaIds: [], sectorIds: ["s1"], status: "ACTIVO" },
    { id: "cc2", code: "CC-002", name: "Con vínculo anterior", companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: [], sectorIds: ["s-old"], status: "ACTIVO" },
  ],
};
