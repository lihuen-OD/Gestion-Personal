import { locationMockService } from "./locationMockService";

const API = "https://apis.datos.gob.ar/georef/api";
const PERSISTED_CACHE_PREFIX = "losod_georef:";
const PERSISTED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const RATE_LIMIT_STORAGE_KEY = "losod_georef_rate_limited_until";

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
const pending = new Map<string, Promise<GeoOption[]>>();
let rateLimitedUntil = readRateLimitedUntil();
const normalize = (value: string) => value.trim();

async function getJson(path: string) {
  if (Date.now() < rateLimitedUntil) throw new Error("Georef rate limited");
  const response = await fetch(`${API}${path}`);
  if (response.status === 429) {
    setRateLimitedUntil(Date.now() + RATE_LIMIT_COOLDOWN_MS);
  }
  if (!response.ok) throw new Error(`Georef ${response.status}`);
  return response.json();
}

function readRateLimitedUntil() {
  try {
    return Number(sessionStorage.getItem(RATE_LIMIT_STORAGE_KEY) || 0);
  } catch {
    return 0;
  }
}

function setRateLimitedUntil(value: number) {
  rateLimitedUntil = value;
  try {
    sessionStorage.setItem(RATE_LIMIT_STORAGE_KEY, String(value));
  } catch {
    // Session storage may be unavailable; the in-memory cooldown still applies.
  }
}

function persistedKey(key: string) {
  return `${PERSISTED_CACHE_PREFIX}${key}`;
}

function readPersisted(key: string) {
  try {
    const raw = localStorage.getItem(persistedKey(key));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { expiresAt?: number; data?: GeoOption[] };
    if (!parsed.expiresAt || parsed.expiresAt < Date.now() || !Array.isArray(parsed.data)) {
      localStorage.removeItem(persistedKey(key));
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

function writePersisted(key: string, data: GeoOption[]) {
  try {
    localStorage.setItem(persistedKey(key), JSON.stringify({ data, expiresAt: Date.now() + PERSISTED_CACHE_TTL_MS }));
  } catch {
    // localStorage may be full or unavailable; memory cache still protects this session.
  }
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
  const persisted = readPersisted(key);
  if (persisted) {
    cache.set(key, persisted);
    return persisted;
  }
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const request = (async () => {
    try {
      const result = await loader();
      cache.set(key, result);
      writePersisted(key, result);
      return result;
    } catch {
      const result = fallback();
      cache.set(key, result);
      return result;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, request);
  return request;
}

function emptyCached(key: string) {
  const result: GeoOption[] = [];
  cache.set(key, result);
  return result;
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
    if (query.length < 2) return Promise.resolve(cache.get(key) || emptyCached(key));
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
