const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4002/api").replace(/\/$/, "");
const TOKEN_KEY = "losod_access_token";
const REFRESH_TOKEN_KEY = "losod_refresh_token";

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export const API_ERROR_EVENT = "app:api-error";

const fieldLabels: Record<string, string> = {
  gender: "Sexo",
  nationality: "Nacionalidad",
  birthDate: "Fecha de nacimiento",
  firstName: "Nombre",
  lastName: "Apellido",
  legajo: "Legajo",
  legajoFinnegans: "Legajo Finnegans",
  dni: "DNI",
  cuil: "CUIL",
  email: "Email",
  companyIds: "Empresa",
  primaryCompanyId: "Empresa principal",
  sectorId: "Sector",
  costCenterId: "Centro de costo",
  positionId: "Puesto",
  employeeId: "Empleado",
  fromDate: "Fecha desde",
  toDate: "Fecha hasta",
  reason: "Motivo",
  fileName: "Archivo",
  categoryId: "Categoría",
};

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: {
      formErrors?: string[];
      fieldErrors?: Record<string, string[]>;
    };
  };
};

function humanizeField(field: string) {
  return fieldLabels[field] || field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

export function formatApiErrorMessage(payload: ApiErrorPayload) {
  const error = payload.error;
  const fields = Object.entries(error?.details?.fieldErrors || {})
    .filter(([, messages]) => messages?.length)
    .map(([field]) => humanizeField(field));
  if (fields.length) return `Revisá los campos obligatorios o inválidos: ${fields.join(", ")}.`;
  const formError = error?.details?.formErrors?.find(Boolean);
  return formError || error?.message || "No se pudo completar la solicitud.";
}

function notifyApiError(message: string, code: string, status: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(API_ERROR_EVENT, { detail: { message, code, status } }));
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  auth?: boolean;
  apiCache?: boolean;
  cacheTtlMs?: number;
};

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const DEFAULT_GET_CACHE_TTL_MS = 15_000;
const responseCache = new Map<string, CacheEntry>();
const pendingGetRequests = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;
let refreshPromise: Promise<boolean> | null = null;

function clearApiCache() {
  cacheGeneration += 1;
  responseCache.clear();
  pendingGetRequests.clear();
}

export const tokenStorage = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string) => {
    sessionStorage.setItem(TOKEN_KEY, token);
    clearApiCache();
  },
  clear: () => {
    sessionStorage.removeItem(TOKEN_KEY);
    clearApiCache();
  },
};

export const refreshTokenStorage = {
  get: () => sessionStorage.getItem(REFRESH_TOKEN_KEY),
  set: (token: string) => sessionStorage.setItem(REFRESH_TOKEN_KEY, token),
  clear: () => sessionStorage.removeItem(REFRESH_TOKEN_KEY),
};

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response.text();
  return response.json();
}

async function requestRaw(path: string, options: RequestOptions = {}) {
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined;

  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (options.auth !== false) {
    const token = tokenStorage.get();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
}

function cacheKey(path: string, options: RequestOptions) {
  const token = options.auth === false ? "public" : tokenStorage.get() || "anon";
  return `${options.method || "GET"}:${path}:${token}`;
}

async function requestParsed<T>(path: string, options: RequestOptions) {
  await ensureFreshAccessToken(options);
  let response = await requestRaw(path, options);

  if (response.status === 401 && options.auth !== false) {
    const refreshed = await refreshAccessToken();
    if (refreshed) response = await requestRaw(path, options);
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    const parsed = typeof payload === "object" && payload ? payload as ApiErrorPayload : {};
    const error = parsed.error;
    const message = formatApiErrorMessage(parsed);
    const code = error?.code || "API_ERROR";
    if ((options.method || "GET").toUpperCase() !== "GET" && [400, 409, 422].includes(response.status)) {
      notifyApiError(message, code, response.status);
    }
    throw new ApiError(message, code, response.status);
  }

  return payload as T;
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  const refreshToken = refreshTokenStorage.get();
  if (!refreshToken) return false;

  refreshPromise = (async () => {
    const response = await requestRaw("/auth/refresh", {
      method: "POST",
      auth: false,
      body: { refreshToken },
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      tokenStorage.clear();
      refreshTokenStorage.clear();
      return false;
    }

    const tokens = payload as { accessToken?: string; refreshToken?: string };
    if (!tokens.accessToken || !tokens.refreshToken) return false;
    tokenStorage.set(tokens.accessToken);
    refreshTokenStorage.set(tokens.refreshToken);
    return true;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

function tokenExpiresAt(token: string) {
  try {
    const [, payload] = token.split(".");
    if (!payload) return 0;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const decoded = JSON.parse(atob(padded)) as { exp?: number };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function ensureFreshAccessToken(options: RequestOptions) {
  if (options.auth === false) return;
  const method = (options.method || "GET").toUpperCase();
  if (method === "GET") return;

  const token = tokenStorage.get();
  if (!token) return;

  const expiresAt = tokenExpiresAt(token);
  if (!expiresAt || expiresAt - Date.now() > 60_000) return;

  await refreshAccessToken();
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const canCache = method === "GET" && options.apiCache === true;
  const key = canCache ? cacheKey(path, { ...options, method }) : "";

  if (canCache) {
    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    responseCache.delete(key);

    const pending = pendingGetRequests.get(key);
    if (pending) return pending as Promise<T>;
  }

  const startedGeneration = cacheGeneration;
  const request = requestParsed<T>(path, { ...options, method });

  if (canCache) {
    pendingGetRequests.set(key, request);
    try {
      const payload = await request;
      if (startedGeneration === cacheGeneration) {
        responseCache.set(key, {
          value: payload,
          expiresAt: Date.now() + (options.cacheTtlMs || DEFAULT_GET_CACHE_TTL_MS),
        });
      }
      return payload;
    } finally {
      pendingGetRequests.delete(key);
    }
  }

  try {
    return await request;
  } finally {
    if (method !== "GET") clearApiCache();
  }
}

function fileNameFromContentDisposition(value: string | null) {
  if (!value) return undefined;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return value.match(/filename="?([^";]+)"?/i)?.[1];
}

export async function apiDownload(path: string, options: Omit<RequestOptions, "body"> = {}) {
  const headers = new Headers(options.headers);
  if (options.auth !== false) {
    const token = tokenStorage.get();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  let response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && options.auth !== false) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const retryHeaders = new Headers(options.headers);
      const token = tokenStorage.get();
      if (token) retryHeaders.set("Authorization", `Bearer ${token}`);
      response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: retryHeaders,
      });
    }
  }

  if (!response.ok) {
    const payload = await parseResponse(response);
    const error = typeof payload === "object" && payload && "error" in payload ? (payload as { error?: { code?: string; message?: string } }).error : undefined;
    throw new ApiError(error?.message || "No se pudo descargar el archivo.", error?.code || "API_DOWNLOAD_ERROR", response.status);
  }

  return {
    blob: await response.blob(),
    fileName: fileNameFromContentDisposition(response.headers.get("content-disposition")),
  };
}
