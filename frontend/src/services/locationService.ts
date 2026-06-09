import { locationMockService } from "./locationMockService";

const API = "https://apis.datos.gob.ar/georef/api";

export interface GeoOption {
  id: string;
  name: string;
  provinceId?: string;
  departmentId?: string;
  censusLocalityId?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  zip?: string;
  category?: string;
  heightStart?: number;
  heightEnd?: number;
}

export interface GeocodedAddressResult {
  center: { lat: number; lng: number };
  zip?: string;
  normalizedAddress: string;
  source: "GEOREF" | "LOCALITY_CENTER";
  confidence?: number;
  fallback?: boolean;
}

const cache = new Map<string, GeoOption[]>();
const normalize = (value: string) => value.trim();

async function getJson(path: string) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`Georef ${response.status}`);
  return response.json();
}

function centerFrom(item: { centroide?: { lat?: number; lon?: number } }) {
  return typeof item.centroide?.lat === "number" && typeof item.centroide?.lon === "number" ? { lat: item.centroide.lat, lng: item.centroide.lon } : undefined;
}

function locationFrom(item: { ubicacion?: { lat?: number; lon?: number } }) {
  return typeof item.ubicacion?.lat === "number" && typeof item.ubicacion?.lon === "number" ? { lat: item.ubicacion.lat, lng: item.ubicacion.lon } : undefined;
}

function normalizedAddressFrom(item: { nomenclatura?: string; nombre?: string; altura?: { valor?: number } }, fallback: string) {
  return item.nomenclatura || [item.nombre, item.altura?.valor].filter(Boolean).join(" ") || fallback;
}

async function geocodeInGeoref(params: { provinceName: string; departmentName?: string; localityName: string; street: string; number?: string }, max = "1"): Promise<GeocodedAddressResult | undefined> {
  const address = [params.street, params.number].filter(Boolean).join(" ").trim();
  if (!address || !params.provinceName) return undefined;
  const search = new URLSearchParams({ direccion: address, provincia: params.provinceName, campos: "nomenclatura,altura,nombre,codigo_postal,ubicacion", max });
  if (params.departmentName) search.set("departamento", params.departmentName);
  if (params.localityName) search.set("localidad", params.localityName);
  const data = await getJson(`/direcciones?${search.toString()}`);
  const item = data.direcciones?.[0] as { nomenclatura?: string; nombre?: string; codigo_postal?: string | number; ubicacion?: { lat?: number; lon?: number }; altura?: { valor?: number } } | undefined;
  const center = item ? locationFrom(item) : undefined;
  if (!item || !center) return undefined;
  return {
    center,
    zip: item.codigo_postal ? String(item.codigo_postal) : "",
    normalizedAddress: normalizedAddressFrom(item, address),
    source: "GEOREF",
    confidence: params.number ? 1 : 0.55,
    fallback: !params.number,
  };
}

async function cached(key: string, loader: () => Promise<GeoOption[]>, fallback: () => GeoOption[]) {
  if (cache.has(key)) return cache.get(key)!;
  try {
    const result = await loader();
    cache.set(key, result);
    return result;
  } catch {
    const result = fallback();
    cache.set(key, result);
    return result;
  }
}

export const locationService = {
  ...locationMockService,
  getProvincesAsync: () => cached("provinces", async () => {
    const data = await getJson("/provincias?campos=id,nombre&max=30");
    return (data.provincias || []).map((item: { id: string; nombre: string }) => ({ id: item.id, name: item.nombre }));
  }, () => locationMockService.getProvinces()),
  getDepartmentsByProvinceAsync: (provinceId: string) => cached(`departments:${provinceId}`, async () => {
    const data = await getJson(`/departamentos?provincia=${encodeURIComponent(provinceId)}&campos=id,nombre,provincia&max=300`);
    return (data.departamentos || []).map((item: { id: string; nombre: string; provincia?: { id: string } }) => ({ id: item.id, name: item.nombre, provinceId: item.provincia?.id || provinceId }));
  }, () => locationMockService.getDepartmentsByProvince(provinceId)),
  searchLocalitiesAsync: (params: { provinceId?: string; departmentId?: string; query?: string }) => {
    const query = normalize(params.query || "");
    const key = `localities:${params.provinceId || ""}:${params.departmentId || ""}:${query}`;
    return cached(key, async () => {
      const search = new URLSearchParams({ campos: "id,nombre,provincia,departamento,localidad_censal,centroide", max: "80" });
      if (params.provinceId) search.set("provincia", params.provinceId);
      if (params.departmentId) search.set("departamento", params.departmentId);
      if (query) search.set("nombre", query);
      const data = await getJson(`/localidades?${search.toString()}`);
      return (data.localidades || []).map((item: { id: string; nombre: string; provincia?: { id: string }; departamento?: { id: string }; localidad_censal?: { id: string }; centroide?: { lat?: number; lon?: number }; codigo_postal?: string }) => ({
        id: item.id,
        name: item.nombre,
        provinceId: item.provincia?.id,
        departmentId: item.departamento?.id,
        censusLocalityId: item.localidad_censal?.id,
        center: centerFrom(item),
        zoom: 13,
        zip: item.codigo_postal,
      }));
    }, () => {
      if (params.departmentId) return locationMockService.searchLocalities(params.departmentId, query).map((item) => ({ id: item.id, name: item.name, departmentId: item.departmentId, provinceId: item.provinceId, center: item.center, zoom: item.zoom }));
      return [];
    });
  },
  geocodeAddressAsync: async (params: { provinceName: string; departmentName?: string; localityName: string; street: string; number: string }) => {
    if (!params.street.trim() || !params.provinceName) return undefined;
    try {
      const exact = await geocodeInGeoref(params);
      if (exact) return exact;
      return geocodeInGeoref({ ...params, number: "" });
    } catch {
      return undefined;
    }
  },
  searchStreetsAsync: (params: { provinceId?: string; departmentId?: string; localityId?: string; censusLocalityId?: string; query?: string }) => {
    const query = normalize(params.query || "");
    const key = `streets:${params.provinceId || ""}:${params.departmentId || ""}:${params.localityId || ""}:${params.censusLocalityId || ""}:${query}`;
    return cached(key, async () => {
      const search = new URLSearchParams({ campos: "id,nombre,categoria,altura,provincia,departamento,localidad_censal", max: "80" });
      if (params.provinceId) search.set("provincia", params.provinceId);
      if (params.departmentId) search.set("departamento", params.departmentId);
      if (params.censusLocalityId) search.set("localidad_censal", params.censusLocalityId);
      if (query) search.set("nombre", query);
      const data = await getJson(`/calles?${search.toString()}`);
      return (data.calles || []).map((item: { id: string; nombre: string; categoria?: string; provincia?: { id: string }; departamento?: { id: string }; localidad_censal?: { id: string }; altura?: { inicio?: { derecha?: number; izquierda?: number }; fin?: { derecha?: number; izquierda?: number } } }) => {
        const starts = [item.altura?.inicio?.derecha, item.altura?.inicio?.izquierda].filter((value): value is number => typeof value === "number");
        const ends = [item.altura?.fin?.derecha, item.altura?.fin?.izquierda].filter((value): value is number => typeof value === "number");
        return {
          id: item.id,
          name: item.nombre,
          provinceId: item.provincia?.id,
          departmentId: item.departamento?.id,
          censusLocalityId: item.localidad_censal?.id,
          category: item.categoria,
          heightStart: starts.length ? Math.min(...starts) : undefined,
          heightEnd: ends.length ? Math.max(...ends) : undefined,
        };
      });
    }, () => []);
  },
};
