import { useEffect, useMemo, useState } from "react";
import { FileBarChart } from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "../context/AuthContext";
import { employeeApiService } from "../services/api/employeeApiService";
import { organizationChartMockService } from "../services/organizationChartMockService";
import type { Employee, Role } from "../types";
import type { OrgChartFilters } from "../types/organizationChart.types";
import { CategoryOrgChart } from "../components/organigramas/CategoryOrgChart";
import { FunctionalOrgChart } from "../components/organigramas/FunctionalOrgChart";
import { OrganigramFilters } from "../components/organigramas/OrganigramFilters";
import { OrgChartTabs, type OrgChartTab } from "../components/organigramas/OrgChartTabs";

const roleLevel = (role: Role) => role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3;

function exportOrganigramWorkbook(employees: Employee[], tab: OrgChartTab) {
  const headers = ["Legajo", "CUIL", "Apellido", "Nombre", "Empresa", "Puesto", "Categoria", "Encargado directo", "Responsable carga", "Sector", "Centro de costo", "Estado"];
  const rows = employees.map((employee) => [
    employee.legajoInterno || employee.legajo,
    employee.cuil,
    employee.lastName,
    employee.firstName,
    employee.companies?.length ? employee.companies.join(", ") : employee.company,
    employee.puestoNombre || employee.position,
    employee.internalCategory || employee.receiptCategory,
    employee.directManagers?.length ? employee.directManagers.join(", ") : employee.directManager,
    employee.timeResponsibles?.length ? employee.timeResponsibles.join(", ") : employee.timeResponsible,
    employee.sector,
    employee.costCenter,
    employee.status,
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = [
    { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 28 }, { wch: 28 },
    { wch: 18 }, { wch: 26 }, { wch: 26 }, { wch: 22 }, { wch: 18 }, { wch: 12 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Organigrama");
  XLSX.writeFile(workbook, `organigrama_${tab.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-header"><div className="page-title-block"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-actions">{action}</div>}</div>;
}

export function OrganigramasPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const [tab, setTab] = useState<OrgChartTab>("CATEGORIES");
  const [filters, setFilters] = useState<OrgChartFilters>(() => organizationChartMockService.getEmptyFilters());
  const [toast, setToast] = useState("");
  const [sourceEmployees, setSourceEmployees] = useState<Employee[]>([]);
  const [usesBackend, setUsesBackend] = useState(false);

  useEffect(() => {
    let mounted = true;
    employeeApiService
      .getOrgChart()
      .then((employees) => {
        if (!mounted) return;
        setSourceEmployees(employees);
        setUsesBackend(true);
      })
      .catch(() => {
        employeeApiService
          .getAll()
          .then((employees) => {
            if (!mounted) return;
            setSourceEmployees(employees);
            setUsesBackend(true);
          })
          .catch(() => {
            if (!mounted) return;
            setSourceEmployees([]);
            setUsesBackend(false);
          });
      });
    return () => {
      mounted = false;
    };
  }, []);

  const options = useMemo(
    () => usesBackend ? organizationChartMockService.getFilterOptionsFrom(sourceEmployees, user!.role, user!.sector) : organizationChartMockService.getFilterOptions(user!.role, user!.sector),
    [sourceEmployees, user, usesBackend],
  );
  const categories = useMemo(() => organizationChartMockService.getCategories(), []);
  const employees = usesBackend
    ? organizationChartMockService.getEmployeesFrom(sourceEmployees, user!.role, user!.sector, filters)
    : organizationChartMockService.getEmployees(user!.role, user!.sector, filters);
  const model = organizationChartMockService.buildCategoryModel(employees, categories);
  const exportView = () => {
    exportOrganigramWorkbook(employees, tab);
    setToast(`Se exportaron ${employees.length} personas visibles del organigrama.`);
    setTimeout(() => setToast(""), 2500);
  };
  const filterControls = <OrganigramFilters filters={filters} options={options} onChange={setFilters} onClear={() => setFilters(organizationChartMockService.getEmptyFilters())} />;

  if (level === 3) return <><PageHeader eyebrow="ACCESO RESTRINGIDO" title="Organigramas" description="Tu perfil de carga horaria no tiene acceso al módulo de estructura organizacional." /></>;

  return <><PageHeader eyebrow="ESTRUCTURA ORGANIZACIONAL" title="Organigramas" description={usesBackend ? "Visualización alimentada desde legajos reales: categoría interna, encargado directo, sector, centro de costo y estado." : "Visualización alimentada desde Legajos en modo demo local."} action={<button className="button subtle" onClick={exportView}><FileBarChart size={16}/> Exportar vista</button>} />
    {toast && <div className="toast">{toast}</div>}
    <OrgChartTabs active={tab} onChange={setTab} />
    {filterControls}
    {tab === "CATEGORIES" ? <CategoryOrgChart model={model} onExport={exportView} filterControls={filterControls} /> : <FunctionalOrgChart employees={employees} onExport={exportView} />}
  </>;
}
