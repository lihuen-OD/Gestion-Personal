export function statusClass(value: string) {
  if (["Activo", "Aprobado", "Vigente", "Exportado"].includes(value)) return "badge success";
  if (["Inactivo", "Rechazado", "Vencido"].includes(value)) return "badge danger";
  if (["En revisión", "Pendiente", "Por vencer"].includes(value)) return "badge warning";
  return "badge neutral";
}
