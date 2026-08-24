export function requiredLaborChangeError(from: string, reason?: string): string | null {
  if (!from) return "La fecha desde es obligatoria.";
  if (reason !== undefined && !reason.trim()) return "El motivo del cambio es obligatorio.";
  return null;
}
