import { AlertTriangle, Coffee } from "lucide-react";
import { Badge } from "../ui/Badge";
import { TableShell } from "../ui/TableShell";
import { blockCrossesMidnight, blockDescription, GRID_WEEKDAYS, type GridCell, type GridCrewSection } from "../../utils/shiftRotationGrid";

function CellContent({ cell }: { cell: GridCell }) {
  if (cell.kind === "REST") {
    return <span className="rotation-rest"><Coffee size={13} aria-hidden="true" />Descanso</span>;
  }
  if (cell.kind === "MISSING") {
    return <span className="rotation-missing"><AlertTriangle size={13} aria-hidden="true" />Sin configurar</span>;
  }
  return (
    <ul className="rotation-blocks">
      {cell.blocks.map((block, index) => {
        const nextDay = blockCrossesMidnight(block.template);
        return (
          <li key={block.blockIndex} className={`rotation-block${nextDay ? " is-overnight" : ""}`}>
            <span className="sr-only">{blockDescription(block, { index, total: cell.blocks.length })}</span>
            <span className="rotation-block-time" aria-hidden="true">
              {block.template.startTime}–{block.template.endTime}
              {nextDay ? <abbr className="rotation-next-day" title="Termina al día siguiente">+1</abbr> : null}
            </span>
            <span className="rotation-block-code" aria-hidden="true" title={block.template.name}>{block.template.code}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Grilla de una versión en sólo lectura (R4.8B1): un grupo de filas por
 * equipo, una fila por semana del ciclo (A, B…) y columnas de lunes a
 * domingo. Cada estado tiene texto propio (turno con horario y código, "+1"
 * si termina al día siguiente, "Descanso", "Sin configurar"); el color sólo
 * acompaña. El editor (R4.8B2) reutiliza la misma celda.
 */
export function RotationCycleGrid({ sections, caption }: { sections: GridCrewSection[]; caption: string }) {
  return (
    <TableShell minWidth={880} className="rotation-grid-shell">
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
                  return (
                    <td key={weekday} className={`rotation-grid-cell is-${cell.kind.toLowerCase()}${hasIssues ? " has-issues" : ""}`} title={hasIssues ? cell.issues.join("\n") : undefined}>
                      <CellContent cell={cell} />
                      {hasIssues ? (
                        <span className="rotation-cell-issue">
                          <AlertTriangle size={12} aria-hidden="true" />
                          <span className="sr-only">Problema: {cell.issues.join(" ")}</span>
                          <span aria-hidden="true">Revisar</span>
                        </span>
                      ) : null}
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
