import { Check, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { employeeApiService } from "../../services/api/employeeApiService";
import type { Employee } from "../../types";
import { displayLegajo, fullName } from "../../utils/employee";
import { useDebouncedValue } from "../../utils/useDebouncedValue";

export function EmployeeRemoteSelector({
  selected,
  multiple = false,
  showStatusFilter = false,
  wide = true,
  onChange,
}: {
  selected: Employee[];
  multiple?: boolean;
  showStatusFilter?: boolean;
  wide?: boolean;
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
  const selectableResults = results.filter((employee) => !selectedIds.has(employee.id));
  const selectVisible = () => onChange([...selected, ...selectableResults]);

  return (
    <div className={`people-search${wide ? " form-wide" : ""}`}>
      <div className="people-search-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, apellido, DNI, CUIL o legajo"
          />
        </label>
        {showStatusFilter ? <label className="people-status-filter"><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="ACTIVO">Activos</option><option value="INACTIVO">Inactivos</option><option value="">Todos</option></select></label> : null}
      </div>
      {!showStatusFilter && search.trim().length < 2 ? <small>Ingresá al menos 2 caracteres para buscar.</small> : null}
      {showStatusFilter && !search.trim() && status === "success" ? <small>Mostrando los primeros 20 legajos. Escribí para filtrar la lista.</small> : null}
      {status === "loading" ? <small>Buscando legajos...</small> : null}
      {status === "error" ? <small className="error">No se pudo completar la búsqueda.</small> : null}
      {status === "success" ? (
        <div className="people-search-results">
          {multiple && results.length ? <div className="people-results-actions"><span>{results.length} resultado{results.length === 1 ? "" : "s"}</span>{selectableResults.length ? <button type="button" onClick={selectVisible}>Seleccionar resultados</button> : <span>Todos seleccionados</span>}</div> : null}
          {results.length ? results.map((employee) => (
            <button key={employee.id} type="button" className={selectedIds.has(employee.id) ? "is-selected" : ""} aria-pressed={selectedIds.has(employee.id)} onClick={() => choose(employee)}>
              <span className="people-result-check">{selectedIds.has(employee.id) ? <Check size={14}/> : null}</span>
              <span><b>{fullName(employee)}</b><small>{displayLegajo(employee)} · DNI {employee.dni} · CUIL {employee.cuil}</small></span>
            </button>
          )) : <span>No encontramos legajos con esa búsqueda.</span>}
        </div>
      ) : null}
      <div className="selected-people">
        {selected.length ? selected.map((employee) => (
          <span key={employee.id}>
            {displayLegajo(employee)} · {fullName(employee)}
            <button type="button" aria-label={`Quitar ${fullName(employee)}`} onClick={() => onChange(selected.filter((item) => item.id !== employee.id))}>×</button>
          </span>
        )) : <em>Sin legajos seleccionados.</em>}
      </div>
      {multiple && selected.length ? <div className="people-selection-summary"><span>{selected.length} persona{selected.length === 1 ? "" : "s"} seleccionada{selected.length === 1 ? "" : "s"}</span><button type="button" onClick={() => onChange([])}>Quitar todas</button></div> : null}
    </div>
  );
}
