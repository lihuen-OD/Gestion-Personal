import { Eye, UserPlus, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { SearchInput } from "../ui/SearchInput";
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
  removeConfirmTitle = "Quitar empleado",
  removeActionLabel = "Quitar",
  removeActionTone = "danger",
  removeActionIcon: RemoveActionIcon = X,
  canRemove,
  renderAddExtra,
  renderFilterExtra,
  addMode = "modal",
  onAddModeChange,
  addExtraDisabled = false,
  addExtraDisabledHint,
  showCuilColumn = true,
  showEmployeeStatusColumn = true,
  enableMobileCards = false,
  variant = "full",
}: {
  title?: string;
  description?: string;
  // Etapa 13J.1: además de un string fijo, acepta una función que recibe si
  // hay filtros propios del panel activos (búsqueda/sector/centro de costo/
  // empresa) — para poder distinguir "no hay vigentes" de "no encontramos
  // nada con esos filtros" (antes era siempre el mismo texto para los dos
  // casos).
  emptyText: string | ((hasActiveFilters: boolean) => string);
  fetcher: AssociatedEmployeesFetcher<T>;
  extraColumns?: AssociatedEmployeesColumn<T>[];
  refreshKey?: string | number;
  canEdit?: boolean;
  onAddEmployees?: (employeeIds: string[]) => Promise<void>;
  onRemoveEmployee?: (item: T) => Promise<void>;
  removeConfirmText?: (item: T) => string;
  // Etapa 13J: WorkRegimesPage no borra la asociación, cierra la vigencia
  // (no pierde historial) — el copy no puede decir "Eliminar"/"Quitar
  // empleado" ahí. HourConceptsPage sí borra la fila de habilitación
  // (no tiene vigencia), así que sus defaults ("Quitar"/"Quitar empleado")
  // quedan igual que siempre.
  removeConfirmTitle?: string;
  removeActionLabel?: string;
  // Etapa 13J.1: "danger" (default, rojo) es correcto para HourConcept, que
  // sí borra sin dejar historial. WorkRegimesPage pasa "neutral" — finalizar
  // una vigencia no es destructivo, no debería leerse como "eliminar".
  removeActionTone?: "danger" | "neutral";
  removeActionIcon?: LucideIcon;
  // Etapa 13J: por fila, si además de canEdit/onRemoveEmployee puede
  // quitarse — WorkRegimesPage sólo permite finalizar vigencias vigentes
  // (una histórica ya está cerrada; una futura no debe cerrarse con la
  // fecha de hoy). Sin esta prop, default = siempre permitido (mismo
  // comportamiento que antes para HourConceptsPage).
  canRemove?: (item: T) => boolean;
  // Etapa 13J: slot opcional para un campo extra en el formulario "Agregar
  // empleados" (ej. fecha de vigencia desde, que WorkRegimesPage necesita y
  // HourConceptsPage no).
  renderAddExtra?: () => ReactNode;
  // Etapa 13J: slot opcional para un filtro extra dentro de la misma barra
  // de filtros (ej. Vigentes/Históricos/Todos en WorkRegimesPage) — vive acá
  // en vez de fuera del panel para que quede alineado con
  // search/sector/costCenter/empresa en vez de ser un control suelto.
  renderFilterExtra?: () => ReactNode;
  // Etapa 13J.1: "modal" (default) es el comportamiento de siempre — abre
  // "Agregar empleados" en un <Modal> propio (correcto para HourConceptsPage,
  // que NO está ya dentro de otro modal). "inline" reemplaza el contenido
  // del panel por el formulario de alta en el mismo lugar, sin abrir un
  // segundo <Modal> — WorkRegimesPage lo usa porque su panel ya vive DENTRO
  // del modal "Empleados asociados" (evita modal-sobre-modal).
  addMode?: "modal" | "inline";
  // Etapa 13J.1: notifica al padre cuándo se entra/sale del formulario de
  // alta — sólo relevante con addMode="inline", para que WorkRegimesPage
  // pueda cambiar el título/subtítulo del <Modal> exterior ("Agregar
  // empleados al régimen" en vez de "Empleados con régimen X").
  onAddModeChange?: (active: boolean) => void;
  // Etapa 13J.1: condición extra (además de haber seleccionado empleados)
  // para habilitar "Agregar seleccionados" — WorkRegimesPage la usa para
  // exigir la fecha de vigencia desde.
  addExtraDisabled?: boolean;
  addExtraDisabledHint?: string;
  // Etapa 13J.1: CUIL/Estado ya no son parte de las columnas "sugeridas"
  // para Régimen Laboral (demasiadas columnas angostas cortaban texto tipo
  // "Administracion Central" a la mitad) — default true conserva la tabla
  // de HourConceptsPage exactamente igual.
  showCuilColumn?: boolean;
  showEmployeeStatusColumn?: boolean;
  // Etapa 13J.3: la tabla (7-9 columnas) no entra en un modal de ancho
  // celular sin scroll horizontal ni columnas cortadas — con
  // enableMobileCards=true (opt-in, default false) se agrega una lista de
  // cards que reemplaza a la tabla por debajo de 620px (mismo breakpoint que
  // ya usa el resto del proyecto para "mobile", ver .filters). Default false
  // = cero cambio de comportamiento para HourConceptsPage (no lo pide).
  enableMobileCards?: boolean;
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
  const hadItemsRef = useRef(false);
  // Etapa 13J.3: por employeeId, para deshabilitar SÓLO la fila en curso
  // (no las demás) mientras se confirma/llama la API, y para que un doble
  // click no dispare dos PATCH de cierre de vigencia en simultáneo.
  const [removingId, setRemovingId] = useState<string | null>(null);
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
    if (!items.length) setStatus("loading");
    hadItemsRef.current = items.length > 0;
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
        if (!hadItemsRef.current) {
          setItems([]);
          setStatus("error");
        }
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

  const openAdd = () => {
    setAddOpen(true);
    onAddModeChange?.(true);
  };
  const closeAdd = () => {
    setAddOpen(false);
    setSelected([]);
    onAddModeChange?.(false);
  };

  const { isRunning: isAdding, run: addSelected } = useAsyncAction(async () => {
    if (!onAddEmployees || !selected.length) return;
    try {
      await onAddEmployees(selected.map((employee) => employee.id));
      setNotice("Empleados agregados correctamente.");
      closeAdd();
      reload();
      setTimeout(() => setNotice(""), 2200);
    } catch (error) {
      setNotice(getUserErrorMessage(error, "No pudimos agregar los empleados. Intentá nuevamente."));
      setTimeout(() => setNotice(""), 3000);
    }
  });

  const removeItem = async (item: T) => {
    // Etapa 13J.3: si ya hay una baja en curso (cualquier fila), no
    // dispara otra — evita doble-click y llamadas superpuestas.
    if (!onRemoveEmployee || removingId) return;
    const message = removeConfirmText ? removeConfirmText(item) : `¿Querés quitar a ${item.employee.lastName}, ${item.employee.firstName}?`;
    if (!(await confirmAction(message, { title: removeConfirmTitle, confirmLabel: removeActionLabel, tone: removeActionTone === "danger" ? "danger" : "primary" }))) return;
    setRemovingId(item.employeeId);
    try {
      await onRemoveEmployee(item);
      reload();
    } catch (error) {
      setNotice(getUserErrorMessage(error, "No pudimos quitar al empleado. Intentá nuevamente."));
      setTimeout(() => setNotice(""), 3000);
    } finally {
      setRemovingId(null);
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
  const hasActiveFilters = Boolean(debouncedSearch || selectedSectorId || selectedCostCenterId || selectedCompanyId);
  const resolvedEmptyText = typeof emptyText === "function" ? emptyText(hasActiveFilters) : emptyText;

  const addDisabled = isAdding || !selected.length || addExtraDisabled;
  const addDisabledHint = isAdding
    ? null
    : !selected.length
      ? "Seleccioná al menos un empleado para continuar."
      : addExtraDisabled
        ? addExtraDisabledHint || "Completá los datos requeridos para continuar."
        : null;

  const addFormBody = (
    <div className="form-stack">
      <EmployeeRemoteSelector selected={selected} multiple showStatusFilter showEmployeeDetails excludeIds={alreadyAssociatedIds} onChange={setSelected} />
      {renderAddExtra ? renderAddExtra() : null}
      {addDisabledHint ? <small className="muted small add-employees-hint">{addDisabledHint}</small> : null}
      <div className="form-actions">
        <Button variant="subtle" onClick={closeAdd}>{addMode === "inline" ? "Volver a empleados asociados" : "Cancelar"}</Button>
        <Button variant="primary" disabled={addDisabled} onClick={addSelected}>{isAdding ? "Agregando..." : "Agregar seleccionados"}</Button>
      </div>
    </div>
  );

  if (addMode === "inline" && addOpen) {
    return (
      <div className={`associated-employees-panel${variant === "embedded" ? " embedded" : ""}`}>
        {notice ? <div className="toast">{notice}</div> : null}
        {addFormBody}
      </div>
    );
  }

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
                <Button variant="primary" icon={UserPlus} onClick={openAdd}>Agregar empleados</Button>
              </div>
            ) : null}
          </div>
        ) : null
      ) : (
        <>
          {title ? <h4>{title}</h4> : null}
          {description ? <p className="muted small">{description}</p> : null}
          {canAdd ? (
            // Etapa 13J.2: NO reusar .form-actions acá — esa clase también
            // significa "barra de guardar/cancelar pegada abajo del modal"
            // (.modal-body .form-actions es position:sticky;bottom:-18px),
            // que es exactamente lo que rompía este botón (pensado como
            // toolbar de arriba, no como acción de cierre de formulario).
            <div className="associated-employees-toolbar">
              <Button variant="primary" icon={UserPlus} onClick={openAdd}>Agregar empleados</Button>
            </div>
          ) : null}
        </>
      )}

      {notice ? <div className="toast">{notice}</div> : null}

      <div className={`filters${variant === "embedded" ? " filters-embedded" : ""}`}>
        <SearchInput
          placeholder="Buscar por legajo, CUIL, apellido o nombre"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            resetPage();
          }}
        />
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
        {renderFilterExtra ? renderFilterExtra() : null}
      </div>

      {status === "loading" ? <LoadingState variant="table" /> : null}
      {status === "error" ? (
        <ErrorState message="No pudimos cargar los empleados asociados." onRetry={reload} size={variant === "embedded" ? "compact" : "default"} />
      ) : null}
      {status === "success" && !items.length ? (
        <EmptyState text={resolvedEmptyText} size={variant === "embedded" ? "compact" : "default"} />
      ) : null}

      {status === "success" && items.length ? (
        <>
          <div className={`associated-employees-table-wrap${enableMobileCards ? " has-mobile-cards" : ""}`}>
            <TableShell minWidth={showCuilColumn || showEmployeeStatusColumn ? 880 : 720}>
              <table>
                <thead>
                  <tr>
                    <th>Legajo</th>
                    <th>Empleado</th>
                    {showCuilColumn ? <th>CUIL</th> : null}
                    <th>Sector</th>
                    <th>Centro de costo</th>
                    <th>Empresa</th>
                    {showEmployeeStatusColumn ? <th>Estado</th> : null}
                    {extraColumns.map((column) => (
                      <th key={column.header}>{column.header}</th>
                    ))}
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const canRemoveRow = canEdit && onRemoveEmployee && (!canRemove || canRemove(item));
                    const isRemovingRow = removingId === item.employeeId;
                    return (
                      <tr key={item.employeeId}>
                        <td>{item.employee.legajo}</td>
                        <td>{item.employee.lastName}, {item.employee.firstName}</td>
                        {showCuilColumn ? <td>{item.employee.cuil}</td> : null}
                        <td>{item.employee.sector?.name || "-"}</td>
                        <td>{item.employee.costCenter?.name || "-"}</td>
                        <td>{employeeCompanyNames(item.employee)}</td>
                        {showEmployeeStatusColumn ? (
                          <td><Badge tone={statusTone(employeeStatusLabel(item.employee.status))}>{employeeStatusLabel(item.employee.status)}</Badge></td>
                        ) : null}
                        {extraColumns.map((column) => (
                          <td key={column.header}>{column.render(item)}</td>
                        ))}
                        <td>
                          <div className="table-actions">
                            <Link className="table-icon-action" title="Ir al legajo" aria-label="Ir al legajo" to={`/legajos/${item.employee.id}`}>
                              <Eye size={14} />
                              <span>Ver legajo</span>
                            </Link>
                            {canRemoveRow ? (
                              <button
                                type="button"
                                className={`table-icon-action${removeActionTone === "danger" ? " danger-link" : ""}`}
                                title={isRemovingRow ? "Finalizando..." : removeActionLabel}
                                aria-label={isRemovingRow ? "Finalizando..." : removeActionLabel}
                                disabled={isRemovingRow}
                                onClick={() => void removeItem(item)}
                              >
                                <RemoveActionIcon size={14} />
                                <span>{isRemovingRow ? "Finalizando..." : removeActionLabel}</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          </div>

          {enableMobileCards ? (
            <div className="associated-employees-cards">
              {items.map((item) => {
                const canRemoveRow = canEdit && onRemoveEmployee && (!canRemove || canRemove(item));
                const isRemovingRow = removingId === item.employeeId;
                return (
                  <div className="associated-employees-card" key={item.employeeId}>
                    <div className="aec-card-head">
                      <b>{item.employee.lastName}, {item.employee.firstName}</b>
                      <span className="table-sub">Legajo {item.employee.legajo}</span>
                    </div>
                    <dl className="aec-card-fields">
                      <div><dt>Sector</dt><dd>{item.employee.sector?.name || "-"}</dd></div>
                      <div><dt>Centro de costo</dt><dd>{item.employee.costCenter?.name || "-"}</dd></div>
                      <div><dt>Empresa</dt><dd>{employeeCompanyNames(item.employee)}</dd></div>
                      {showCuilColumn ? <div><dt>CUIL</dt><dd>{item.employee.cuil}</dd></div> : null}
                      {showEmployeeStatusColumn ? (
                        <div><dt>Estado</dt><dd><Badge tone={statusTone(employeeStatusLabel(item.employee.status))}>{employeeStatusLabel(item.employee.status)}</Badge></dd></div>
                      ) : null}
                    </dl>
                    {extraColumns.map((column) => (
                      <div className="aec-card-vigency" key={column.header}>{column.render(item)}</div>
                    ))}
                    <div className="aec-card-actions">
                      <Button variant="subtle" icon={Eye} to={`/legajos/${item.employee.id}`}>Ver legajo</Button>
                      {canRemoveRow ? (
                        <Button
                          variant={removeActionTone === "danger" ? "danger" : "subtle"}
                          icon={RemoveActionIcon}
                          disabled={isRemovingRow}
                          onClick={() => void removeItem(item)}
                        >
                          {isRemovingRow ? "Finalizando..." : removeActionLabel}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="empleados" />
        </>
      ) : null}

      {addOpen && canAdd && addMode === "modal" ? (
        <Modal title="Agregar empleados" close={closeAdd}>
          {addFormBody}
        </Modal>
      ) : null}
    </div>
  );
}
