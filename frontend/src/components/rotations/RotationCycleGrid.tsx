import { AlertTriangle, Coffee } from "lucide-react";
import { Badge } from "../ui/Badge";
import { TableShell } from "../ui/TableShell";
import { blockCrossesMidnight, blockDescription, cellDescription, GRID_WEEKDAYS, type GridCell, type GridCrewSection } from "../../utils/shiftRotationGrid";

export type GridCellTarget = { crewId: string; crewName: string; cycleWeekIndex: number; weekLabel: string; weekday: number; weekdayName: string };

// Sólo elementos de texto (span): la celda editable es un <button>, que no admite listas adentro.
function CellContent({ cell }: { cell: GridCell }) {
  if (cell.kind === "REST") {
    return <span className="rotation-rest"><Coffee size={13} aria-hidden="true" />Descanso</span>;
  }
  if (cell.kind === "MISSING") {
    return <span className="rotation-missing"><AlertTriangle size={13} aria-hidden="true" />Sin configurar</span>;
  }
  return (
    <span className="rotation-blocks">
      {cell.blocks.map((block, index) => {
        const nextDay = blockCrossesMidnight(block.template);
        return (
          <span key={`${block.blockIndex}-${index}`} className={`rotation-block${nextDay ? " is-overnight" : ""}`}>
            <span className="sr-only">{blockDescription(block, { index, total: cell.blocks.length })}</span>
            <span className="rotation-block-time" aria-hidden="true">
              {block.template.startTime}–{block.template.endTime}
              {nextDay ? <abbr className="rotation-next-day" title="Termina al día siguiente">+1</abbr> : null}
            </span>
            <span className="rotation-block-code" aria-hidden="true" title={block.template.name}>{block.template.code}</span>
          </span>
        );
      })}
    </span>
  );
}

function IssueMark({ issues }: { issues: string[] }) {
  return (
    <span className="rotation-cell-issue">
      <AlertTriangle size={12} aria-hidden="true" />
      <span className="sr-only">Problema: {issues.join(" ")}</span>
      <span aria-hidden="true">Revisar</span>
    </span>
  );
}

/**
 * Grilla de una versión (R4.8B1, reutilizada por el editor de R4.8B2): un
 * grupo de filas por equipo, una fila por semana del ciclo (A, B…) y columnas
 * de lunes a domingo. Cada estado tiene texto propio (turno con horario y
 * código, "+1" si termina al día siguiente, "Descanso", "Sin configurar"); el
 * color sólo acompaña. Con `onEditCell` cada celda es un botón que abre su
 * editor; sin él la grilla es de sólo lectura.
 */
export function RotationCycleGrid({ sections, caption, onEditCell }: { sections: GridCrewSection[]; caption: string; onEditCell?: (target: GridCellTarget) => void }) {
  return (
    <TableShell minWidth={880} className={`rotation-grid-shell${onEditCell ? " is-editable" : ""}`}>
      <table className="rotation-grid">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="rotation-grid-week">Semana</th>
            {GRID_WEEKDAYS.map((day) => <th key={day.weekday} scope="col"><abbr title={day.long}>{day.short}</abbr></th>)}
          </tr>
        </thead>
        {sections.map((section) => (
          <tbody key={section.crewId}>
            <tr className="rotation-grid-crew">
              <th scope="colgroup" colSpan={GRID_WEEKDAYS.length + 1}>
                <div className="rotation-grid-crew-label">
                  <span className="rotation-grid-crew-name">{section.name}</span>
                  {section.code ? <span className="rotation-grid-crew-code">Código {section.code}</span> : null}
                  {section.inactive ? <Badge tone="neutral">Inactivo</Badge> : null}
                  {section.unknown ? <Badge tone="warning">Equipo inexistente</Badge> : null}
                </div>
              </th>
            </tr>
            {section.weeks.map((week) => (
              <tr key={week.cycleWeekIndex}>
                <th scope="row" className="rotation-grid-week">Semana {week.label}</th>
                {week.cells.map(({ weekday, cell }) => {
                  const hasIssues = cell.issues.length > 0;
                  const day = GRID_WEEKDAYS.find((item) => item.weekday === weekday)!;
                  const className = `rotation-grid-cell is-${cell.kind.toLowerCase()}${hasIssues ? " has-issues" : ""}`;
                  if (onEditCell && !section.unknown) {
                    const label = `${section.name}, semana ${week.label}, ${day.long}: ${cellDescription(cell)}.${hasIssues ? ` Problema: ${cell.issues.join(" ")}` : ""} Editar día.`;
                    return (
                      <td key={weekday} className={className}>
                        <button
                          type="button"
                          className="rotation-cell-button"
                          aria-label={label}
                          title={hasIssues ? cell.issues.join("\n") : undefined}
                          onClick={() => onEditCell({ crewId: section.crewId, crewName: section.name, cycleWeekIndex: week.cycleWeekIndex, weekLabel: week.label, weekday, weekdayName: day.long })}
                        >
                          <CellContent cell={cell} />
                          {hasIssues ? <IssueMark issues={cell.issues} /> : null}
                        </button>
                      </td>
                    );
                  }
                  return (
                    <td key={weekday} className={className} title={hasIssues ? cell.issues.join("\n") : undefined}>
                      <CellContent cell={cell} />
                      {hasIssues ? <IssueMark issues={cell.issues} /> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </TableShell>
  );
}
