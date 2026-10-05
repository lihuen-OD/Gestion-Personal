import type { ReactNode } from "react";
import type { EmployeeTimeGridRow } from "../../services/api/employeeApiService";
import type { DayAccounting, PeriodAccounting } from "../../types/workedTimeAccounting.types";
import { groupTimeGridRows } from "../../utils/employeeHoursGrid";
import { formatCompactDurationMinutes, formatDurationMinutes } from "../../utils/hours";
import { formatMultiplier } from "../attendance/segmentDisplay";

type DerivedValue = (day: DayAccounting) => number;

// Fila calculada (sólo lectura): los valores vienen de la contabilidad del
// backend (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md), nunca de sumar
// filas acá.
function DerivedRow({
  className,
  label,
  subtitle,
  monthDays,
  accounting,
  value,
  total,
  dayTitle,
}: {
  className: string;
  label: string;
  subtitle: string;
  monthDays: number[];
  accounting: PeriodAccounting;
  value: DerivedValue;
  total: number;
  dayTitle?: (day: DayAccounting) => string;
}) {
  return (
    <tr className={className}>
      <td>
        <b>{label}</b>
        <span className="table-sub" title={subtitle}>{subtitle}</span>
      </td>
      {monthDays.map((dayNumber) => {
        const day = accounting.days[String(dayNumber)];
        const minutes = day ? value(day) : 0;
        const fullDuration = formatDurationMinutes(minutes);
        return (
          <td key={dayNumber}>
            <span
              className={minutes ? "hour-cell derived filled" : "hour-cell derived"}
              title={day && minutes ? (dayTitle ? dayTitle(day) : fullDuration) : undefined}
              aria-label={`${label}, día ${dayNumber}: ${minutes ? fullDuration : "sin horas"}`}
            >
              {minutes ? formatCompactDurationMinutes(minutes) : "—"}
            </span>
          </td>
        );
      })}
      <td>
        <b title={formatDurationMinutes(total)}>{formatCompactDurationMinutes(total)}</b>
      </td>
    </tr>
  );
}

function GroupRow({ label, hint, columnCount }: { label: string; hint: string; columnCount: number }) {
  return (
    <tr className="hours-group-row">
      <td>
        <b>{label}</b>
        <span className="table-sub">{hint}</span>
      </td>
      <td colSpan={columnCount - 1} aria-hidden="true" />
    </tr>
  );
}

/**
 * Cuerpo y pie compartidos de la grilla mensual por concepto (detalle por
 * legajo y panel de cierre): Horas base → "Distribución de la jornada"
 * (Horas normales residuales + conceptos dentro de la jornada) → "Horas
 * adicionales" → Total trabajado y, si hubo Hora Especial, la equivalencia
 * para liquidación. Cada pantalla decide cómo dibujar una fila de concepto
 * (editable o sólo lectura) con `renderRow`.
 */
export function MonthlyHoursTableSections({
  rows,
  accounting,
  monthDays,
  renderRow,
  syncing = false,
}: {
  rows: EmployeeTimeGridRow[];
  accounting: PeriodAccounting;
  monthDays: number[];
  renderRow: (row: EmployeeTimeGridRow) => ReactNode;
  // Tras un guardado optimista, las filas calculadas se atenúan hasta que
  // llega la contabilidad recalculada por el backend.
  syncing?: boolean;
}) {
  const { base, withinBase, additive } = groupTimeGridRows(rows);
  const columnCount = monthDays.length + 2;
  const derivedClass = syncing ? " is-syncing" : "";
  return (
    <>
      <tbody>
        {base ? renderRow(base) : null}
        {withinBase.length ? (
          <>
            <GroupRow label="Distribución de la jornada" hint="Ya incluidas en las horas base" columnCount={columnCount} />
            <DerivedRow
              className={`hours-derived-row${derivedClass}`}
              label="Horas normales"
              subtitle="Base sin horas clasificadas"
              monthDays={monthDays}
              accounting={accounting}
              value={(day) => day.normalResidualMinutes}
              total={accounting.normalResidualMinutes}
            />
            {withinBase.map(renderRow)}
          </>
        ) : null}
        {additive.length ? (
          <>
            <GroupRow label="Horas adicionales" hint="Trabajadas fuera de la fichada" columnCount={columnCount} />
            {additive.map(renderRow)}
          </>
        ) : null}
      </tbody>
      <tfoot>
        <DerivedRow
          className={`hours-total-row${derivedClass}`}
          label="Total trabajado"
          subtitle="Horas base + horas adicionales"
          monthDays={monthDays}
          accounting={accounting}
          value={(day) => day.totalWorkedMinutes}
          total={accounting.totalWorkedMinutes}
        />
        {accounting.hasSpecialMultiplier ? (
          <DerivedRow
            className={`hours-settlement-row${derivedClass}`}
            label="Equivalencia para liquidación"
            subtitle="Horas × multiplicador del día"
            monthDays={monthDays}
            accounting={accounting}
            value={(day) => day.settlement.totalMinutes}
            total={accounting.settlement.totalMinutes}
            dayTitle={(day) => day.multiplier > 1
              ? `${formatDurationMinutes(day.settlement.totalMinutes)} · Hora especial ${formatMultiplier(day.multiplier)}`
              : formatDurationMinutes(day.settlement.totalMinutes)}
          />
        ) : null}
      </tfoot>
    </>
  );
}
