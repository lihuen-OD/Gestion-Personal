import { ApiError, apiRequest } from "./apiClient";
import type { DeletionPreview } from "../../types/deletion.types";

/**
 * Protocolo común de eliminación controlada (docs/BACKEND_API_CONTRACTS.md,
 * "Eliminación controlada con dependencias"): `basePath` es el recurso, por
 * ejemplo `/org-structure/zones/<id>` o `/positions/<id>`.
 */
export const deletionApiService = {
  preview(basePath: string) {
    return apiRequest<{ data: DeletionPreview }>(`${basePath}/deletion-preview`).then((response) => response.data);
  },

  /** Los errores se muestran en el modal (sin aviso global). */
  confirm(basePath: string, preview: DeletionPreview, confirmationText: string) {
    return apiRequest<{ data: unknown }>(`${basePath}/deletion`, {
      method: "POST",
      body: { token: preview.token, ...(preview.requiresTypedConfirmation ? { confirmationText } : {}) },
      silentErrors: true,
    });
  },
};

/** Vista previa actualizada que devuelve un 409 (dependencias cambiadas o bloqueo), si vino. */
export function deletionPreviewFromError(error: unknown): DeletionPreview | null {
  if (!(error instanceof ApiError) || !["DELETION_PREVIEW_CHANGED", "DELETION_BLOCKED"].includes(error.code)) return null;
  const preview = (error.payload as { preview?: DeletionPreview } | undefined)?.preview;
  return preview && typeof preview.token === "string" ? preview : null;
}
