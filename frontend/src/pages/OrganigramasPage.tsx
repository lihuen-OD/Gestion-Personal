import { useMemo, useState } from "react";
import { FileBarChart } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { organizationChartMockService } from "../services/organizationChartMockService";
import type { Role } from "../types";
import type { OrgChartFilters } from "../types/organizationChart.types";
import { CategoryOrgChart } from "../components/organigramas/CategoryOrgChart";
import { FunctionalOrgChart } from "../components/organigramas/FunctionalOrgChart";
import { OrganigramFilters } from "../components/organigramas/OrganigramFilters";
import { OrgChartTabs, type OrgChartTab } from "../components/organigramas/OrgChartTabs";

const roleLevel = (role: Role) => role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3;

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

export function OrganigramasPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const [tab, setTab] = useState<OrgChartTab>("CATEGORIES");
  const [filters, setFilters] = useState<OrgChartFilters>(() => organizationChartMockService.getEmptyFilters());
  const [toast, setToast] = useState("");
  const options = useMemo(() => organizationChartMockService.getFilterOptions(user!.role, user!.sector), [user]);
  const categories = useMemo(() => organizationChartMockService.getCategories(), []);
  const employees = organizationChartMockService.getEmployees(user!.role, user!.sector, filters);
  const model = organizationChartMockService.buildCategoryModel(employees, categories);
  const exportMock = () => { setToast("Exportación simulada. La exportación real se implementará más adelante."); setTimeout(() => setToast(""), 2500); };
  const filterControls = <OrganigramFilters filters={filters} options={options} onChange={setFilters} onClear={() => setFilters(organizationChartMockService.getEmptyFilters())} />;

  if (level === 3) return <><PageHeader eyebrow="ACCESO RESTRINGIDO" title="Organigramas" description="Tu perfil de carga horaria no tiene acceso al módulo de estructura organizacional." /></>;

  return <><PageHeader eyebrow="ESTRUCTURA ORGANIZACIONAL" title="Organigramas" description="Visualización alimentada siempre desde Legajos: categoría interna, encargado directo, sector, centro de costo y estado se leen desde localStorage." action={<button className="button subtle" onClick={exportMock}><FileBarChart size={16}/> Exportación mock</button>} />
    {toast && <div className="toast">{toast}</div>}
    <OrgChartTabs active={tab} onChange={setTab} />
    {filterControls}
    {tab === "CATEGORIES" ? <CategoryOrgChart model={model} onExport={exportMock} filterControls={filterControls} /> : <FunctionalOrgChart employees={employees} onExport={exportMock} />}
  </>;
}
