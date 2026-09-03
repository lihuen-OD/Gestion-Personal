import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { employeeApiService } from "../../services/api/employeeApiService";
import type { Employee } from "../../types";
import { displayLegajo, fullName } from "../../utils/employee";
import { statusTone } from "../../utils/status";
import { useDebouncedValue } from "../../utils/useDebouncedValue";
import { Badge } from "../ui/Badge";
import { SearchInput } from "../ui/SearchInput";

export function visibleEmployeeResults(results: Employee[], excludeIds?: Set<string>): Employee[] {
  return excludeIds ? results.filter((employee) => !excludeIds.has(employee.id)) : results;
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
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    const query = debouncedSearch.trim();
    if (!showStatusFilter && query.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }

    let mounted = true;
    setStatus("loading");
    employeeApiService
      .getOptions({ search: query || undefined, status: showStatusFilter ? statusFilter || undefined : undefined, take: 20 })
      .then((response) => {
        if (!mounted) return;
        setResults(response.items);
        setStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setResults([]);
        setStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [debouncedSearch, showStatusFilter, statusFilter]);

  const selectedIds = new Set(selected.map((employee) => employee.id));
  const choose = (employee: Employee) => {
    if (multiple) {
      onChange(selectedIds.has(employee.id) ? selected.filter((item) => item.id !== employee.id) : [...selected, employee]);
      return;
    }
    onChange([employee]);
    setSearch(""); setResults([]); setStatus("idle");
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
      {showStatusFilter && !search.trim() && status === "success" ? <small>Mostramos hasta 20 resultados. Usá el buscador para encontrar más empleados.</small> : null}
      {status === "loading" ? <small>Buscando legajos...</small> : null}
      {status === "error" ? <small className="error">No se pudo completar la búsqueda.</small> : null}
      {status === "success" ? (
        <div className="people-search-results">
          {multiple && visibleResults.length ? <div className="people-results-actions"><span>{visibleResults.length} resultado{visibleResults.length === 1 ? "" : "s"}</span>{selectableResults.length ? <button type="button" onClick={selectVisible}>Seleccionar resultados visibles</button> : <span>Todos seleccionados</span>}</div> : null}
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
          }) : <span>No encontramos legajos con esa búsqueda.</span>}
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
