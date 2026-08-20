import type { ReactNode } from "react";

// variant (auditoría UI/UX de esta etapa): "full" (default, sin cambios en
// los ~74 usos existentes) es la card de siempre. "compact" achica
// paddings/altura de header para un sub-panel que igual quiere un borde
// propio. "embedded" saca borde/sombra/fondo/padding — para usar DENTRO de
// otra card ya existente, sin producir "card dentro de card". Ver
// .panel-compact/.panel-embedded en styles.css.
export function Section({ title, subtitle, children, action, className = "", variant = "full" }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode; className?: string; variant?: "full" | "compact" | "embedded" }) {
  const variantClass = variant !== "full" ? `panel-${variant}` : "";
  return <section className={`panel ${variantClass} ${className}`.trim()}><div className="panel-head"><div className="panel-title-block"><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="panel-actions">{action}</div>}</div><div className="panel-body">{children}</div></section>;
}
