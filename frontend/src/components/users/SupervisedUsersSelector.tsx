import type { UserSupervisionPerson } from "../../types";
import { MultiOptionSelector } from "./MultiOptionSelector";

/**
 * Responsables de carga (usuarios Nivel 3) que supervisa un Nivel 2 y que
 * heredan sus legajos y grupos de turnos. Usa el
 * selector múltiple compartido (`MultiOptionSelector`).
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
  return (
    <MultiOptionSelector
      title="Responsables de carga supervisados"
      help="Los responsables de carga seleccionados heredan los legajos y grupos de turnos asignados a este usuario. Si se le agregan o quitan, el acceso se actualiza solo."
      options={options.map((person) => ({ id: person.id, label: person.name, detail: person.email, inactive: person.status === "Inactivo" }))}
      selectedIds={selectedIds}
      onChange={onChange}
      disabled={disabled}
      labels={{
        searchPlaceholder: "Buscar responsable por nombre o email",
        searchLabel: "Buscar responsable de carga",
        resultsLabel: "Responsables de carga disponibles",
        noMatch: "No encontramos responsables de carga con esa búsqueda.",
        noOptions: "Todavía no hay usuarios Nivel 3 - Administrativo de Carga Horaria para asignar.",
        noneSelected: "Sin responsables de carga supervisados.",
        count: (count) => `${count} responsable${count === 1 ? "" : "s"} seleccionado${count === 1 ? "" : "s"}`,
      }}
    />
  );
}
