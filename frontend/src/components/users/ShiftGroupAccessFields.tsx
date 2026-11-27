import { useId } from "react";
import type { ShiftGroup } from "../../services/api/shiftGroupApiService";
import type { UserInheritedShiftGroup, UserShiftGroup, UserSupervisionPerson } from "../../types";
import { Badge } from "../ui/Badge";
import { MultiOptionSelector, type MultiOption } from "./MultiOptionSelector";

/**
 * R8 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §26): alcance de turnos en
 * el alta y edición de usuarios. Sólo visualiza y edita lo que resuelve el
 * backend (`shiftGroups`, `inheritedShiftGroups`); la autorización real se
 * decide siempre en el servidor.
 */

/** Opciones: grupos ACTIVOS más los ya asignados aunque estén inactivos (para verlos y quitarlos). */
export function shiftGroupOptions(catalog: ShiftGroup[], keepIds: ReadonlySet<string>, assigned: UserShiftGroup[] = []): MultiOption[] {
  const byId = new Map<string, MultiOption & { sortOrder: number }>();
  for (const group of catalog) {
    if (group.status === "ACTIVO" || keepIds.has(group.id)) byId.set(group.id, { id: group.id, label: group.name, detail: group.code, inactive: group.status !== "ACTIVO", sortOrder: group.sortOrder });
  }
  // Un grupo asignado que el catálogo no trajo (carrera, borrado) igual se puede ver y quitar.
  for (const group of assigned) {
    if (!byId.has(group.id)) byId.set(group.id, { id: group.id, label: group.name, detail: group.code, inactive: group.status !== "Activo", sortOrder: Number.MAX_SAFE_INTEGER });
  }
  return [...byId.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "es"))
    .map(({ sortOrder: _sortOrder, ...option }) => option);
}

export function ShiftGroupsSelector({
  options,
  selectedIds,
  onChange,
  disabled,
  status,
  onRetry,
}: {
  options: MultiOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  status: "loading" | "error" | "ready";
  onRetry: () => void;
}) {
  return (
    <MultiOptionSelector
      title="Grupos de turnos que administra"
      help="Podrá ver y administrar turnos, rotaciones y asignaciones de estos grupos, siempre dentro de los legajos a su alcance. Los responsables de carga que supervisa los heredan."
      options={options}
      selectedIds={selectedIds}
      onChange={onChange}
      disabled={disabled}
      status={status}
      onRetry={onRetry}
      labels={{
        searchPlaceholder: "Buscar grupo por nombre o código",
        searchLabel: "Buscar grupo de turnos",
        resultsLabel: "Grupos de turnos disponibles",
        noMatch: "No encontramos grupos con esa búsqueda.",
        noOptions: "Todavía no hay grupos de turnos activos. Crealos desde Configuración › Turnos.",
        noneSelected: "Sin grupos asignados: no podrá administrar turnos.",
        loading: "Cargando grupos de turnos...",
        error: "No pudimos cargar los grupos de turnos. Los grupos actuales se conservan si guardás.",
        count: (count) => `${count} grupo${count === 1 ? "" : "s"} seleccionado${count === 1 ? "" : "s"}`,
      }}
    />
  );
}

function supervisorNames(people: Array<{ name: string }>) {
  return people.map((person) => person.name).join(", ");
}

/** Nivel 3: grupos heredados de sus Nivel 2 activos, sólo lectura. */
export function InheritedShiftGroupsPanel({
  inherited,
  supervisors,
  stored,
}: {
  inherited: UserInheritedShiftGroup[];
  supervisors: UserSupervisionPerson[];
  /** `false` en el alta o si recién se elige el rol: todavía no hay herencia que mostrar. */
  stored: boolean;
}) {
  const titleId = useId();
  return (
    <section className="inherited-shift-groups people-search" aria-labelledby={titleId}>
      <div className="multi-option-select-head">
        <b id={titleId}>Grupos de turnos heredados</b>
        <small>Un Nivel 3 no tiene grupos propios: hereda, en forma automática, los de los Nivel 2 activos que lo supervisan. Se actualizan solos cuando cambian sus supervisores o los grupos de ellos.</small>
      </div>
      {!stored ? (
        <em className="inherited-shift-groups-empty">Los heredará cuando un Nivel 2 lo tenga entre sus responsables de carga supervisados.</em>
      ) : inherited.length ? (
        <ul className="inherited-shift-groups-list">
          {inherited.map((entry) => (
            <li key={entry.group.id}>
              <span className="inherited-shift-groups-name">
                <b>{entry.group.name}</b>
                <small>{entry.group.code}</small>
                {entry.group.status === "Inactivo" ? <Badge tone="neutral">Inactivo</Badge> : null}
              </span>
              <small className="inherited-shift-groups-via">vía {supervisorNames(entry.viaSupervisors)}</small>
            </li>
          ))}
        </ul>
      ) : (
        <em className="inherited-shift-groups-empty">
          {supervisors.length
            ? `No hereda grupos: ${supervisorNames(supervisors)} no ${supervisors.length === 1 ? "tiene" : "tienen"} grupos asignados o no ${supervisors.length === 1 ? "está activo" : "están activos"}.`
            : "No hereda grupos: todavía no lo supervisa ningún Nivel 2."}
        </em>
      )}
    </section>
  );
}
