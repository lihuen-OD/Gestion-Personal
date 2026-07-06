import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";

export function ErrorState({ title = "No se pudo cargar la información", message = "Ocurrió un problema al obtener los datos. Intentá nuevamente o contactá al área de sistemas.", onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <span className="empty-icon danger"><AlertTriangle size={20} /></span>
      <strong>{title}</strong>
      <span>{message}</span>
      {onRetry && <Button variant="subtle" onClick={onRetry}>Reintentar</Button>}
    </div>
  );
}
