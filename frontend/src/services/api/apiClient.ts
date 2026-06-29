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

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  auth?: boolean;
};

export const tokenStorage = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string) => sessionStorage.setItem(TOKEN_KEY, token),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
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

async function refreshAccessToken() {
  const refreshToken = refreshTokenStorage.get();
  if (!refreshToken) return false;

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
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await requestRaw(path, options);

  if (response.status === 401 && options.auth !== false) {
    const refreshed = await refreshAccessToken();
    if (refreshed) response = await requestRaw(path, options);
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    const error = typeof payload === "object" && payload && "error" in payload ? (payload as { error?: { code?: string; message?: string } }).error : undefined;
    throw new ApiError(error?.message || "No se pudo completar la solicitud.", error?.code || "API_ERROR", response.status);
  }

  return payload as T;
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
