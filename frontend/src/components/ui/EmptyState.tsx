import { Archive, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ text, icon: Icon = Archive, action }: { text: string; icon?: LucideIcon; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon size={20} /></span><strong>Sin resultados</strong><span>{text}</span>{action}</div>;
}
