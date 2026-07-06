import type { ReactNode } from "react";

type BadgeTone = "success" | "warning" | "danger" | "neutral";

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
