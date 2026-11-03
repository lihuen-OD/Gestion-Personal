import type { ReactNode } from "react";

// `info`: estados informativos que no son éxito ni alerta (p. ej. Franco).
type BadgeTone = "success" | "warning" | "danger" | "neutral" | "info";

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
