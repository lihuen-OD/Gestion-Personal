import { AppError } from "../errors/AppError";
import { env } from "../../config/env";
import crypto from "node:crypto";
import type { StorageObjectInput, StorageObjectResult, StorageProvider } from "./storage.types";

type CloudinaryUploadResponse = {
  public_id?: string;
  secure_url?: string;
  resource_type?: string;
  type?: string;
  asset_id?: string;
  version?: number | string;
  format?: string;
  bytes?: number;
  error?: { message?: string };
};

type CloudinaryDestroyResponse = {
  result?: string;
  error?: { message?: string };
};

// Etapa 15D.3 (docs/decisions/CLOUDINARY_SECURE_DELIVERY_15D3.md): todo
// upload NUEVO queda con este delivery type — Cloudinary nunca sirve el
// recurso por su URL pública sin una request firmada. No es configurable
// todavía (eso, junto con permisos por categoría, queda para 15D.4).
const DEFAULT_DELIVERY_TYPE = "authenticated";

// Fallbacks SÓLO para archivos subidos antes de esta etapa, sin metadata
// persistida — reproducen exactamente el comportamiento legacy que cada
// operación asumía de forma hardcodeada (delete asumía "image", download
// asumía "raw"), para no romper el acceso a documentos ya existentes.
const LEGACY_DELETE_RESOURCE_TYPE = "image";
const LEGACY_DOWNLOAD_RESOURCE_TYPE = "raw";
const LEGACY_DELIVERY_TYPE = "upload";

function assertConfigured() {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new AppError(
      "Cloudinary storage provider is not configured yet",
      501,
      "STORAGE_CLOUDINARY_NOT_CONFIGURED",
    );
  }
}

