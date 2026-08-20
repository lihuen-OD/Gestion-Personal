import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";

// size="compact": mismo criterio que EmptyState — para paneles internos ya
// dentro de otra card, sin ícono ni título, una sola línea corta.
export function ErrorState({
  title = "No se pudo cargar la información",
  message = "Ocurrió un problema al obtener los datos. Intentá nuevamente o contactá al área de sistemas.",
  onRetry,
  size = "default",
}: { title?: string; message?: string; onRetry?: () => void; size?: "default" | "compact" }) {
  if (size === "compact") {
    return (
      <div className="empty empty-compact">
        <span>{message}</span>
        {onRetry && <Button variant="subtle" onClick={onRetry}>Reintentar</Button>}
      </div>
    );
  }
  return (
    <div className="empty">
      <span className="empty-icon danger"><AlertTriangle size={20} /></span>
      <strong>{title}</strong>
      <span>{message}</span>
      {onRetry && <Button variant="subtle" onClick={onRetry}>Reintentar</Button>}
    </div>
  );
}
