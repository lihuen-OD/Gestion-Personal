import { Tabs } from "../ui/Tabs";

export type OrgChartTab = "FUNCTIONAL" | "CATEGORIES";

const TAB_ITEMS = [
  { key: "FUNCTIONAL", label: "Organigrama funcional" },
  { key: "CATEGORIES", label: "Organigrama por categorías" },
];

export function OrgChartTabs({ active, onChange }: { active: OrgChartTab; onChange: (tab: OrgChartTab) => void }) {
  return <Tabs tabs={TAB_ITEMS} active={active} onChange={(key) => onChange(key as OrgChartTab)} className="org-tabs" />;
}