function safePath(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function publicIdFor(input: StorageObjectInput) {
  const withoutExtension = input.fileName.replace(/\.[^.]+$/, "");
  return `${Date.now()}-${safePath(withoutExtension) || "documento"}`;
}

function signature(params: Record<string, string>) {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto.createHash("sha1").update(`${payload}${env.CLOUDINARY_API_SECRET}`).digest("hex");
}

function metadataObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function metadataString(value: unknown, key: string): string | undefined {
  const meta = metadataObject(value);
  const found = meta?.[key];
  return typeof found === "string" && found ? found : undefined;
}

function resourceTypeFrom(metadata: unknown, legacyFallback: string) {
  return metadataString(metadata, "cloudinaryResourceType") || legacyFallback;
}

function deliveryTypeFrom(metadata: unknown) {
  return metadataString(metadata, "cloudinaryDeliveryType") || LEGACY_DELIVERY_TYPE;
}

export const cloudinaryStorageProvider: StorageProvider = {
  async upload(input: StorageObjectInput): Promise<StorageObjectResult> {
    assertConfigured();
    if (!input.buffer) {
      throw new AppError("File buffer is required for Cloudinary upload", 400, "STORAGE_FILE_BUFFER_REQUIRED");
    }

    const folder = safePath(`${env.CLOUDINARY_FOLDER}/${input.folder || "documents"}`);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const publicId = publicIdFor(input);
    const params = { folder, public_id: publicId, timestamp, type: DEFAULT_DELIVERY_TYPE };
    const form = new FormData();
    form.append("file", `data:${input.mimeType};base64,${input.buffer.toString("base64")}`);
    form.append("api_key", env.CLOUDINARY_API_KEY);
    form.append("timestamp", timestamp);
    form.append("folder", folder);
    form.append("public_id", publicId);
    form.append("type", DEFAULT_DELIVERY_TYPE);
    form.append("signature", signature(params));

    const response = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/auto/upload`, {
      method: "POST",
      body: form,
    });
    const data = (await response.json()) as CloudinaryUploadResponse;
    if (!response.ok || data.error || !data.public_id) {
      throw new AppError(
        data.error?.message || "Cloudinary upload failed",
        502,
        "STORAGE_CLOUDINARY_UPLOAD_FAILED",
      );
    }

    return {
      storageKey: data.public_id,
      // Informativo únicamente — Etapa 15D.3: nunca se usa como URL de
      // acceso del cliente. Ver getPublicUrl más abajo.
      publicUrl: data.secure_url,
      provider: "cloudinary",
      sizeBytes: data.bytes,
      cloudinaryResourceType: data.resource_type,
      cloudinaryDeliveryType: data.type || DEFAULT_DELIVERY_TYPE,
      cloudinaryAssetId: data.asset_id,
      cloudinaryVersion: data.version === undefined ? undefined : String(data.version),
      cloudinaryFormat: data.format,
    };
  },

  async delete(storageKey: string, metadata?: unknown) {
    assertConfigured();
    const resourceType = resourceTypeFrom(metadata, LEGACY_DELETE_RESOURCE_TYPE);
    const deliveryType = deliveryTypeFrom(metadata);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = { public_id: storageKey, timestamp, type: deliveryType };
    const form = new FormData();
    form.append("public_id", storageKey);
    form.append("api_key", env.CLOUDINARY_API_KEY);
    form.append("timestamp", timestamp);
    form.append("type", deliveryType);
    form.append("signature", signature(params));

    const response = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`, {
      method: "POST",
      body: form,
    });
    const data = (await response.json().catch(() => ({}))) as CloudinaryDestroyResponse;
    // Cloudinary responde 200 con result:"not found" cuando el recurso ya
    // no existe — comportamiento idempotente, no es un error (mismo
    // criterio que deleteManaged con un StorageFile ya DELETED).
    if (data.result === "not found") return;
    if (!response.ok || data.error) {
      throw new AppError(
        data.error?.message || "Cloudinary delete failed",
        502,
        "STORAGE_CLOUDINARY_DELETE_FAILED",
      );
    }
  },

  /**
   * Etapa 15D.3: Cloudinary nunca entrega una URL pública permanente para
   * que el cliente la use directamente (ni para archivos nuevos ni para
   * legacy) — devuelve siempre `undefined`. Los tres llamadores actuales
   * (documentos, storage genérico, fichadas) ya tratan un `publicUrl`
   * ausente como "seguir con download()", así que caen automáticamente al
   * buffer servido por el backend autenticado sin necesitar ningún cambio
   * en esos llamadores. Ver docs/decisions/CLOUDINARY_SECURE_DELIVERY_15D3.md.
   */
  getPublicUrl() {
    return undefined;
  },

  getFilePath() {
    return undefined;
  },

  async download(storageKey: string, metadata?: unknown) {
    assertConfigured();
    const deliveryType = deliveryTypeFrom(metadata);

    if (deliveryType === LEGACY_DELIVERY_TYPE) {
      // Legacy (subido antes de 15D.3, sin metadata): mismo mecanismo que
      // antes de esta etapa — fetch directo, server-side, de la URL
      // pública de Cloudinary. Nunca se expone esta URL al cliente; sólo
      // se usa acá, dentro del backend, para traer los bytes.
      const resourceType = resourceTypeFrom(metadata, LEGACY_DOWNLOAD_RESOURCE_TYPE);
      const url = `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload/${storageKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new AppError("Cloudinary download failed", 502, "STORAGE_CLOUDINARY_DOWNLOAD_FAILED");
      }
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        mimeType: response.headers.get("content-type") || undefined,
      };
    }

    // private/authenticated (todo upload nuevo desde 15D.3): pedir una URL
    // de descarga firmada de vida corta al Upload API (mismo esquema de
    // firma que upload/destroy) y traer los bytes server-side. Esa URL
    // firmada nunca se expone al cliente — sólo la usa este fetch interno.
    const resourceType = resourceTypeFrom(metadata, LEGACY_DOWNLOAD_RESOURCE_TYPE);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = { public_id: storageKey, timestamp, type: deliveryType };
    const query = new URLSearchParams();
    query.append("public_id", storageKey);
    query.append("timestamp", timestamp);
    query.append("type", deliveryType);
    // assertConfigured() ya garantizó que está seteado.
    query.append("api_key", env.CLOUDINARY_API_KEY!);
    query.append("signature", signature(params));

    const downloadUrl = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/download?${query.toString()}`;
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new AppError("Cloudinary download failed", 502, "STORAGE_CLOUDINARY_DOWNLOAD_FAILED");
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type") || undefined,
    };
  },
};
