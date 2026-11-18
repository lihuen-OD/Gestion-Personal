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

/**
 * Nombre visible de una carpeta de Google Drive: a diferencia de
 * `safeFileName`, conserva espacios, acentos y Ñ (`0007 - José Peña`). Sólo
 * quita caracteres de control y los reservados por Windows/Drive para
 * escritorio (`\ / : * ? " < > |`), colapsa espacios y quita puntos iniciales
 * (`.` y `..` quedan vacíos y los rechaza el provider). Idempotente: un
 * segmento ya ASCII-seguro (`documentos-personales`, `2026`) no cambia.
 */
export function safeDriveFolderName(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
}

export function fileExtension(fileName: string) {
  return path.extname(fileName).toLowerCase().replace(/^\./, "");
}

const extensionsByMimeType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/** Extensión de respaldo cuando el nombre original no trae una (sólo MIME permitidos). */
export function extensionFromMimeType(mimeType: string) {
  return extensionsByMimeType[mimeType] || "";
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
