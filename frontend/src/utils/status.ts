export type StatusTone = "success" | "warning" | "danger" | "neutral";

export function statusTone(value: string): StatusTone {
  if (["Activo", "Aprobado", "Vigente", "Exportado"].includes(value)) return "success";
  if (["Inactivo", "Rechazado", "Vencido", "Devuelto"].includes(value)) return "danger";
  if (["En revisión", "Pendiente", "Por vencer"].includes(value)) return "warning";
  return "neutral";
}

// Etapa 15M.20: el par "ACTIVO"/"INACTIVO" (enum crudo del backend, en varios
// catálogos: estructura organizacional, conceptos horarios, categorías
// documentales, parámetros de auditoría, puestos) se reimplementaba con un
// ternario ad-hoc en cada pantalla — un único punto de verdad acá.
export function activoInactivoLabel(value: string): string {
  if (value === "ACTIVO") return "Activo";
  if (value === "INACTIVO") return "Inactivo";
  return "Estado desconocido";
}

const workShiftStatusLabels: Record<string, string> = {
  ABIERTO: "Abierta",
  PROCESADO: "Procesada",
  OBSERVADO: "Observada",
  ANULADO: "Anulada",
  FALTA_SALIDA: "Falta registrar salida",
  FALTA_INGRESO: "Falta registrar ingreso",
  INVALIDO: "Inválida",
  REVISADO: "Revisada",
  CERRADO_MANUAL: "Cerrada manualmente",
};

const workShiftStatusTones: Record<string, StatusTone> = {
  ABIERTO: "neutral",
  PROCESADO: "success",
  OBSERVADO: "warning",
  ANULADO: "danger",
  FALTA_SALIDA: "danger",
  FALTA_INGRESO: "danger",
  INVALIDO: "danger",
  REVISADO: "success",
  CERRADO_MANUAL: "neutral",
};

export function workShiftStatusLabel(value: string): string {
  return workShiftStatusLabels[value] || "Estado de jornada desconocido";
}

export function workShiftStatusTone(value: string): StatusTone {
  return workShiftStatusTones[value] || "neutral";
}
