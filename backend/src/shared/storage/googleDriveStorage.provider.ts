import crypto from "node:crypto";
import { env } from "../../config/env";
import { AppError } from "../errors/AppError";
import { safeDriveFolderName, safeFileName } from "./storageValidation";
import type { DriveFolderSpec, StorageObjectInput, StorageObjectResult, StorageProvider } from "./storage.types";

type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  webContentLink?: string;
  parents?: string[];
};

let cachedToken: { token: string; expiresAt: number } | undefined;
type FolderEntry = { id: string; name: string };
// Caché de carpetas por proceso. Si se mandan carpetas a la papelera con el
// backend corriendo, hay que reiniciarlo (si no, se sube a carpetas borradas).
const folderCache = new Map<string, FolderEntry>();
const folderInflight = new Map<string, Promise<FolderEntry>>();

function configured() {
  return Boolean(
    env.GOOGLE_DRIVE_ENABLED &&
    env.GOOGLE_DRIVE_ROOT_FOLDER_ID &&
    env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL &&
    env.GOOGLE_DRIVE_PRIVATE_KEY,
  );
}

function assertConfigured() {
  if (!configured()) {
    throw new AppError("Google Drive storage provider is not configured", 501, "STORAGE_GOOGLE_DRIVE_NOT_CONFIGURED");
  }
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKey() {
  return env.GOOGLE_DRIVE_PRIVATE_KEY!.replace(/\\n/g, "\n");
}

async function accessToken() {
  assertConfigured();
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(privateKey());
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const data = (await response.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new AppError(data.error_description || data.error || "Google Drive authentication failed", 502, "STORAGE_GOOGLE_DRIVE_AUTH_FAILED");
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedToken.token;
}

async function driveRequest<T>(url: string, init: RequestInit = {}) {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new AppError("Google Drive API error", response.status >= 500 ? 502 : response.status, "STORAGE_GOOGLE_DRIVE_API_ERROR", text.slice(0, 1000));
  }
  return response as Response & { json(): Promise<T> };
}

/**
 * Carpetas de Drive del upload: la ubicación humana (`driveFolders`) si viene;
 * si no, la técnica (`folderSegments`/`folder`) como antes.
 */
function folderSpecs(input: StorageObjectInput): DriveFolderSpec[] {
  if (input.driveFolders?.length) return input.driveFolders;
  const segments = input.folderSegments?.length ? input.folderSegments : (input.folder || "temporales").split(/[\\/]+/).filter(Boolean);
  return segments.map((name) => ({ name }));
}

// Conserva espacios, acentos y Ñ (`0007 - José Peña`); idempotente sobre los
// segmentos ASCII que ya se usaban.
function safeFolderSegment(value: string) {
  const safe = safeDriveFolderName(value);
  if (!safe || safe === "." || safe === "..") {
    throw new AppError("Ruta de storage inválida", 400, "STORAGE_INVALID_PATH");
  }
  return safe;
}

function appPropertiesQuery(properties: Record<string, string>) {
  return Object.entries(properties)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `appProperties has { key = '${escapeQueryValue(key)}' and value = '${escapeQueryValue(value)}' }`);
}

function escapeQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Carpeta hija de `parentId` por nombre o, si se pasan `appProperties`, por
 * esas propiedades (identidad estable aunque cambie el nombre visible). Ante
 * duplicados (creación concurrente desde otro proceso) usa siempre la más
 * antigua, para converger en la misma carpeta.
 */
async function findFolder(parentId: string, match: { name: string } | { appProperties: Record<string, string> }) {
  const query = [
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `'${escapeQueryValue(parentId)}' in parents`,
    ...("name" in match ? [`name = '${escapeQueryValue(match.name)}'`] : appPropertiesQuery(match.appProperties)),
  ].join(" and ");
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name)",
    orderBy: "createdTime",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const response = await driveRequest<{ files: DriveFile[] }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const data = await response.json() as { files: DriveFile[] };
  const found = data.files[0];
  return found ? { id: found.id, name: found.name || "" } : undefined;
}

async function renameFolder(folderId: string, name: string) {
  await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function isGoogleDriveConfigured() {
  return configured();
}

/**
 * F12-PERF-4: copia de archivo ya subida para un StorageFile primario (marcada
 * con appProperties.sourceStorageFileId al subirla). Permite que un job
 * reclamado de nuevo tras un lease vencido no duplique la copia en Drive.
 */
export async function findGoogleDriveArchiveCopy(sourceStorageFileId: string) {
  // Acotada a la raíz configurada (archiveRootId): una copia de otro entorno
  // con la misma service account, o de una raíz anterior, nunca se reutiliza.
  const query = [
    "trashed = false",
    ...appPropertiesQuery({ sourceStorageFileId, archiveRootId: archiveRootId() }),
  ].join(" and ");
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType,size,webViewLink,webContentLink,parents)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const response = await driveRequest<{ files: DriveFile[] }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const data = await response.json() as { files: DriveFile[] };
  return data.files[0] || null;
}

