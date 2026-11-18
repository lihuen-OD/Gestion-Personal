import { Check } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { UserSupervisionPerson } from "../../types";
import { Badge } from "../ui/Badge";
import { SearchInput } from "../ui/SearchInput";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Responsables de carga (usuarios Nivel 3) que supervisa un Nivel 2. Mismo
 * patrón visual que el selector de empleados (buscador, resultados con check
 * y chips de selección), filtrando en memoria: la lista de usuarios ya está
 * cargada en la pantalla y es chica.
 */
export function SupervisedUsersSelector({
  options,
  selectedIds,
  onChange,
  disabled = false,
}: {
  /** Usuarios Nivel 3 elegibles (incluye seleccionados inactivos para poder quitarlos). */
  options: UserSupervisionPerson[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const headingId = useId();
  const helpId = useId();
  const [search, setSearch] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const query = normalize(search.trim());
  const visible = options.filter((option) => !query || normalize(`${option.name} ${option.email}`).includes(query));
  const selectedPeople = selectedIds.map((id) => byId.get(id)).filter((person): person is UserSupervisionPerson => Boolean(person));

  const toggle = (id: string) => onChange(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);

  return (
    <section className="people-search supervised-users" aria-labelledby={headingId} aria-describedby={helpId}>
      <div className="supervised-users-head">
        <b id={headingId}>Responsables de carga supervisados</b>
        <small id={helpId}>Este usuario podrá acceder a los legajos asignados a los responsables de carga seleccionados. Si se les agregan o quitan legajos, el acceso se actualiza solo.</small>
      </div>
      {options.length ? (
        <>
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar responsable por nombre o email"
            aria-label="Buscar responsable de carga"
            disabled={disabled}
          />
          <div className="people-search-results" role="group" aria-label="Responsables de carga disponibles">
            {visible.length ? visible.map((person) => (
              <button key={person.id} type="button" className={selected.has(person.id) ? "is-selected" : ""} aria-pressed={selected.has(person.id)} disabled={disabled} onClick={() => toggle(person.id)}>
                <span className="people-result-check">{selected.has(person.id) ? <Check size={14} /> : null}</span>
                <span>
                  <b>{person.name}{person.status === "Inactivo" ? <Badge tone="neutral">Inactivo</Badge> : null}</b>
                  <small>{person.email}</small>
                </span>
              </button>
            )) : <span>No encontramos responsables de carga con esa búsqueda.</span>}
          </div>
        </>
      ) : (
        <small>Todavía no hay usuarios Nivel 3 - Administrativo de Carga Horaria para asignar.</small>
      )}
      <div className="selected-people" aria-live="polite">
        {selectedPeople.length ? selectedPeople.map((person) => (
          <span key={person.id}>
            {person.name}
            <button type="button" aria-label={`Quitar ${person.name}`} disabled={disabled} onClick={() => toggle(person.id)}>×</button>
          </span>
        )) : <em>Sin responsables de carga supervisados.</em>}
      </div>
      {selectedPeople.length ? (
        <div className="people-selection-summary">
          <span>{selectedPeople.length} responsable{selectedPeople.length === 1 ? "" : "s"} seleccionado{selectedPeople.length === 1 ? "" : "s"}</span>
          <button type="button" disabled={disabled} onClick={() => onChange([])}>Quitar todos</button>
        </div>
      ) : null}
    </section>
  );
}
