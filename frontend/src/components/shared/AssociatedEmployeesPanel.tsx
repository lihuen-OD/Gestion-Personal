import { Eye, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";
import type { AssociatedEmployee, AssociatedEmployeeFilters, AssociatedEmployeesResult } from "../../types/associatedEmployee.types";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";
import { Pagination } from "../ui/Pagination";
import { TableShell } from "../ui/TableShell";
import { useDebouncedValue } from "../../utils/useDebouncedValue";
import { statusTone } from "../../utils/status";
import { buildAssociatedEmployeesRequest, employeeCompanyNames, employeeStatusLabel } from "./AssociatedEmployeesPanel.helpers";

export type AssociatedEmployeesColumn<T> = {
  header: string;
  render: (item: T) => ReactNode;
};

export type AssociatedEmployeesFetcher<T> = (filters: AssociatedEmployeeFilters) => Promise<AssociatedEmployeesResult<T>>;

const PAGE_SIZE = 20;

// Panel de lectura reutilizable para "empleados asociados a una entidad"
// (Régimen Laboral -> empleados, Concepto Horario -> empleados habilitados,
// Etapa 8G): la tabla/filtros/paginación/estados son genéricos; lo que
// cambia por entidad es el fetcher (qué endpoint llamar) y extraColumns (ej.
// vigencia en régimen, que no existe en concepto).
export function AssociatedEmployeesPanel<T extends { employeeId: string; employee: AssociatedEmployee }>({
  title,
  description,
  emptyText,
  fetcher,
  extraColumns = [],
  refreshKey,
}: {
  title?: string;
  description?: string;
  emptyText: string;
  fetcher: AssociatedEmployeesFetcher<T>;
  extraColumns?: AssociatedEmployeesColumn<T>[];
  refreshKey?: string | number;
}) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [sector, setSector] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [company, setCompany] = useState("");
  const [structureSectors, setStructureSectors] = useState<Array<{ id: string; name: string }>>([]);
  const [structureCostCenters, setStructureCostCenters] = useState<Array<{ id: string; name: string }>>([]);
  const [structureCompanies, setStructureCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<T[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize: PAGE_SIZE, hasMore: false });
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);

  const selectedSectorId = structureSectors.find((item) => item.name === sector)?.id;
  const selectedCostCenterId = structureCostCenters.find((item) => item.name === costCenter)?.id;
  const selectedCompanyId = structureCompanies.find((item) => item.name === company)?.id;

  useEffect(() => {
    let mounted = true;
    orgStructureApiService
      .getCatalog()
      .then((catalog) => {
        if (!mounted) return;
        setStructureSectors(catalog.sectors.filter((item) => item.status === "ACTIVO").map((item) => ({ id: item.id, name: item.name })));
        setStructureCostCenters(catalog.costCenters.filter((item) => item.status === "ACTIVO").map((item) => ({ id: item.id, name: item.name })));
        setStructureCompanies(catalog.companies.filter((item) => item.status === "ACTIVO").map((item) => ({ id: item.id, name: item.name })));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    setStatus("loading");
    const request = buildAssociatedEmployeesRequest({
      search: debouncedSearch,
      sectorId: selectedSectorId,
      costCenterId: selectedCostCenterId,
      companyId: selectedCompanyId,
      page,
      take: PAGE_SIZE,
    });
    fetcher(request)
      .then((result) => {
        if (!mounted) return;
        setItems(result.items);
        setMeta(result.meta);
        setStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setItems([]);
        setStatus("error");
      });
    return () => {
      mounted = false;
    };
    // fetcher deliberadamente fuera de las deps: es una función nueva en cada
    // render del padre y no identifica de por sí un cambio de entidad. Si el
    // padre cambia de régimen/concepto, debe pasar key={entityId} en
    // <AssociatedEmployeesPanel> para forzar un remount limpio en vez de
    // depender de la identidad de fetcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, selectedSectorId, selectedCostCenterId, selectedCompanyId, page, retry, refreshKey]);

  const resetPage = () => setPage(1);

  return (
    <div className="associated-employees-panel">
      {title ? <h4>{title}</h4> : null}
      {description ? <p className="muted small">{description}</p> : null}

      <div className="filters">
        <label className="search-field">
          <Search size={17} />
          <input
            placeholder="Buscar por legajo, CUIL, apellido o nombre"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPage();
            }}
          />
        </label>
        <select value={sector} onChange={(event) => { setSector(event.target.value); resetPage(); }}>
          <option value="">Todos los sectores</option>
          {structureSectors.map((item) => (
            <option key={item.id}>{item.name}</option>
          ))}
        </select>
        <select value={costCenter} onChange={(event) => { setCostCenter(event.target.value); resetPage(); }}>
          <option value="">Todos los centros de costo</option>
          {structureCostCenters.map((item) => (
            <option key={item.id}>{item.name}</option>
          ))}
        </select>
        <select value={company} onChange={(event) => { setCompany(event.target.value); resetPage(); }}>
          <option value="">Todas las empresas</option>
          {structureCompanies.map((item) => (
            <option key={item.id}>{item.name}</option>
          ))}
        </select>
      </div>

      {status === "loading" ? <LoadingState variant="table" /> : null}
      {status === "error" ? <ErrorState message="No pudimos cargar los empleados asociados." onRetry={() => setRetry((value) => value + 1)} /> : null}
      {status === "success" && !items.length ? <EmptyState text={emptyText} /> : null}

      {status === "success" && items.length ? (
        <>
          <TableShell minWidth={880}>
            <table>
              <thead>
                <tr>
                  <th>Legajo</th>
                  <th>Empleado</th>
                  <th>CUIL</th>
                  <th>Sector</th>
                  <th>Centro de costo</th>
                  <th>Empresa</th>
                  <th>Estado</th>
                  {extraColumns.map((column) => (
                    <th key={column.header}>{column.header}</th>
                  ))}
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.employeeId}>
                    <td>{item.employee.legajo}</td>
                    <td>{item.employee.lastName}, {item.employee.firstName}</td>
                    <td>{item.employee.cuil}</td>
                    <td>{item.employee.sector?.name || "-"}</td>
                    <td>{item.employee.costCenter?.name || "-"}</td>
                    <td>{employeeCompanyNames(item.employee)}</td>
                    <td><Badge tone={statusTone(employeeStatusLabel(item.employee.status))}>{employeeStatusLabel(item.employee.status)}</Badge></td>
                    {extraColumns.map((column) => (
                      <td key={column.header}>{column.render(item)}</td>
                    ))}
                    <td>
                      <Link className="table-link table-icon-action" title="Ir al legajo" aria-label="Ir al legajo" to={`/legajos/${item.employee.id}`}>
                        <Eye size={14} />
                        <span>Ver legajo</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="empleados" />
        </>
      ) : null}
    </div>
  );
}
