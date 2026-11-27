import type { ShiftGroup, ShiftGroupSummary } from "../services/api/shiftGroupApiService";
import type { ShiftTemplate } from "../services/api/workforceApiService";
import { compareSortValues } from "./sort";

/**
 * Agrupación visual de turnos por grupo (lugar) — R3.2,
 * docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §23. Lógica pura: la pantalla
 * sólo la dibuja.
 *
 * Orden de secciones: grupos activos por `sortOrder` y nombre → "Sin grupo"
 * → grupos inactivos (mismo orden). "Sin grupo" es un estado válido del
 * dominio (turno todavía no clasificado), no un error. Dentro de cada
 * sección se conserva el orden del catálogo (el de la pantalla de siempre).
 */
export const UNGROUPED_LABEL = "Sin grupo";
export const UNGROUPED_FILTER = "__none__";

export type ShiftGroupSection = {
  key: string;
  group: ShiftGroupSummary | null;
  title: string;
  inactive: boolean;
  templates: ShiftTemplate[];
};

function compareGroups(a: ShiftGroupSummary, b: ShiftGroupSummary) {
  return a.sortOrder - b.sortOrder || compareSortValues(a.name, b.name, "asc");
}

export function sortShiftGroups<T extends ShiftGroupSummary>(groups: readonly T[]): T[] {
  return [...groups].sort(compareGroups);
}

export function shiftGroupLabel(group: Pick<ShiftGroupSummary, "name"> | null | undefined) {
  return group?.name ?? UNGROUPED_LABEL;
}

/** Grupo de una plantilla: el que trae embebido el catálogo (fuente de verdad de la asociación). */
function groupOf(template: ShiftTemplate): ShiftGroupSummary | null {
  return template.shiftGroupId ? template.shiftGroup ?? null : null;
}

/**
 * Secciones de la pantalla.
 * - `groups`: catálogo de grupos, o `null` si no se pudo cargar. Sin catálogo,
 *   los grupos se deducen de los turnos (cada uno trae su grupo), así la
 *   clasificación existente no se pierde por un error de carga.
 * - `includeEmptyGroups`: mostrar grupos sin turnos (vista sin filtros).
 */
export function buildShiftGroupSections(templates: readonly ShiftTemplate[], groups: readonly ShiftGroupSummary[] | null, options: { includeEmptyGroups: boolean }): ShiftGroupSection[] {
  const known = new Map<string, ShiftGroupSummary>();
  for (const group of groups ?? []) known.set(group.id, group);
  for (const template of templates) {
    const group = groupOf(template);
    if (group && !known.has(group.id)) known.set(group.id, group);
  }

  const byGroup = new Map<string, ShiftTemplate[]>();
  const ungrouped: ShiftTemplate[] = [];
  for (const template of templates) {
    const group = groupOf(template);
    if (!group) {
      ungrouped.push(template);
      continue;
    }
    const list = byGroup.get(group.id) ?? [];
    list.push(template);
    byGroup.set(group.id, list);
  }

  const section = (group: ShiftGroupSummary): ShiftGroupSection => ({ key: group.id, group, title: group.name, inactive: group.status !== "ACTIVO", templates: byGroup.get(group.id) ?? [] });
  const visible = (group: ShiftGroupSummary) => options.includeEmptyGroups || byGroup.has(group.id);
  const ordered = sortShiftGroups([...known.values()]).filter(visible);
  const sections = ordered.filter((group) => group.status === "ACTIVO").map(section);
  if (ungrouped.length) sections.push({ key: UNGROUPED_FILTER, group: null, title: UNGROUPED_LABEL, inactive: false, templates: ungrouped });
  sections.push(...ordered.filter((group) => group.status !== "ACTIVO").map(section));
  return sections;
}

/** Filtro por grupo: "" = todos, UNGROUPED_FILTER = sin grupo, o el id del grupo. */
export function matchesShiftGroupFilter(template: ShiftTemplate, filter: string) {
  if (!filter) return true;
  const group = groupOf(template);
  return filter === UNGROUPED_FILTER ? !group : group?.id === filter;
}

export type ShiftGroupOption = { value: string; label: string };

/**
 * Opciones del selector "Grupo" de una plantilla: "Sin grupo" + grupos
 * ACTIVOS. Si la plantilla ya tiene un grupo inactivo, se agrega como valor
 * actual (se puede conservar) pero nunca se ofrece como destino de otra.
 * Sin catálogo (`groups = null`) sólo se ofrece conservar el actual o quitarlo.
 */
/**
 * `allowUngrouped: false` (R8, Nivel 2/3): un turno sin grupo es sólo de
 * RRHH, así que no se ofrece «Sin grupo».
 */
export function shiftGroupSelectOptions(groups: readonly ShiftGroup[] | null, current: ShiftGroupSummary | null | undefined, { allowUngrouped = true }: { allowUngrouped?: boolean } = {}): ShiftGroupOption[] {
  const options: ShiftGroupOption[] = allowUngrouped ? [{ value: "", label: UNGROUPED_LABEL }] : [];
  const active = sortShiftGroups((groups ?? []).filter((group) => group.status === "ACTIVO"));
  options.push(...active.map((group) => ({ value: group.id, label: group.name })));
  if (current && !active.some((group) => group.id === current.id)) {
    options.push({ value: current.id, label: current.status === "ACTIVO" ? current.name : `${current.name} (inactivo)` });
  }
  return options;
}
