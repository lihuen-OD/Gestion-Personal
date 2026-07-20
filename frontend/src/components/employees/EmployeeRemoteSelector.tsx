import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { employeeApiService } from "../../services/api/employeeApiService";
import type { Employee } from "../../types";
import { displayLegajo, fullName } from "../../utils/employee";
import { useDebouncedValue } from "../../utils/useDebouncedValue";

export function EmployeeRemoteSelector({
  selected,
  multiple = false,
  onChange,
}: {
  selected: Employee[];
  multiple?: boolean;
  onChange: (employees: Employee[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Employee[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    const query = debouncedSearch.trim();
    if (query.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }

    let mounted = true;
    setStatus("loading");
    employeeApiService
      .getOptions({ search: query, take: 20 })
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
  }, [debouncedSearch]);

  const selectedIds = new Set(selected.map((employee) => employee.id));
  const choose = (employee: Employee) => {
    onChange(multiple ? [...selected.filter((item) => item.id !== employee.id), employee] : [employee]);
    setSearch("");
    setResults([]);
    setStatus("idle");
  };

  return (
    <div className="people-search form-wide">
      <label className="search-field">
        <Search size={17} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre, apellido, DNI, CUIL o legajo"
        />
      </label>
      {search.trim().length < 2 ? <small>Ingresá al menos 2 caracteres para buscar.</small> : null}
      {status === "loading" ? <small>Buscando legajos...</small> : null}
      {status === "error" ? <small className="error">No se pudo completar la búsqueda.</small> : null}
      {status === "success" ? (
        <div className="people-search-results">
          {results.length ? results.map((employee) => (
            <button key={employee.id} type="button" disabled={selectedIds.has(employee.id)} onClick={() => choose(employee)}>
              <b>{fullName(employee)}</b>
              <small>{displayLegajo(employee)} · DNI {employee.dni} · CUIL {employee.cuil}</small>
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
    </div>
  );
}
