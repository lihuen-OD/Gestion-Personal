import type { LucideIcon } from "lucide-react";

export function StatCard({ label, value, detail, icon: Icon, tone = "blue" }: { label: string; value: string | number; detail?: string; icon: LucideIcon; tone?: string }) {
  return <div className="stat-card"><div className="stat-copy"><small>{label}</small><strong>{value}</strong>{detail && <span>{detail}</span>}</div><div className={`stat-icon ${tone}`}><Icon size={19} /></div></div>;
}
