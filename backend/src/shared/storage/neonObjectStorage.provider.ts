import crypto from "node:crypto";
import { env } from "../../config/env";
import { AppError } from "../errors/AppError";
import type { StorageObjectInput, StorageObjectResult, StorageProvider } from "./storage.types";

const SERVICE = "s3";

function configuration() {
  const values = {
    endpoint: env.NEON_OBJECT_STORAGE_ENDPOINT,
    region: env.NEON_OBJECT_STORAGE_REGION,
    bucket: env.NEON_OBJECT_STORAGE_BUCKET,
    accessKeyId: env.NEON_OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.NEON_OBJECT_STORAGE_SECRET_ACCESS_KEY,
  };
  if (Object.values(values).some((value) => !value)) throw new AppError("Neon Object Storage is not configured", 501, "STORAGE_NEON_NOT_CONFIGURED");
  return values as Record<keyof typeof values, string>;
}

function sha256(value: crypto.BinaryLike) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key: crypto.BinaryLike, value: string) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function objectKey(input: StorageObjectInput) {
  const parts = input.folderSegments?.length ? input.folderSegments : (input.folder || "temporales").split(/[\\/]+/);
  const key = [...parts, input.fileName].filter(Boolean).join("/");
  if (!key || key.startsWith("/") || key.split("/").some((part) => part === "." || part === "..")) throw new AppError("Ruta de storage inválida", 400, "STORAGE_INVALID_PATH");
  return key;
}

function objectUrl(endpoint: string, bucket: string, key: string) {
  return `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function signedRequest(method: string, key: string, options: { body?: Buffer; mimeType?: string; metadata?: Record<string, string> } = {}) {
  const config = configuration();
  const url = new URL(objectUrl(config.endpoint, config.bucket, key));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(options.body || Buffer.alloc(0));
  const headers = new Headers({ host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate });
  if (options.mimeType) headers.set("content-type", options.mimeType);
  for (const [name, value] of Object.entries(options.metadata || {})) headers.set(`x-amz-meta-${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`, value.slice(0, 1024));
  const signedNames = [...headers.keys()].sort();
  const canonicalHeaders = signedNames.map((name) => `${name}:${headers.get(name)!.trim()}\n`).join("");
  const canonicalRequest = [method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedNames.join(";"), payloadHash].join("\n");
  const scope = `${date}/${config.region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date), config.region), SERVICE), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers.set("authorization", `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}`);
  try {
    return await fetch(url, { method, headers, body: options.body, signal: AbortSignal.timeout(env.NEON_OBJECT_STORAGE_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) throw new AppError("Neon Object Storage timeout", 504, "STORAGE_NEON_TIMEOUT");
    throw new AppError("Neon Object Storage unavailable", 502, "STORAGE_NEON_UNAVAILABLE");
  }
}

async function requireOk(response: Response, operation: string) {
  if (response.ok) return;
  if (response.status === 404) throw new AppError("Archivo no encontrado", 404, "STORAGE_NEON_OBJECT_NOT_FOUND");
  if (response.status === 401 || response.status === 403) throw new AppError("Neon Object Storage authentication failed", 502, "STORAGE_NEON_AUTH_FAILED");
  throw new AppError(`Neon Object Storage ${operation} failed`, response.status >= 500 ? 502 : 400, "STORAGE_NEON_API_ERROR");
}

export const neonObjectStorageProvider: StorageProvider = {
  async upload(input: StorageObjectInput): Promise<StorageObjectResult> {
    if (!input.buffer) throw new AppError("File buffer is required for Neon Object Storage upload", 400, "STORAGE_FILE_BUFFER_REQUIRED");
    const key = objectKey(input);
    const checksumSha256 = sha256(input.buffer);
    const response = await signedRequest("PUT", key, {
      body: input.buffer,
      mimeType: input.mimeType,
      metadata: { ...(input.metadata || {}), sha256: checksumSha256 },
    });
    await requireOk(response, "upload");
    return {
      provider: "neon_object_storage",
      storageKey: key,
      sizeBytes: input.buffer.length,
      etag: response.headers.get("etag") || undefined,
      checksumSha256,
    };
  },
  async download(storageKey: string) {
    const response = await signedRequest("GET", storageKey);
    await requireOk(response, "download");
    return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get("content-type") || undefined };
  },
  async delete(storageKey: string) {
    const response = await signedRequest("DELETE", storageKey);
    await requireOk(response, "delete");
  },
  async exists(storageKey: string) {
    const response = await signedRequest("HEAD", storageKey);
    if (response.status === 404) return false;
    await requireOk(response, "head");
    return true;
  },
  getPublicUrl() { return undefined; },
  getFilePath() { return undefined; },
};
