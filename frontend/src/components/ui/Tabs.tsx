type TabItem = { key: string; label: string };

export function Tabs({ tabs, active, onChange }: { tabs: TabItem[]; active: string; onChange: (key: string) => void }) {
  return <div className="tabs">{tabs.map((tab) => <button key={tab.key} type="button" className={tab.key === active ? "active" : ""} onClick={() => onChange(tab.key)}>{tab.label}</button>)}</div>;
}
