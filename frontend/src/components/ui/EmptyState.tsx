import { Archive, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// size="compact" (auditoría UI/UX de esta etapa): para paneles internos ya
// alojados dentro de otra card (ej. un editor embebido) — sin el ícono
// grande ni el título "Sin resultados", una sola línea de texto. size
// "default" (sin especificar) mantiene exactamente el bloque grande de
// siempre para páginas completas, cero cambio para los ~20 call sites
// existentes.
export function EmptyState({ text, icon: Icon = Archive, action, size = "default" }: { text: string; icon?: LucideIcon; action?: ReactNode; size?: "default" | "compact" }) {
  if (size === "compact") {
    return <div className="empty empty-compact"><span>{text}</span>{action}</div>;
  }
  return <div className="empty"><span className="empty-icon"><Icon size={20} /></span><strong>Sin resultados</strong><span>{text}</span>{action}</div>;
}
