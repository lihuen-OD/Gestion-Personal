import crypto from "node:crypto";
import { env } from "../../config/env";
import { AppError } from "../errors/AppError";
import { safeFileName } from "./storageValidation";
import type { StorageObjectInput, StorageObjectResult, StorageProvider } from "./storage.types";

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
const folderCache = new Map<string, string>();
const folderInflight = new Map<string, Promise<string>>();

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

function folderSegments(input: StorageObjectInput) {
  if (input.folderSegments?.length) return input.folderSegments;
  return (input.folder || "temporales").split(/[\\/]+/).filter(Boolean);
}

function safeFolderSegment(value: string) {
  const safe = safeFileName(value);
  if (!safe || safe === "." || safe === "..") {
    throw new AppError("Ruta de storage inválida", 400, "STORAGE_INVALID_PATH");
  }
  return safe;
}

function escapeQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFolder(parentId: string, name: string) {
  const query = [
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `'${escapeQueryValue(parentId)}' in parents`,
    `name = '${escapeQueryValue(name)}'`,
  ].join(" and ");
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const response = await driveRequest<{ files: DriveFile[] }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const data = await response.json() as { files: DriveFile[] };
  return data.files[0]?.id;
}

async function createFolder(parentId: string, name: string) {
  const response = await driveRequest<DriveFile>("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const data = await response.json() as DriveFile;
  return data.id;
}

async function findOrCreatePath(segments: string[]) {
  assertConfigured();
  let parentId = env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
  const normalized = segments.map(safeFolderSegment);
  for (const segment of normalized) {
    const cacheKey = `${parentId}/${segment}`;
    const cached = folderCache.get(cacheKey);
    if (cached) {
      parentId = cached;
      continue;
    }
    let pending = folderInflight.get(cacheKey);
    if (!pending) {
      pending = (async () => (await findFolder(parentId, segment)) || createFolder(parentId, segment))();
      folderInflight.set(cacheKey, pending);
    }
    let folderId: string;
    try {
      folderId = await pending;
    } finally {
      folderInflight.delete(cacheKey);
    }
    folderCache.set(cacheKey, folderId);
    parentId = folderId;
  }
  return parentId;
}

export const googleDriveStorageProvider: StorageProvider = {
  async upload(input: StorageObjectInput): Promise<StorageObjectResult> {
    assertConfigured();
    if (!input.buffer) {
      throw new AppError("File buffer is required for Google Drive upload", 400, "STORAGE_FILE_BUFFER_REQUIRED");
    }

    const driveFolderId = await findOrCreatePath(folderSegments(input));
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
