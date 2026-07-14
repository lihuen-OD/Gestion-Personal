import { AppError } from "../errors/AppError";
import { env } from "../../config/env";
import crypto from "node:crypto";
import type { StorageObjectInput, StorageObjectResult, StorageProvider } from "./storage.types";

type CloudinaryUploadResponse = {
  public_id?: string;
  secure_url?: string;
  resource_type?: string;
  error?: { message?: string };
};

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

export const cloudinaryStorageProvider: StorageProvider = {
  async upload(input: StorageObjectInput): Promise<StorageObjectResult> {
    assertConfigured();
    if (!input.buffer) {
      throw new AppError("File buffer is required for Cloudinary upload", 400, "STORAGE_FILE_BUFFER_REQUIRED");
    }

    const folder = safePath(`${env.CLOUDINARY_FOLDER}/${input.folder || "documents"}`);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const publicId = publicIdFor(input);
    const params = { folder, public_id: publicId, timestamp };
    const form = new FormData();
    form.append("file", `data:${input.mimeType};base64,${input.buffer.toString("base64")}`);
    form.append("api_key", env.CLOUDINARY_API_KEY);
    form.append("timestamp", timestamp);
    form.append("folder", folder);
    form.append("public_id", publicId);
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
      publicUrl: data.secure_url,
      provider: "cloudinary",
    };
  },

  async delete(storageKey: string) {
    assertConfigured();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = { public_id: storageKey, timestamp };
    const form = new FormData();
    form.append("public_id", storageKey);
    form.append("api_key", env.CLOUDINARY_API_KEY);
    form.append("timestamp", timestamp);
    form.append("signature", signature(params));

    const response = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/destroy`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      throw new AppError("Cloudinary delete failed", 502, "STORAGE_CLOUDINARY_DELETE_FAILED");
    }
  },

  getPublicUrl(storageKey: string) {
    if (!env.CLOUDINARY_CLOUD_NAME) return undefined;
    return `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/raw/upload/${storageKey}`;
  },

  getFilePath() {
    return undefined;
  },

  async download(storageKey: string) {
    const url = this.getPublicUrl(storageKey);
    if (!url) throw new AppError("Cloudinary public URL is not available", 404, "STORAGE_CLOUDINARY_FILE_NOT_AVAILABLE");
    const response = await fetch(url);
    if (!response.ok) {
      throw new AppError("Cloudinary download failed", 502, "STORAGE_CLOUDINARY_DOWNLOAD_FAILED");
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type") || undefined,
    };
  },
};
