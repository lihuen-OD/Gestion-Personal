export type OrgChartTab = "FUNCTIONAL" | "CATEGORIES";

export function OrgChartTabs({ active, onChange }: { active: OrgChartTab; onChange: (tab: OrgChartTab) => void }) {
  return <div className="tabs org-tabs">
    <button className={active === "FUNCTIONAL" ? "active" : ""} onClick={() => onChange("FUNCTIONAL")}>Organigrama funcional</button>
    <button className={active === "CATEGORIES" ? "active" : ""} onClick={() => onChange("CATEGORIES")}>Organigrama por categorías</button>
  </div>;
}
