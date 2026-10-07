import { Link } from "react-router-dom";
import { AlertTriangle, Archive, CheckCircle2, Clock3, Eye, Plus, RefreshCcw, SlidersHorizontal, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { employeeApiService, type EmployeeListSortKey, type EmployeeSummary } from "../services/api/employeeApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import type { Employee } from "../types";
import { displayLegajo, employeeCompanies } from "../utils/employee";
import { roleLevel } from "../utils/roles";
import { statusTone } from "../utils/status";
import { useDebouncedValue } from "../utils/useDebouncedValue";
import { useSortState } from "../utils/sort";
import { OverflowCell } from "../components/ui/OverflowCell";
import { FilterPanel } from "../components/ui/FilterPanel";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/DataTable";
import { Pagination } from "../components/ui/Pagination";
import { SortableHeader } from "../components/ui/SortableHeader";
import { EmployeeStructureFilterControls } from "../components/employees/structureFilters/EmployeeStructureFilterControls";
import { EmployeeStructureCells } from "../components/employees/structureFilters/EmployeeStructureCells";
import { emptyStructureFilters, hasStructureFilters, structureFilterParams, type EmployeeStructureFilterValue } from "../components/employees/structureFilters/employeeStructureFilters";
import { useOrgStructureCatalog } from "../components/employees/structureFilters/useOrgStructureCatalog";

const pageSize = 25;
const emptySummary: EmployeeSummary = {
  total: 0,
  active: 0,
  inactive: 0,
  missingTimeResponsible: 0,
  pendingTimeLoads: 0,
};

export function EmployeesPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [company, setCompany] = useState("");
  const [structure, setStructure] = useState<EmployeeStructureFilterValue>(emptyStructureFilters);
  const [showStructureFilters, setShowStructureFilters] = useState(false);
  const catalog = useOrgStructureCatalog();
  const [costCenter, setCostCenter] = useState("");
  const [page, setPage] = useState(1);
  // Orden server-side: cambiarlo vuelve a la página 1 (el backend ordena el
  // dataset filtrado completo antes de paginar).
  const resetPage = useCallback(() => setPage(1), []);
  const { sort, toggleSort } = useSortState<EmployeeListSortKey>(resetPage);
  const [refresh, setRefresh] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const initialList = employeeApiService.peekList({ page: 1, take: pageSize });
  const [all, setAll] = useState<Employee[]>(initialList?.items || []);
  const [listStatus, setListStatus] = useState<"loading" | "success" | "error">(initialList ? "success" : "loading");
  const [structureCompanies, setStructureCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [structureCostCenters, setStructureCostCenters] = useState<Array<{ id: string; name: string }>>([]);
  const [summary, setSummary] = useState<EmployeeSummary>(emptySummary);
  const [meta, setMeta] = useState(initialList?.meta || { total: 0, page: 1, pageSize, hasMore: false });
  const selectedCompanyId = structureCompanies.find((item) => item.name === company)?.id;
  const structureParams = useMemo(() => structureFilterParams(structure), [structure]);
  const selectedCostCenterId = structureCostCenters.find((item) => item.name === costCenter)?.id;

  useEffect(() => {
    let mounted = true;
    if (!all.length) setListStatus("loading");
    employeeApiService
      .list({ search: debouncedSearch, companyId: selectedCompanyId, costCenterId: selectedCostCenterId, structure: structureParams, page, take: pageSize, sort })
      .then((result) => {
        if (!mounted) return;
        setAll(result.items);
        setMeta(result.meta);
        setListStatus("success");
        // Etapa 14C.3: precarga silenciosa de la página siguiente en la caché
        // ya existente (`employeeApiService.list`, `services/cache`) — no
        // agrega ningún mecanismo nuevo, sólo dispara el mismo fetch que
        // "Siguiente" haría, antes de que el usuario lo pida. Si el usuario
        // efectivamente pasa de página, ese fetch encuentra la respuesta ya
        // en caché (o el pedido en curso, deduplicado por `cachedData`); si
        // no la pasa, la entrada expira sola con el TTL normal (30s).
        if (result.meta.hasMore) {
          employeeApiService
            .list({ search: debouncedSearch, companyId: selectedCompanyId, costCenterId: selectedCostCenterId, structure: structureParams, page: page + 1, take: pageSize, sort })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (!mounted) return;
        setAll([]);
        setMeta({ total: 0, page, pageSize, hasMore: false });
        setListStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [debouncedSearch, page, refresh, selectedCompanyId, structureParams, selectedCostCenterId, sort]);

  useEffect(() => {
    let mounted = true;
    employeeApiService
      .getSummary()
      .then((result) => {
        if (mounted) setSummary(result);
      })
      .catch(() => {
        if (!mounted) return;
        setSummary(emptySummary);
      });
    return () => {
      mounted = false;
    };
  }, [refresh]);

  useEffect(() => {
    let mounted = true;
    orgStructureApiService
      .getCatalog()
      .then((catalog) => {
        if (!mounted) return;
        setStructureCompanies(catalog.companies.filter((item) => item.status === "ACTIVO").map((item) => ({ id: item.id, name: item.name })));
        setStructureCostCenters(catalog.costCenters.filter((item) => item.status === "ACTIVO").map((item) => ({ id: item.id, name: item.name })));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const companyOptions = Array.from(new Set([...structureCompanies.map((item) => item.name), ...all.flatMap((employee) => employeeCompanies(employee))])).filter(Boolean);
  const employees = all;

  const syncLaborStatuses = async () => {
    setSyncing(true);
    setSyncMessage("");
    try {
      const result = await employeeApiService.syncLaborStatuses();
      setSyncMessage(`Estados sincronizados: ${result.updated} actualizados sobre ${result.scanned} revisados.`);
      setRefresh((value) => value + 1);
    } catch (error) {
      setSyncMessage("No pudimos sincronizar los estados. Intentá nuevamente en unos minutos.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="BASE MAESTRA DE PERSONAS"
        title={level === 2 ? "Legajos de mi area" : "Legajos"}
        description="Busca, consulta y gestiona la informacion integral de cada colaborador."
        action={
          level === 1 ? (
            <>
              <Button variant="subtle" icon={RefreshCcw} onClick={syncLaborStatuses} disabled={syncing}>
                {syncing ? "Sincronizando..." : "Sincronizar estados"}
              </Button>
              <Button to="/legajos/nuevo" variant="primary">
                <Plus size={17} /> Nuevo legajo
              </Button>
            </>
          ) : undefined
        }
      />
      {syncMessage ? <div className="info-note compact">{syncMessage}</div> : null}

      <div className="stat-grid five">
        <StatCard label="Total legajos" value={summary.total} icon={Users} />
        <StatCard label="Activos" value={summary.active} icon={CheckCircle2} tone="green" />
        <StatCard label="Inactivos" value={summary.inactive} icon={Archive} tone="red" />
        <StatCard label="Sin responsable" value={summary.missingTimeResponsible} icon={AlertTriangle} tone="orange" />
        <StatCard label="Carga pendiente" value={summary.pendingTimeLoads} icon={Clock3} tone="purple" />
      </div>

      <Section
        title="Listado de legajos"
        subtitle={`${meta.total} resultados`}
        action={
          <Button variant="subtle" icon={SlidersHorizontal} onClick={() => setShowStructureFilters((value) => !value)} aria-expanded={showStructureFilters || hasStructureFilters(structure)}>
            {showStructureFilters || hasStructureFilters(structure) ? "Ocultar estructura" : "Alcance y ubicación"}
          </Button>
        }
      >
        <FilterPanel
          search={{
            placeholder: "Buscar por legajo, DNI, CUIL, apellido o nombre",
            value: search,
            onChange: (value) => {
              setSearch(value);
              setPage(1);
            },
          }}
        >
          <label>
            Empresa empleadora
            <select
              value={company}
              onChange={(event) => {
                setCompany(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              {companyOptions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Centro de costo
            <select
              value={costCenter}
              onChange={(event) => {
                setCostCenter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {structureCostCenters.map((item) => (
                <option key={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          {showStructureFilters || hasStructureFilters(structure) ? (
            <EmployeeStructureFilterControls value={structure} catalog={catalog} onChange={(next) => { setStructure(next); setPage(1); }} />
          ) : null}
        </FilterPanel>

        <DataTable
          status={listStatus === "loading" ? "loading" : listStatus === "error" ? "error" : employees.length === 0 ? "empty" : "ready"}
          minWidth={1240}
          emptyText="No se encontraron legajos con los filtros aplicados."
          errorMessage="No se pudieron cargar los legajos. Intentá nuevamente."
          onRetry={() => setRefresh((value) => value + 1)}
        >
          <table>
            <thead>
              <tr>
                <SortableHeader label="Legajo" sortKey="legajo" sort={sort} onSort={toggleSort} />
                <SortableHeader label="CUIL" sortKey="cuil" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Apellido" sortKey="lastName" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Nombre" sortKey="firstName" sort={sort} onSort={toggleSort} />
                <th>Centro de costo</th>
                <th>Puesto y alcance</th>
                <th>Ubicaciones vigentes</th>
                <SortableHeader label="Estado" sortKey="status" sort={sort} onSort={toggleSort} />
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td className="cell-nowrap">
                    <b>{displayLegajo(employee)}</b>
                  </td>
                  <td className="cell-nowrap">{employee.cuil}</td>
                  <td>{employee.lastName}</td>
                  <td>{employee.firstName}</td>
                  <td>
                    <OverflowCell value={employee.costCenter} />
                  </td>
                  <EmployeeStructureCells employee={employee} />
                  <td>
                    <Badge tone={statusTone(employee.status)}>{employee.status}</Badge>
                  </td>
                  <td>
                    <Link
                      className="table-icon-action"
                      title="Ver detalle"
                      aria-label="Ver detalle"
                      to={`/legajos/${employee.id}`}
                    >
                      <Eye size={14} />
                      <span>Ver detalle</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>

        {listStatus === "success" && employees.length > 0 && (
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="legajos" />
        )}
      </Section>
    </>
  );
}
