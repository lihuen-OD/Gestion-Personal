import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { clearAllAppCaches } from "../cache";
import { orgStructureApiService } from "./orgStructureApiService";

vi.mock("./apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiClient")>();
  return { ...actual, apiRequest: vi.fn() };
});

const request = vi.mocked(apiRequest);

beforeEach(async () => {
  request.mockReset();
  await clearAllAppCaches("test");
});

// Contrato de A2 (docs/BACKEND_API_CONTRACTS.md → Estructura organizacional):
// el overview trae el padre del modelo nuevo y, hasta M2, los padres anteriores
// sólo de lectura; las escrituras envían sólo el padre del modelo nuevo.
describe("orgStructureApiService — catálogo", () => {
  it("mapea zonas y padres nuevos, y marca pendiente de recarga lo que no tiene padre nuevo", async () => {
    request.mockResolvedValueOnce({
      data: {
        companies: [], businessUnits: [], costCenters: [],
        sectors: [{ id: "s1", code: "SEC-1", name: "Cocina", status: "ACTIVO", businessUnitId: "bu1", areaId: null }, { id: "s0", code: "SEC-0", name: "Viejo", status: "ACTIVO", businessUnitId: null, areaId: "a0" }],
        areas: [{ id: "a1", code: "AREA-1", name: "Parrilla", status: "ACTIVO", sectorId: "s1", establishmentId: null }],
        zones: [{ id: "z1", code: "ZN-1", name: "Litoral", status: "ACTIVO" }],
        establishments: [{ id: "e0", code: "EST-0", name: "Viejo", status: "ACTIVO", zoneId: null, companyId: "c1", businessUnitId: null }],
      },
    });

    const catalog = await orgStructureApiService.getCatalog();

    expect(catalog.zones).toEqual([{ id: "z1", code: "ZN-1", name: "Litoral", status: "ACTIVO" }]);
    expect(catalog.sectors.map((item) => [item.id, item.pendingReload])).toEqual([["s1", false], ["s0", true]]);
    expect(catalog.sectors[1]).toMatchObject({ areaId: "a0", businessUnitId: undefined });
    expect(catalog.areas[0]).toMatchObject({ sectorId: "s1", pendingReload: false });
    expect(catalog.establishments[0]).toMatchObject({ zoneId: undefined, companyId: "c1", pendingReload: true });
  });
});

describe("orgStructureApiService — escrituras", () => {
  beforeEach(() => request.mockResolvedValue({ data: {} }));

  it("un sector nuevo envía su unidad de negocio y nunca el área anterior", async () => {
    await orgStructureApiService.createSector({ id: "tmp", code: "SEC-2", name: "Salón", status: "ACTIVO", businessUnitId: "bu1", areaId: "a-old" });
    expect(request).toHaveBeenCalledWith("/org-structure/sectors", { method: "POST", body: { code: "SEC-2", name: "Salón", status: "ACTIVO", businessUnitId: "bu1" } });
  });

  it("editar un registro anterior no envía padre (el backend no lo reubica)", async () => {
    await orgStructureApiService.updateArea({ id: "a-old", code: "AREA-9", name: "Vieja", status: "INACTIVO", establishmentId: "e-old", pendingReload: true });
    expect(request).toHaveBeenCalledWith("/org-structure/areas/a-old", { method: "PATCH", body: { code: "AREA-9", name: "Vieja", status: "INACTIVO" } });
  });

  it("un establecimiento envía su zona y domicilio, sin empresa ni unidad de negocio", async () => {
    await orgStructureApiService.createEstablishment({ id: "tmp", code: "EST-2", name: "Local Norte", status: "ACTIVO", zoneId: "z1", companyId: "c1", province: "Santa Fe", department: "Rosario", locality: "Rosario", address: "Bv. Oroño", streetNumber: "100", postalCode: "" });
    expect(request).toHaveBeenCalledWith("/org-structure/establishments", { method: "POST", body: { code: "EST-2", name: "Local Norte", status: "ACTIVO", zoneId: "z1", province: "Santa Fe", department: "Rosario", city: "Rosario", street: "Bv. Oroño", streetNumber: "100", postalCode: null } });
  });

  it("zonas: alta, edición y eliminación por su propia ruta", async () => {
    await orgStructureApiService.createZone({ id: "tmp", code: "ZN-2", name: "Norte", status: "ACTIVO" });
    await orgStructureApiService.deleteEntity("ZONE", "z2");
    expect(request).toHaveBeenCalledWith("/org-structure/zones", { method: "POST", body: { code: "ZN-2", name: "Norte", status: "ACTIVO" } });
    expect(request).toHaveBeenCalledWith("/org-structure/zones/z2", { method: "DELETE" });
  });
});
