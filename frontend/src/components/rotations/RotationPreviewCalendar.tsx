import { AlertTriangle, Coffee, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Badge } from "../ui/Badge";
import { TableShell } from "../ui/TableShell";
import type { PreviewCell, PreviewRow } from "../../services/api/shiftRotationApiService";
import { blockCodeText, blockTimeText, cycleWeekByDate, dayHeader, previewCellLabel, previewCellView, type PreviewCellView } from "../../utils/shiftRotationPreview";

const PERSON_COLUMN = 220;
// Ancho medido para "17:00–03:00 +1" sin invadir la columna vecina.
const DAY_COLUMN = 120;

function CellContent({ view }: { view: PreviewCellView }) {
  let main;
  if (view.blocks.length) {
    main = (
      <span className={`rotation-preview-blocks${view.suppressed ? " is-suppressed" : ""}`}>
        {view.blocks.map((block) => (
          <span key={`${block.blockIndex}-${block.scheduledStartAt}`} className={`rotation-block${block.template.crossesMidnight ? " is-overnight" : ""}${view.kind === "FIXED" ? " is-fixed" : ""}`}>
            <span className="rotation-block-time">
              {blockTimeText(block)}
              {block.template.crossesMidnight ? <abbr className="rotation-next-day" title="Termina al día siguiente">+1</abbr> : null}
            </span>
            <span className={`rotation-block-code${block.templateHidden ? " is-hidden-template" : ""}`}>{view.kind === "FIXED" ? `Fijo · ${blockCodeText(block)}` : blockCodeText(block)}</span>
          </span>
        ))}
      </span>
    );
  } else if (view.kind === "REST") {
    main = <span className="rotation-rest"><Coffee size={13} aria-hidden="true" />Descanso</span>;
  } else if (view.kind === "MISSING") {
    main = <span className="rotation-missing"><AlertTriangle size={13} aria-hidden="true" />Sin configurar</span>;
  } else if (view.kind === "CONFLICT") {
    main = <span className="rotation-conflict"><XCircle size={13} aria-hidden="true" />Conflicto</span>;
  } else {
    main = <span className="rotation-preview-none">—</span>;
  }
  return (
    <>
      {main}
      {view.tags.length || view.errors || view.warnings ? (
        <span className="rotation-preview-tags">
          {view.tags.map((tag) => <span key={tag} className="rotation-preview-tag">{tag}</span>)}
          {view.errors ? <span className="rotation-preview-alert is-error"><XCircle size={12} />{view.errors}</span> : null}
          {view.warnings ? <span className="rotation-preview-alert is-warning"><AlertTriangle size={12} />{view.warnings}</span> : null}
        </span>
      ) : null}
    </>
  );
}

/**
 * Calendario de la vista previa (R4.8D): una fila por persona y una columna
 * por fecha. El encabezado es una sola fila (día, fecha y, al empezar cada
 * tramo, la semana del ciclo A, B…): con dos filas fijas Chromium dejaba ver
 * el contenido que pasaba por detrás en la unión. La columna de personas y
 * los encabezados quedan fijos al desplazar; el desplazamiento horizontal es
 * interno. Una sola celda está en el orden de tabulación (la activa) y las
 * flechas, Inicio y Fin recorren la grilla; Enter abre el detalle.
 */
