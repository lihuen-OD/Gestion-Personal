// Eliminación controlada con dependencias (backend/src/shared/deletion): el
// backend calcula qué pasa con cada registro alcanzado y la confirmación se
// revalida con la huella (`token`) del plan.

export type DeletionEffect = "DELETE" | "ARCHIVE" | "UNLINK" | "END" | "REVIEW" | "RECALCULATE";

export type DeletionGroup = {
  key: string;
  effect: DeletionEffect;
  label: string;
  consequence: string;
  count: number;
  /** Hasta 50 nombres; `count` es el total. */
  items: Array<{ id: string; name: string }>;
};

export type DeletionPreview = {
  target: { kind: string; id: string; code: string | null; name: string; label: string };
  groups: DeletionGroup[];
  blockers: Array<{ code: string; message: string }>;
  requiresTypedConfirmation: boolean;
  confirmationText: string;
  token: string;
};
