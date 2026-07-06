import type { ReactNode } from "react";

export function Section({ title, subtitle, children, action, className = "" }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={`panel ${className}`.trim()}><div className="panel-head"><div className="panel-title-block"><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="panel-actions">{action}</div>}</div><div className="panel-body">{children}</div></section>;
}