export function RotationPreviewCalendar({ rows, dates, todayKey, busy, onOpenCell }: { rows: PreviewRow[]; dates: string[]; todayKey: string; busy: boolean; onOpenCell: (row: PreviewRow, cell: PreviewCell) => void }) {
  const [active, setActive] = useState({ row: 0, col: 0 });
  const tableRef = useRef<HTMLTableElement>(null);
  const weeks = useMemo(() => cycleWeekByDate(dates, rows), [dates, rows]);
  const views = useMemo(() => rows.map((row) => row.days.map(previewCellView)), [rows]);

  // Si cambian la página o el rango, la celda activa vuelve a quedar dentro de la grilla.
  useEffect(() => {
    setActive((current) => ({ row: Math.min(current.row, Math.max(rows.length - 1, 0)), col: Math.min(current.col, Math.max(dates.length - 1, 0)) }));
  }, [rows.length, dates.length]);

  const focusCell = (row: number, col: number) => {
    setActive({ row, col });
    tableRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${row}-${col}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const lastRow = rows.length - 1;
    const lastCol = dates.length - 1;
    const { row, col } = active;
    const moves: Record<string, [number, number]> = {
      ArrowRight: [row, Math.min(col + 1, lastCol)],
      ArrowLeft: [row, Math.max(col - 1, 0)],
      ArrowDown: [Math.min(row + 1, lastRow), col],
      ArrowUp: [Math.max(row - 1, 0), col],
      Home: event.ctrlKey ? [0, 0] : [row, 0],
      End: event.ctrlKey ? [lastRow, lastCol] : [row, lastCol],
    };
    const target = moves[event.key];
    if (!target || !(event.target instanceof HTMLButtonElement) || !event.target.dataset.cell) return;
    event.preventDefault();
    focusCell(target[0], target[1]);
  };

  return (
    <TableShell minWidth={PERSON_COLUMN + dates.length * DAY_COLUMN} className={`rotation-preview-shell${busy ? " is-busy" : ""}`}>
      <table ref={tableRef} className="rotation-preview-grid" role="grid" aria-rowcount={rows.length + 1} aria-colcount={dates.length + 1} aria-busy={busy} onKeyDown={onKeyDown}>
        <caption className="sr-only">Vista previa por persona y día. Usá las flechas para moverte entre los días y Enter para ver el detalle.</caption>
        <thead>
          <tr className="rotation-preview-days">
            <th scope="col" className="rotation-preview-person-head">Persona</th>
            {dates.map((date, index) => {
              const header = dayHeader(date);
              const isToday = date === todayKey;
              const week = weeks[index]!;
              const weekText = week.label ? `Semana ${week.label}` : week.varies ? "Varía" : "";
              return (
                <th key={date} scope="col" aria-current={isToday ? "date" : undefined} className={`${isToday ? "is-today" : ""}${week.start ? " is-week-start" : ""}`.trim() || undefined}>
                  {/* Al empezar el tramo: "Semana B"; en los demás días, sólo la letra (sigue visible al desplazar). */}
                  <span className={`rotation-preview-week${week.label ? " has-week" : ""}${week.start ? "" : " is-continued"}`} aria-hidden={week.start ? undefined : true}>{week.start ? weekText : week.label ?? (week.varies ? "Varía" : "")}</span>
                  <abbr title={header.full}>{header.short}</abbr>
                  <span className="rotation-preview-date">{header.date}</span>
                  {!week.start && weekText ? <span className="sr-only">{weekText}</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.employee.id}>
              <th scope="row" className="rotation-preview-person">
                <span className="rotation-preview-person-name">{row.employee.lastName}, {row.employee.firstName}</span>
                <span className="rotation-preview-person-meta">Legajo {row.employee.legajo}{row.employee.status !== "ACTIVO" ? <Badge tone="warning">Inactiva</Badge> : null}</span>
              </th>
              {row.days.map((cell, colIndex) => {
                const view = views[rowIndex]![colIndex]!;
                const isActive = active.row === rowIndex && active.col === colIndex;
                return (
                  <td key={cell.date} role="gridcell" className={`rotation-preview-cell is-${view.kind.toLowerCase()}${view.errors ? " has-errors" : ""}${cell.date === todayKey ? " is-today" : ""}${weeks[colIndex]?.start ? " is-week-start" : ""}`}>
                    <button
                      type="button"
                      className="rotation-cell-button"
                      data-cell={`${rowIndex}-${colIndex}`}
                      tabIndex={isActive ? 0 : -1}
                      aria-label={previewCellLabel(row, cell, view)}
                      onFocus={() => { if (!isActive) setActive({ row: rowIndex, col: colIndex }); }}
                      onClick={() => onOpenCell(row, cell)}
                    >
                      <CellContent view={view} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}
