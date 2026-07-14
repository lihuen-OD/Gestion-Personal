import crypto from "node:crypto";
import path from "node:path";
import { env } from "../../config/env";
import { AppError } from "../errors/AppError";

const allowedGeneralMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const allowedPunchPhotoMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const blockedExtensions = new Set([".exe", ".bat", ".cmd", ".sh", ".js", ".mjs", ".cjs", ".ps1", ".scr"]);

export function safeFileName(fileName: string) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180) || "archivo";
}

export function fileExtension(fileName: string) {
  return path.extname(fileName).toLowerCase().replace(/^\./, "");
}

export function checksum(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function validateStorageFile(input: { buffer?: Buffer; fileName: string; mimeType: string; purpose?: "general" | "punch-photo" }) {
  const buffer = input.buffer;
  if (!buffer || buffer.length <= 0) {
    throw new AppError("El archivo está vacío.", 400, "STORAGE_FILE_EMPTY");
  }

  const ext = path.extname(input.fileName).toLowerCase();
  if (blockedExtensions.has(ext)) {
    throw new AppError("Tipo de archivo no permitido.", 400, "STORAGE_FILE_EXTENSION_BLOCKED");
  }

  const allowed = input.purpose === "punch-photo" ? allowedPunchPhotoMimeTypes : allowedGeneralMimeTypes;
  if (!allowed.has(input.mimeType)) {
    throw new AppError("Formato de archivo no permitido.", 400, "STORAGE_FILE_MIME_BLOCKED");
  }

  const maxMb = input.purpose === "punch-photo" ? env.MAX_PUNCH_PHOTO_SIZE_MB : env.MAX_UPLOAD_SIZE_MB;
  if (buffer.length > maxMb * 1024 * 1024) {
    throw new AppError(`El archivo supera el máximo permitido de ${maxMb} MB.`, 413, "STORAGE_FILE_TOO_LARGE");
  }
}
