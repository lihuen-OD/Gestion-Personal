import type { OpenShiftOverflowAction, WorkRegimeKind, WorkRegimeStatus } from "../../types/workRegime.types";

// WorkRegimeKind/OpenShiftOverflowAction describen comportamiento genérico
// (ver backend). Los nombres reales (Cosecha, Riego, Campaña, etc.) los
// carga RRHH en code/name de cada régimen — nunca acá.
export const workRegimeKindLabels: Record<WorkRegimeKind, string> = {
  TURNO_OBLIGATORIO: "Turno obligatorio",
  TURNO_FLEXIBLE: "Turno flexible",
  SIN_TURNO: "Sin turno obligatorio",
};

export const openShiftOverflowActionLabels: Record<OpenShiftOverflowAction, string> = {
  ROLLOVER: "Cierre automático",
  ALERT_ONLY: "Solo alerta / revisión RRHH",
};

export function workRegimeKindLabel(kind: WorkRegimeKind) {
  return workRegimeKindLabels[kind] || kind;
}

export function openShiftOverflowActionLabel(action: OpenShiftOverflowAction) {
  return openShiftOverflowActionLabels[action] || action;
}

export function workRegimeStatusTone(status: WorkRegimeStatus): "success" | "neutral" {
  return status === "ACTIVO" ? "success" : "neutral";
}

export const workRegimeKindOptions: WorkRegimeKind[] = ["TURNO_OBLIGATORIO", "TURNO_FLEXIBLE", "SIN_TURNO"];
export const openShiftOverflowActionOptions: OpenShiftOverflowAction[] = ["ROLLOVER", "ALERT_ONLY"];
