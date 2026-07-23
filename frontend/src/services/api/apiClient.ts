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

export function getUserErrorMessage(error: unknown, fallback = "No pudimos completar la operación. Intentá nuevamente.") {
  return error instanceof ApiError && error.message ? error.message : fallback;
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

const errorMessagesByCode: Record<string, string> = {
  INVALID_CREDENTIALS: "El email o la contraseña no son correctos.",
  AUTH_REQUIRED: "Tu sesión venció. Iniciá sesión nuevamente.",
  INVALID_TOKEN: "Tu sesión venció. Iniciá sesión nuevamente.",
  INVALID_REFRESH_TOKEN: "Tu sesión venció. Iniciá sesión nuevamente.",
  USER_INACTIVE: "Tu usuario está inactivo. Comunicate con un administrador.",
  USER_SELF_DEACTIVATION_FORBIDDEN: "No podés inactivar tu propio usuario mientras tenés la sesión iniciada.",
  FORBIDDEN: "No tenés permisos para realizar esta acción.",
  EMPLOYEE_SCOPE_FORBIDDEN: "Uno o más legajos están fuera de tu alcance.",
  VALIDATION_ERROR: "Revisá los datos ingresados e intentá nuevamente.",
  EMPLOYEE_UNIQUE_CONSTRAINT: "Ya existe otro legajo con el mismo Legajo, Legajo Finnegans, CUIL o DNI.",
  EMPLOYEE_ALREADY_EXISTS: "Ya existe otro legajo con el mismo Legajo, Legajo Finnegans, CUIL o DNI.",
  EMPLOYEE_NOT_FOUND: "No encontramos el legajo solicitado.",
  RELATION_CONSTRAINT: "Alguno de los datos relacionados ya no está disponible. Actualizá la página y volvé a seleccionarlo.",
  UNIQUE_CONSTRAINT: "Ya existe un registro con los mismos datos únicos.",
  RECORD_NOT_FOUND: "No encontramos el registro solicitado.",
  POSITION_UNIQUE_CONSTRAINT: "Ya existe un puesto con ese código.",
  POSITION_NOT_FOUND: "No encontramos el puesto solicitado.",
  POSITION_RELATION_CONSTRAINT: "El área o sector seleccionado ya no está disponible.",
  SALARY_CATEGORY_DUPLICATED: "Ya existe una categoría salarial con esos datos.",
  SALARY_CATEGORY_NOT_FOUND: "No encontramos la categoría salarial solicitada.",
  HOUR_CONCEPT_UNIQUE_CONSTRAINT: "Ya existe un concepto de horas con ese código.",
  HOUR_CONCEPT_NOT_FOUND: "No encontramos el concepto de horas solicitado.",
  DOCUMENT_CATEGORY_DUPLICATED: "Ya existe una categoría documental con ese código.",
  DOCUMENT_CATEGORY_NOT_FOUND: "No encontramos la categoría documental solicitada.",
  DOCUMENT_NOT_FOUND: "No encontramos el documento solicitado.",
  DOCUMENT_FILE_NOT_AVAILABLE: "El archivo no está disponible.",
  DOCUMENT_FILE_NOT_FOUND: "No encontramos el archivo solicitado.",
  NOVELTY_NOT_FOUND: "No encontramos la novedad solicitada.",
  NOVELTY_TYPE_NOT_FOUND: "No encontramos el tipo de novedad solicitado.",
  NOVELTY_TYPE_NOT_AVAILABLE: "El tipo de novedad no está disponible.",
  NOVELTY_TYPE_UNIQUE_CONSTRAINT: "Ya existe un tipo de novedad con ese código o vínculo.",
  NOVELTY_APPROVAL_FORBIDDEN: "No tenés permisos para aprobar o rechazar este tipo de novedad.",
  NOVELTY_LOAD_FORBIDDEN: "No tenés permisos para cargar este tipo de novedad.",
  NOVELTY_HOURS_NOT_ALLOWED: "Este tipo de novedad no permite indicar una cantidad de horas.",
  NOVELTY_TO_DATE_NOT_ALLOWED: "Este tipo de novedad no permite indicar una fecha hasta.",
  NOVELTY_VALIDITY_REQUIRED: "Este tipo de novedad requiere fecha desde y fecha hasta.",
  NOVELTY_STATUS_NOT_APPROVABLE: "Solo se pueden aprobar novedades pendientes.",
  NOVELTY_STATUS_NOT_REJECTABLE: "Solo se pueden rechazar novedades pendientes.",
  NOVELTY_DELETE_HAS_DOCUMENTS: "La novedad tiene documentación asociada y debe conservarse para mantener la trazabilidad.",
  NOVELTY_DELETE_HAS_TIME_IMPACT: "La novedad ya generó movimientos horarios y no se puede eliminar. Debe corregirse mediante una anulación.",
  NOVELTY_DELETE_EXPORTABLE_APPROVED: "La novedad está aprobada y puede haber sido informada externamente. Debe conservarse o anularse.",
  TIME_ENTRY_NOT_FOUND: "No encontramos la carga horaria solicitada.",
  TIME_ENTRY_DUPLICATED: "Ya existe una carga para ese empleado, fecha y concepto de horas.",
  TIME_ENTRY_LOCKED: "Las cargas aprobadas o cerradas no se pueden editar.",
  TIME_ENTRY_STATUS_NOT_SUBMITTABLE: "Solo se pueden enviar cargas en borrador o devueltas.",
  TIME_ENTRY_STATUS_NOT_APPROVABLE: "Solo se pueden aprobar cargas en revisión.",
  TIME_ENTRY_STATUS_NOT_REJECTABLE: "Solo se pueden rechazar cargas en revisión.",
  TIME_ENTRY_STATUS_NOT_RETURNABLE: "Solo se pueden devolver cargas en revisión.",
  HOUR_CONCEPT_NOT_ENABLED: "El concepto de horas no está habilitado para este empleado.",
  WORK_SHIFT_NOT_FOUND: "No encontramos la jornada solicitada.",
  SHIFT_TEMPLATE_NOT_FOUND: "No encontramos el turno solicitado.",
  SHIFT_ASSIGNMENT_NOT_FOUND: "No encontramos la asignación de turno solicitada.",
  SHIFT_ALERT_NOT_FOUND: "No encontramos la alerta solicitada.",
  SHIFT_ALERT_ALREADY_RESOLVED: "La alerta ya fue resuelta.",
  EMAIL_ALREADY_EXISTS: "El email ya está asociado a otro usuario.",
  USER_NOT_FOUND: "No encontramos el usuario solicitado.",
  AUDIT_PARAMETER_DUPLICATED: "Ya existe un parámetro de auditoría con ese código.",
  AUDIT_PARAMETER_NOT_FOUND: "No encontramos el parámetro de auditoría solicitado.",
  STORAGE_FILE_NOT_FOUND: "No encontramos el archivo solicitado.",
  STORAGE_FILE_NOT_AVAILABLE: "El archivo no está disponible.",
  STORAGE_FILE_BUFFER_REQUIRED: "No pudimos procesar el archivo seleccionado.",
  STORAGE_GOOGLE_DRIVE_NOT_CONFIGURED: "El servicio de archivos no está disponible. Comunicate con el área de sistemas.",
  STORAGE_GOOGLE_DRIVE_AUTH_FAILED: "No pudimos acceder al servicio de archivos. Intentá nuevamente.",
  STORAGE_GOOGLE_DRIVE_API_ERROR: "No pudimos completar la operación con el archivo. Intentá nuevamente.",
  STORAGE_GOOGLE_DRIVE_UPLOAD_FAILED: "No pudimos guardar el archivo. Intentá nuevamente.",
  STORAGE_CLOUDINARY_DELETE_FAILED: "No pudimos eliminar el archivo. Intentá nuevamente.",
  STORAGE_CLOUDINARY_FILE_NOT_AVAILABLE: "El archivo no está disponible.",
  STORAGE_CLOUDINARY_DOWNLOAD_FAILED: "No pudimos descargar el archivo. Intentá nuevamente.",
  STORAGE_LOCAL_INVALID_KEY: "El archivo no está disponible.",
  STORAGE_LOCAL_FILE_NOT_FOUND: "No encontramos el archivo solicitado.",
  INTERNAL_ERROR: "Ocurrió un problema inesperado. Intentá nuevamente.",
  ROUTE_NOT_FOUND: "La operación solicitada no está disponible.",
  MISSING_ROUTE_PARAM: "Falta información necesaria para completar la operación.",
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

function isInternalMessage(message: string) {
  return /\b(backend|api|storage|cloudinary|google drive|not found|invalid|missing|required|already exists|unexpected server error|permission to|only (draft|entries|pending|rrhh|supervision))\b/i.test(message);
}

export function formatApiErrorMessage(payload: ApiErrorPayload) {
  const error = payload.error;
  const fields = Object.entries(error?.details?.fieldErrors || {})
    .filter(([, messages]) => messages?.length)
    .map(([field]) => humanizeField(field));
  if (fields.length) return `Revisá los campos obligatorios o inválidos: ${fields.join(", ")}.`;
  const formError = error?.details?.formErrors?.find(Boolean);
  if (formError && !isInternalMessage(formError)) return formError;
  const rawMessage = error?.message && !isInternalMessage(error.message) ? error.message : undefined;
  return (error?.code && errorMessagesByCode[error.code])
    || rawMessage
    || "No pudimos completar la operación. Intentá nuevamente.";
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
