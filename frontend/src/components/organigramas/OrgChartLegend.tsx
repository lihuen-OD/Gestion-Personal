import type { OrgCategory } from "../../types/organizationChart.types";

export function OrgChartLegend({ categories }: { categories: OrgCategory[] }) {
  const groups = Array.from(new Map(categories.map((category) => [category.group, category])).values());
  return <div className="org-legend">{groups.map((category) => <span key={category.group}><i style={{ background: category.backgroundColor, borderColor: category.nodeColor }} />{category.group.replace("_", " ")}</span>)}</div>;
}
