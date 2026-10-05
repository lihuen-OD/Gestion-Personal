import type { ReactNode } from "react";
import type { EmployeeTimeGridRow } from "../../services/api/employeeApiService";
import type { DayAccounting, PeriodAccounting } from "../../types/workedTimeAccounting.types";
import { groupTimeGridRows } from "../../utils/employeeHoursGrid";
import { formatCompactDurationMinutes } from "../../utils/hours";
import { normalDayAmount, normalPeriodAmount, type SettlementAmount } from "../../utils/workedTimeAccounting";
import { amountDescription, amountMinutes, SettlementTotalCell, SpecialHourDot } from "./SettlementAmount";

type SpecialHoursByDay = Record<string, { ruleNames: string[] }>;

const realAmount = (minutes: number): SettlementAmount => ({ realMinutes: minutes, settlementMinutes: minutes, multiplier: 1, pending: false });

// Fila calculada (sólo lectura): los valores vienen de la contabilidad del
// backend (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md), nunca de sumar
// filas acá. `amount` decide qué se muestra: lo liquidable (Horas normales) o
// el tiempo real (Total trabajado).
function DerivedRow({
  className,
  label,
  subtitle,
  monthDays,
  accounting,
  amount,
  total,
  specialHoursByDay,
}: {
  className: string;
  label: string;
  subtitle: string;
  monthDays: number[];
  accounting: PeriodAccounting;
  amount: (day: DayAccounting) => SettlementAmount;
  total: SettlementAmount;
  specialHoursByDay: SpecialHoursByDay;
}) {
  return (
    <tr className={className}>
      <td>
        <b>{label}</b>
        <span className="table-sub" title={subtitle}>{subtitle}</span>
      </td>
      {monthDays.map((dayNumber) => {
        const day = accounting.days[String(dayNumber)];
        const value = day ? amount(day) : realAmount(0);
        const minutes = amountMinutes(value);
        const ruleNames = specialHoursByDay[String(dayNumber)]?.ruleNames;
        const description = amountDescription(value, ruleNames);
        return (
          <td key={dayNumber}>
            <span
              className={minutes ? "hour-cell derived filled" : "hour-cell derived"}
              title={minutes ? description : undefined}
              aria-label={`${label}, día ${dayNumber}: ${minutes ? description : "sin horas"}`}
            >
              <span>{minutes ? formatCompactDurationMinutes(minutes) : "—"}</span>
              {minutes ? <SpecialHourDot amount={value} ruleNames={ruleNames} /> : null}
            </span>
          </td>
        );
      })}
      <SettlementTotalCell amount={total} />
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
 * legajo y panel de cierre): Horas base (registradas) → "Distribución de la
 * jornada" (Horas normales + conceptos dentro de la jornada) → "Horas
 * adicionales" → Total trabajado (tiempo real).
 *
 * Cada fila que se liquida (Horas normales y cada concepto) muestra en cada
 * día y en TOTAL el tiempo PARA LIQUIDACIÓN, con el real como contexto, así
 * liquidación lee directamente cuánto corresponde a cada concepto (§17). No
 * hay fila global de equivalencia: mezclaba conceptos que pueden tener
 * valores distintos (sigue como control en el resumen del período).
 * Cada pantalla decide cómo dibujar una fila de concepto (editable o sólo
 * lectura) con `renderRow`.
 */
export function MonthlyHoursTableSections({
  rows,
  accounting,
  monthDays,
  renderRow,
  specialHoursByDay = {},
  syncing = false,
}: {
  rows: EmployeeTimeGridRow[];
  accounting: PeriodAccounting;
  monthDays: number[];
  renderRow: (row: EmployeeTimeGridRow) => ReactNode;
  specialHoursByDay?: SpecialHoursByDay;
  // Tras un guardado optimista, las filas calculadas se atenúan hasta que
  // llega la contabilidad recalculada por el backend.
  syncing?: boolean;
}) {
  const { base, withinBase, additive } = groupTimeGridRows(rows);
  const columnCount = monthDays.length + 2;
  const derivedClass = syncing ? " is-syncing" : "";
  // Con Hora Especial en el período, "Horas normales" se muestra siempre:
  // es la fila que dice cuánto liquidar como horas normales (sin conceptos
  // dentro de la jornada coincide en real con las Horas base).
  const showNormal = withinBase.length > 0 || accounting.hasSpecialMultiplier;
  return (
    <>
      <tbody>
        {base ? renderRow(base) : null}
        {showNormal ? (
          <>
            <GroupRow label="Distribución de la jornada" hint="Ya incluidas en las horas base" columnCount={columnCount} />
            <DerivedRow
              className={`hours-derived-row${derivedClass}`}
              label="Horas normales"
              subtitle="Base sin horas clasificadas"
              monthDays={monthDays}
              accounting={accounting}
              amount={normalDayAmount}
              total={normalPeriodAmount(accounting)}
              specialHoursByDay={specialHoursByDay}
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
          subtitle="Tiempo real · base + adicionales"
          monthDays={monthDays}
          accounting={accounting}
          amount={(day) => realAmount(day.totalWorkedMinutes)}
          total={realAmount(accounting.totalWorkedMinutes)}
          specialHoursByDay={specialHoursByDay}
        />
      </tfoot>
    </>
  );
}
