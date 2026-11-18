// Validación y lectura de archivos para POST /employees/:id/documents
// (fileBase64). Única fuente compartida por la carga de documentos y la
// documentación de una novedad: mismos tipos y mismo tamaño máximo que
// acepta el backend.
export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
export const MAX_DOCUMENT_SIZE_MB = 10;
export const DOCUMENT_FILE_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx";

export function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Mensaje de negocio si el archivo no se puede adjuntar; null si es válido. */
export function documentFileProblem(file: File): string | null {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.type)) return "Formato de archivo no permitido. Usá imagen, PDF, Word o Excel.";
  if (file.size > MAX_DOCUMENT_SIZE_MB * 1024 * 1024) return `El archivo supera el máximo permitido de ${MAX_DOCUMENT_SIZE_MB} MB.`;
  return null;
}
