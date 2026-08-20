import { Eye, Search, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { EmployeeRemoteSelector } from "../employees/EmployeeRemoteSelector";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";
import { confirmAction } from "../../services/appDialog";
import { getUserErrorMessage } from "../../services/api/apiClient";
import type { AssociatedEmployee, AssociatedEmployeeFilters, AssociatedEmployeesResult } from "../../types/associatedEmployee.types";
import type { Employee } from "../../types";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";
import { Modal } from "../ui/Modal";
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

// Panel reutilizable para "empleados asociados a una entidad" (Régimen
// Laboral -> empleados, Concepto Horario -> empleados habilitados). La
// tabla/filtros/paginación/estados son genéricos; lo que cambia por entidad
// es el fetcher (qué endpoint llamar), extraColumns (ej. vigencia en
// régimen, que no existe en concepto) y, opcionalmente, agregar/quitar
// (Etapa 8N) — canEdit=false (default) mantiene el comportamiento de solo
// lectura original (usado hoy por WorkRegimesPage), sin romper ese caller.
export function AssociatedEmployeesPanel<T extends { employeeId: string; employee: AssociatedEmployee }>({
  title,
  description,
  emptyText,
  fetcher,
  extraColumns = [],
  refreshKey,
  canEdit = false,
  onAddEmployees,
  onRemoveEmployee,
  removeConfirmText,
  variant = "full",
}: {
  title?: string;
  description?: string;
  emptyText: string;
  fetcher: AssociatedEmployeesFetcher<T>;
  extraColumns?: AssociatedEmployeesColumn<T>[];
  refreshKey?: string | number;
  canEdit?: boolean;
  onAddEmployees?: (employeeIds: string[]) => Promise<void>;
  onRemoveEmployee?: (item: T) => Promise<void>;
  removeConfirmText?: (item: T) => string;
  // variant (auditoría UI/UX): "full" (default) es el comportamiento de
  // siempre — sin cambios para WorkRegimesPage (canEdit=false ahí, así que
  // ni siquiera llega a usar el flujo de agregar). "embedded" es para usar
  // DENTRO de otra card (ej. HourConceptsPage): header propio tipo
  // block-card-head, filtros sin card externa, empty state compacto.
  variant?: "full" | "embedded";
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
  const [selected, setSelected] = useState<Employee[]>([]);
  const [notice, setNotice] = useState("");
  // El buscador remoto vive en un modal (auditoría UI/UX) — así nunca se
  // incrusta como un módulo gigante dentro de otra card.
  const [addOpen, setAddOpen] = useState(false);

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
  const reload = () => setRetry((value) => value + 1);

  const { isRunning: isAdding, run: addSelected } = useAsyncAction(async () => {
    if (!onAddEmployees || !selected.length) return;
    try {
      await onAddEmployees(selected.map((employee) => employee.id));
      setSelected([]);
      setAddOpen(false);
      setNotice("Empleados agregados correctamente.");
      reload();
      setTimeout(() => setNotice(""), 2200);
    } catch (error) {
      setNotice(getUserErrorMessage(error, "No pudimos agregar los empleados. Intentá nuevamente."));
      setTimeout(() => setNotice(""), 3000);
    }
  });

  const closeAddModal = () => {
    setAddOpen(false);
    setSelected([]);
  };

  const removeItem = async (item: T) => {
    if (!onRemoveEmployee) return;
    const message = removeConfirmText ? removeConfirmText(item) : `¿Querés quitar a ${item.employee.lastName}, ${item.employee.firstName}?`;
    if (!(await confirmAction(message, { title: "Quitar empleado", confirmLabel: "Quitar", tone: "danger" }))) return;
    try {
      await onRemoveEmployee(item);
      reload();
    } catch (error) {
      setNotice(getUserErrorMessage(error, "No pudimos quitar al empleado. Intentá nuevamente."));
      setTimeout(() => setNotice(""), 3000);
    }
  };

  // Solo excluye del selector a quienes ya están en la página actual — el
  // listado es paginado a propósito (no se trae todo para filtrar en
  // frontend), así que no puede garantizar exclusión perfecta contra páginas
  // no cargadas. El backend ya no falla ni duplica si de todos modos se
  // agrega a alguien ya habilitado (skipDuplicates), así que el peor caso es
  // un no-op silencioso, no un error.
  const alreadyAssociatedIds = new Set(items.map((item) => item.employeeId));

  const canAdd = canEdit && Boolean(onAddEmployees);

  return (
    <div className={`associated-employees-panel${variant === "embedded" ? " embedded" : ""}`}>
      {variant === "embedded" ? (
        title || canAdd ? (
          <div className="block-card-head">
            <div>
              {title ? <h4>{title}</h4> : null}
              {description ? <p>{description}</p> : null}
            </div>
            {canAdd ? (
              <div className="tracked-actions">
                <Button variant="primary" icon={UserPlus} onClick={() => setAddOpen(true)}>Agregar empleados</Button>
              </div>
            ) : null}
          </div>
        ) : null
      ) : (
        <>
          {title ? <h4>{title}</h4> : null}
          {description ? <p className="muted small">{description}</p> : null}
          {canAdd ? (
            <div className="form-actions inline-actions">
              <Button variant="primary" icon={UserPlus} onClick={() => setAddOpen(true)}>Agregar empleados</Button>
            </div>
          ) : null}
        </>
      )}

      {notice ? <div className="toast">{notice}</div> : null}

      <div className={`filters${variant === "embedded" ? " filters-embedded" : ""}`}>
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
      {status === "error" ? (
        <ErrorState message="No pudimos cargar los empleados asociados." onRetry={reload} size={variant === "embedded" ? "compact" : "default"} />
      ) : null}
      {status === "success" && !items.length ? (
        <EmptyState text={emptyText} size={variant === "embedded" ? "compact" : "default"} />
      ) : null}

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
                      <div className="table-actions">
                        <Link className="table-link table-icon-action" title="Ir al legajo" aria-label="Ir al legajo" to={`/legajos/${item.employee.id}`}>
                          <Eye size={14} />
                          <span>Ver legajo</span>
                        </Link>
                        {canEdit && onRemoveEmployee ? (
                          <button type="button" className="table-icon-action danger-link" title="Quitar" aria-label="Quitar" onClick={() => void removeItem(item)}>
                            <X size={14} />
                            <span>Quitar</span>
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="empleados" />
        </>
      ) : null}

      {addOpen && canAdd ? (
        <Modal title="Agregar empleados" close={closeAddModal}>
          <div className="form-stack">
            <EmployeeRemoteSelector selected={selected} multiple showStatusFilter excludeIds={alreadyAssociatedIds} onChange={setSelected} />
            <div className="form-actions">
              <Button variant="subtle" onClick={closeAddModal}>Cancelar</Button>
              <Button variant="primary" disabled={isAdding || !selected.length} onClick={addSelected}>{isAdding ? "Agregando..." : "Agregar seleccionados"}</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
