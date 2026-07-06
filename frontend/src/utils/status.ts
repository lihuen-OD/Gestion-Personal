export type StatusTone = "success" | "warning" | "danger" | "neutral";

export function statusTone(value: string): StatusTone {
  if (["Activo", "Aprobado", "Vigente", "Exportado"].includes(value)) return "success";
  if (["Inactivo", "Rechazado", "Vencido"].includes(value)) return "danger";
  if (["En revisión", "Pendiente", "Por vencer"].includes(value)) return "warning";
  return "neutral";
}

export function statusClass(value: string) {
  return `badge ${statusTone(value)}`;
}
