import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import type { ShiftTemplate } from "../../services/api/workforceApiService";
import type { ShiftGroupSection } from "../../utils/shiftGroups";
import { ShiftTable, type ShiftAssignmentCounts } from "./ShiftTable";

function countLabel(count: number) {
  return `${count} ${count === 1 ? "turno" : "turnos"}`;
}

/**
 * Turnos agrupados por lugar (R3.2). Cada grupo es una sección colapsable
 * (mismo patrón accesible que Alertas de Turnos: botón con aria-expanded y
 * aria-controls) con la tabla de turnos de siempre adentro. Abiertas por
 * defecto; los grupos inactivos empiezan colapsados.
 */
export function ShiftGroupSections({
  sections,
  counts,
  canEdit,
  onToggleStatus,
}: {
  sections: ShiftGroupSection[];
  counts: Record<string, ShiftAssignmentCounts>;
  canEdit: boolean;
  onToggleStatus: (item: ShiftTemplate) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isCollapsed = (section: ShiftGroupSection) => collapsed[section.key] ?? section.inactive;
  const toggle = (section: ShiftGroupSection) => setCollapsed((current) => ({ ...current, [section.key]: !isCollapsed(section) }));

  return (
    <div className="shift-group-sections">
      {sections.map((section) => {
        const open = !isCollapsed(section);
        const bodyId = `shift-group-${section.key}`;
        return (
          <section key={section.key} className={`shift-group-section${section.inactive ? " is-inactive" : ""}${section.group ? "" : " is-ungrouped"}`} aria-label={section.title}>
            <header className="shift-group-head">
              <button type="button" className="shift-group-toggle" onClick={() => toggle(section)} aria-expanded={open} aria-controls={bodyId}>
                {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                <span className="shift-group-title">{section.title}</span>
              </button>
              <div className="shift-group-meta">
                <span className="shift-group-count">{countLabel(section.templates.length)}</span>
                {section.inactive ? <Badge tone="neutral">Grupo inactivo</Badge> : null}
              </div>
              {section.group ? null : <p className="shift-group-hint">Turnos todavía no clasificados en un lugar. Siguen funcionando igual.</p>}
            </header>
            {open ? (
              <div id={bodyId} className="shift-group-body">
                {section.templates.length ? (
                  <ShiftTable items={section.templates} counts={counts} canEdit={canEdit} onToggleStatus={onToggleStatus} layout="grouped" />
                ) : (
                  <EmptyState size="compact" text="Este grupo todavía no tiene turnos asociados." />
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
