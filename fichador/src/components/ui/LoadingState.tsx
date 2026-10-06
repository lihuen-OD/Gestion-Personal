// Copia de la variante "block" de frontend/src/components/ui/LoadingState.tsx,
// la única que usa el fichador.
export function LoadingState({ text = "Cargando..." }: { text?: string }) {
  return <div className="empty"><span className="skeleton-bar" style={{ width: 120, height: 12 }} /><span>{text}</span></div>;
}
