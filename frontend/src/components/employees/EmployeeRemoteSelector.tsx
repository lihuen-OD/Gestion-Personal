import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { employeeApiService } from "../../services/api/employeeApiService";
import type { Employee } from "../../types";
import { displayLegajo, fullName } from "../../utils/employee";
import { statusTone } from "../../utils/status";
import { useDebouncedValue } from "../../utils/useDebouncedValue";
import { Badge } from "../ui/Badge";
import { SearchInput } from "../ui/SearchInput";

// Tamaño de página inicial y de cada "Cargar más" — nunca se trae todo de
// una sola vez (antes: `take: 20` fijo, sin forma de ver más resultados).
const PAGE_SIZE = 20;

export function visibleEmployeeResults(results: Employee[], excludeIds?: Set<string>): Employee[] {
  return excludeIds ? results.filter((employee) => !excludeIds.has(employee.id)) : results;
}

function mergeEmployeesById(current: Employee[], incoming: Employee[]): Employee[] {
  const seen = new Set(current.map((employee) => employee.id));
  const appended = incoming.filter((employee) => {
    if (seen.has(employee.id)) return false;
    seen.add(employee.id);
    return true;
  });
  return [...current, ...appended];
}

export function EmployeeRemoteSelector({
  selected,
  multiple = false,
  showStatusFilter = false,
  wide = true,
  excludeIds,
  // Etapa 13J.1: muestra sector/empresa/estado como una tercera línea por
  // fila — sólo lo pide el flujo "Agregar empleados" de
  // AssociatedEmployeesPanel (RRHH eligiendo a quién asignar un régimen/
  // concepto), no los demás 4 usos (Novedades, Documentos, Turnos, Reglas de
  // carga horaria), que no lo pidieron y quedan sin cambios visuales.
  showEmployeeDetails = false,
  onChange,
}: {
  selected: Employee[];
  multiple?: boolean;
  showStatusFilter?: boolean;
  wide?: boolean;
  excludeIds?: Set<string>;
  showEmployeeDetails?: boolean;
  onChange: (employees: Employee[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "ACTIVO" | "INACTIVO">("ACTIVO");
  const [results, setResults] = useState<Employee[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);
  // Contador de "request vigente": cada reset (búsqueda/filtro) y cada
  // "Cargar más" lo incrementa y captura su propio valor. Una respuesta que
  // llega cuando el contador ya avanzó (por un reset posterior, un nuevo
  // "Cargar más", o el desmontaje del componente) se descarta — evita que
  // una búsqueda vieja pise una más nueva (ver ejemplo "Oficina"/"Granja").
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const query = debouncedSearch.trim();
    if (!showStatusFilter && query.length < 2) {
      requestSeqRef.current += 1;
      setResults([]);
      setStatus("idle");
      setPage(1);
      setHasMore(false);
      setTotal(null);
      setLoadMoreError(false);
      return;
    }

    const seq = ++requestSeqRef.current;
    setStatus("loading");
    setLoadMoreError(false);
    employeeApiService
      .getOptions({ search: query || undefined, status: showStatusFilter ? statusFilter || undefined : undefined, page: 1, take: PAGE_SIZE })
      .then((response) => {
        if (requestSeqRef.current !== seq) return;
        setResults(response.items);
        setPage(1);
        setHasMore(response.meta.hasMore);
        setTotal(response.meta.total);
        setStatus("success");
      })
      .catch(() => {
        if (requestSeqRef.current !== seq) return;
        setResults([]);
        setStatus("error");
        setHasMore(false);
        setTotal(null);
      });

    return () => {
      requestSeqRef.current += 1;
    };
  }, [debouncedSearch, showStatusFilter, statusFilter]);

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    const seq = ++requestSeqRef.current;
    setLoadingMore(true);
    setLoadMoreError(false);
    employeeApiService
      .getOptions({ search: debouncedSearch.trim() || undefined, status: showStatusFilter ? statusFilter || undefined : undefined, page: nextPage, take: PAGE_SIZE })
      .then((response) => {
        if (requestSeqRef.current !== seq) return;
        setResults((current) => mergeEmployeesById(current, response.items));
        setPage(nextPage);
        setHasMore(response.meta.hasMore);
        setTotal(response.meta.total);
        setLoadingMore(false);
      })
      .catch(() => {
        if (requestSeqRef.current !== seq) return;
        setLoadingMore(false);
        setLoadMoreError(true);
      });
  };

  const selectedIds = new Set(selected.map((employee) => employee.id));
  const choose = (employee: Employee) => {
    if (multiple) {
      onChange(selectedIds.has(employee.id) ? selected.filter((item) => item.id !== employee.id) : [...selected, employee]);
      return;
    }
    onChange([employee]);
    requestSeqRef.current += 1;
    setSearch(""); setResults([]); setStatus("idle"); setPage(1); setHasMore(false); setTotal(null); setLoadMoreError(false);
  };
  const visibleResults = visibleEmployeeResults(results, excludeIds);
  const selectableResults = visibleResults.filter((employee) => !selectedIds.has(employee.id));
  const selectVisible = () => onChange([...selected, ...selectableResults]);

  return (
    <div className={`people-search${wide ? " form-wide" : ""}`}>
      <div className="people-search-toolbar">
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre, apellido, DNI, CUIL o legajo"
        />
        {showStatusFilter ? <label className="people-status-filter"><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="ACTIVO">Activos</option><option value="INACTIVO">Inactivos</option><option value="">Todos</option></select></label> : null}
      </div>
      {!showStatusFilter && search.trim().length < 2 ? <small>Ingresá al menos 2 caracteres para buscar.</small> : null}
      {status === "loading" ? <small>Buscando empleados...</small> : null}
      {status === "error" ? <small className="error">No se pudo completar la búsqueda.</small> : null}
      {status === "success" ? (
        <div className="people-search-results">
          {multiple && results.length ? (
            <div className="people-results-actions">
              <span>{total !== null ? `${results.length} de ${total} empleado${total === 1 ? "" : "s"}` : `${results.length} empleado${results.length === 1 ? "" : "s"} cargado${results.length === 1 ? "" : "s"}`}</span>
              {selectableResults.length ? <button type="button" onClick={selectVisible}>Seleccionar resultados visibles</button> : <span>Todos seleccionados</span>}
            </div>
          ) : null}
          {visibleResults.length ? visibleResults.map((employee) => {
            const detail = [employee.sector, employee.company].filter(Boolean).join(" · ");
            return (
              <button key={employee.id} type="button" className={selectedIds.has(employee.id) ? "is-selected" : ""} aria-pressed={selectedIds.has(employee.id)} onClick={() => choose(employee)}>
                <span className="people-result-check">{selectedIds.has(employee.id) ? <Check size={14}/> : null}</span>
                <span>
                  <b>{fullName(employee)}</b>
                  <small>{displayLegajo(employee)} · DNI {employee.dni} · CUIL {employee.cuil}</small>
                  {showEmployeeDetails ? (
                    <small className="people-search-row-detail">
                      {detail}
                      <Badge tone={statusTone(employee.status)}>{employee.status}</Badge>
                    </small>
                  ) : null}
                </span>
              </button>
            );
          }) : <span>{hasMore ? "Ningún resultado de esta página coincide con los filtros — cargá más para ver otros." : "No encontramos legajos con esa búsqueda."}</span>}
          {hasMore || loadingMore || loadMoreError ? (
            <div className="people-results-load-more">
              {loadingMore ? (
                <small>Cargando más empleados...</small>
              ) : loadMoreError ? (
                <>
                  <span className="error">No pudimos cargar más empleados.</span>
                  <button type="button" onClick={loadMore}>Reintentar</button>
                </>
              ) : (
                <button type="button" onClick={loadMore}>Cargar más empleados</button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="selected-people">
        {selected.length ? selected.map((employee) => (
          <span key={employee.id}>
            {displayLegajo(employee)} · {fullName(employee)}
            <button type="button" aria-label={`Quitar ${fullName(employee)}`} onClick={() => onChange(selected.filter((item) => item.id !== employee.id))}>×</button>
          </span>
        )) : <em>No hay empleados seleccionados.</em>}
      </div>
      {multiple && selected.length ? <div className="people-selection-summary"><span>{selected.length} empleado{selected.length === 1 ? "" : "s"} seleccionado{selected.length === 1 ? "" : "s"}</span><button type="button" onClick={() => onChange([])}>Limpiar selección</button></div> : null}
    </div>
  );
}
