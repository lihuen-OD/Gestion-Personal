import type { MonthlyClosure } from "../services/api/workforceApiService";

// Etapa 15K: extraído de MonthlyClosuresPage para que el panel de revisión
// (MonthlyClosureReviewPanel) use exactamente el mismo texto/color de estado
// sin duplicar el mapeo ni crear un import circular página↔componente.
export const monthlyClosureStatusText: Record<MonthlyClosure["status"], string> = {
  ABIERTO: "Abierto",
  ENVIADO: "Esperando a RH",
  APROBADO: "Aprobado por RH",
  DEVUELTO: "Devuelto para corregir",
  CORRECCION_PENDIENTE: "Corrección pendiente",
};

export function monthlyClosureStatusTone(status: MonthlyClosure["status"]) {
  return status === "APROBADO" ? "success" : status === "DEVUELTO" ? "danger" : status === "ABIERTO" ? "neutral" : "warning";
}