function archiveRootId() {
  assertConfigured();
  return env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
}

/**
 * appProperties de la copia de archivo de un StorageFile primario: la marca
 * con su origen y con la raíz de Drive del entorno, que es lo que consulta
 * findGoogleDriveArchiveCopy.
 */
export function googleDriveArchiveAppProperties(sourceStorageFileId: string, checksum: string | null | undefined) {
  return { sourceStorageFileId, checksum: checksum || "", archiveRootId: archiveRootId() };
}

async function createFolder(parentId: string, name: string, appProperties?: Record<string, string>) {
  const response = await driveRequest<DriveFile>("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
      ...(appProperties ? { appProperties } : {}),
    }),
  });
  const data = await response.json() as DriveFile;
  return data.id;
}

async function resolveFolder(parentId: string, spec: DriveFolderSpec, name: string): Promise<FolderEntry> {
  const identity = spec.appProperties && Object.keys(spec.appProperties).length ? spec.appProperties : undefined;
  if (!identity) {
    const found = await findFolder(parentId, { name });
    return found || { id: await createFolder(parentId, name), name };
  }
  // Carpeta con identidad (p. ej. employeeId): se reutiliza aunque haya
  // cambiado el nombre visible, y se renombra para reflejar el actual.
  const found = await findFolder(parentId, { appProperties: identity });
  if (!found) return { id: await createFolder(parentId, name, identity), name };
  if (found.name !== name) await renameFolder(found.id, name);
  return { id: found.id, name };
}

async function findOrCreatePath(specs: DriveFolderSpec[]) {
  assertConfigured();
  let parentId = env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
  for (const spec of specs) {
    const name = safeFolderSegment(spec.name);
    const identity = spec.appProperties && Object.keys(spec.appProperties).length
      ? Object.entries(spec.appProperties).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&")
      : undefined;
    const cacheKey = identity ? `${parentId}#${identity}` : `${parentId}/${name}`;
    const cached = folderCache.get(cacheKey);
    if (cached && cached.name === name) {
      parentId = cached.id;
      continue;
    }
    let pending = folderInflight.get(cacheKey);
    if (!pending) {
      pending = resolveFolder(parentId, spec, name);
      folderInflight.set(cacheKey, pending);
    }
    let folder: FolderEntry;
    try {
      folder = await pending;
    } finally {
      folderInflight.delete(cacheKey);
    }
    folderCache.set(cacheKey, folder);
    parentId = folder.id;
  }
  return parentId;
}

/** Sólo tests: vacía la caché de carpetas del proceso. */
export function resetGoogleDriveFolderCacheForTests() {
  folderCache.clear();
  folderInflight.clear();
  cachedToken = undefined;
}

export const googleDriveStorageProvider: StorageProvider = {
  async upload(input: StorageObjectInput): Promise<StorageObjectResult> {
    assertConfigured();
    if (!input.buffer) {
      throw new AppError("File buffer is required for Google Drive upload", 400, "STORAGE_FILE_BUFFER_REQUIRED");
    }

    const driveFolderId = await findOrCreatePath(folderSpecs(input));
    const fileName = safeFileName(input.fileName);
    const metadata = {
      name: fileName,
      parents: [driveFolderId],
      appProperties: input.metadata || {},
    };
    const boundary = `gestion-personal-${crypto.randomUUID()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`),
      input.buffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const response = await driveRequest<DriveFile>("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink,parents", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    const data = await response.json() as DriveFile;
    if (!data.id) throw new AppError("Google Drive upload did not return file id", 502, "STORAGE_GOOGLE_DRIVE_UPLOAD_FAILED");

    return {
      provider: "google_drive",
      storageKey: data.id,
      driveFileId: data.id,
      driveFolderId,
      driveWebViewLink: data.webViewLink,
      driveWebContentLink: data.webContentLink,
      sizeBytes: data.size ? Number(data.size) : input.buffer.length,
    };
  },

  async delete(storageKey: string) {
    await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(storageKey)}?supportsAllDrives=true`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  },

  getPublicUrl() {
    return undefined;
  },

  getFilePath() {
    return undefined;
  },

  async download(storageKey: string) {
    const response = await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(storageKey)}?alt=media&supportsAllDrives=true`);
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: response.headers.get("content-type") || undefined,
    };
  },
};
