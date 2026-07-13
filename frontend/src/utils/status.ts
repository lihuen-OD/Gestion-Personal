export type StatusTone = "success" | "warning" | "danger" | "neutral";

export function statusTone(value: string): StatusTone {
  if (["Activo", "Aprobado", "Vigente", "Exportado"].includes(value)) return "success";
  if (["Inactivo", "Rechazado", "Vencido", "Devuelto"].includes(value)) return "danger";
  if (["En revisión", "Pendiente", "Por vencer"].includes(value)) return "warning";
  return "neutral";
}

export const statusDescriptions: Record<string, string> = {
  Borrador: "Cargado pero todavía no enviado a revisión.",
  Pendiente: "Todavía no se cargó ningún registro para este período.",
  "En revisión": "Enviado. Un supervisor o RRHH tiene que aprobarlo, rechazarlo o devolverlo.",
  Devuelto: "Un supervisor o RRHH pidió una corrección. Hay que revisar el motivo y volver a enviarlo.",
  Aprobado: "Revisado y aprobado. Cuenta para la liquidación.",
  Rechazado: "Revisado y rechazado. No cuenta para la liquidación.",
  Cerrado: "Período cerrado, ya no se puede editar.",
  Exportado: "Ya se exportó para liquidación.",
};

export function statusClass(value: string) {
  return `badge ${statusTone(value)}`;
}
