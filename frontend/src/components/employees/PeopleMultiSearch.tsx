import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { employeeApiService } from "../../services/api/employeeApiService";
import { employeeMockService } from "../../services/employeeMockService";
import type { Employee } from "../../types";
import { displayLegajo } from "../../utils/employee";

function employeeSearchLabel(employee: Employee) {
  return `${employee.lastName}, ${employee.firstName} · Legajo ${displayLegajo(employee)} · DNI ${employee.dni} · CUIL ${employee.cuil}`;
}

function assignmentPersonName(employee: Employee) {
  return `${employee.firstName} ${employee.lastName}`;
}

function normalizePeopleSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function PeopleMultiSearch({
  label,
  selected,
  onChange,
  excludeId,
}: {
  label: string;
  selected: string[];
  onChange: (values: string[]) => void;
  excludeId?: string;
}) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Employee[]>(() => employeeMockService.getAll());

  useEffect(() => {
    let mounted = true;
    employeeApiService.getAll()
      .then((employees) => {
        if (mounted) setCandidates(employees);
      })
      .catch(() => {
        if (mounted) setCandidates(employeeMockService.getAll());
      });
    return () => {
      mounted = false;
    };
  }, []);

  const normalized = normalizePeopleSearch(query.trim());
  const cleanSelected = selected.filter(Boolean);
  const selectedSet = new Set(cleanSelected);
  const options = candidates
    .filter((employee) => employee.id !== excludeId)
    .filter((employee) => !selectedSet.has(assignmentPersonName(employee)))
    .filter((employee) => {
      const text = normalizePeopleSearch(
        `${employee.firstName} ${employee.lastName} ${employee.lastName} ${employee.firstName} ${displayLegajo(employee)} ${employee.legajoFinnegans || ""} ${employee.dni} ${employee.cuil}`,
      );
      return normalized.length >= 1 && text.includes(normalized);
    })
    .slice(0, 8);

  const add = (name: string) => {
    if (!selectedSet.has(name)) onChange([...cleanSelected, name]);
    setQuery("");
  };
  const remove = (name: string) => onChange(cleanSelected.filter((item) => item !== name));

  return (
    <div className="people-search form-wide">
      <small>{label}</small>
      <div className="search-field">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nombre, apellido, DNI, CUIL o legajo"
        />
      </div>
      {query.trim().length > 0 ? (
        <div className="people-search-results">
          {options.length ? (
            options.map((employee) => (
              <button type="button" key={employee.id} onClick={() => add(assignmentPersonName(employee))}>
                <b>{assignmentPersonName(employee)}</b>
                <small>{employeeSearchLabel(employee)}</small>
              </button>
            ))
          ) : (
            <span>No encontramos personas con esa busqueda.</span>
          )}
        </div>
      ) : null}
      <div className="selected-people">
        {cleanSelected.length ? (
          cleanSelected.map((name) => (
            <span key={name}>
              {name}
              <button type="button" onClick={() => remove(name)}>
                x
              </button>
            </span>
          ))
        ) : (
          <em>Sin personas seleccionadas.</em>
        )}
      </div>
    </div>
  );
}
