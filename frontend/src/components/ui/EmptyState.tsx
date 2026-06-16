import { Archive } from "lucide-react";

export function EmptyState({ text }: { text: string }) {
  return <div className="empty"><span className="empty-icon"><Archive size={20} /></span><strong>Sin resultados</strong><span>{text}</span></div>;
}
