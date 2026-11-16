import type { ReactNode } from "react";
import type { EmployeeTimeGridRow } from "../../services/api/employeeApiService";
import type { NoveltyCoverageRow } from "../../services/api/employeeApiService";
import type { DayAccounting, NoveltyCoverageItem, PeriodAccounting } from "../../types/workedTimeAccounting.types";
import { groupTimeGridRows } from "../../utils/employeeHoursGrid";
import { formatCompactDurationMinutes } from "../../utils/hours";
import { noveltyColorClass } from "../../utils/noveltyColor";
import { normalDayAmount, normalPeriodAmount, type SettlementAmount } from "../../utils/workedTimeAccounting";
import { amountDescription, amountMinutes, SettlementTotalCell, SpecialHourDot } from "./SettlementAmount";
import { noveltyCoverageStateLabel } from "./NoveltyCoverage";

type SpecialHoursByDay = Record<string, { ruleNames: string[] }>;

// Valor que se muestra tal cual (sin indicador ni subtexto real).
const plainAmount = (minutes: number): SettlementAmount => ({ realMinutes: minutes, settlementMinutes: minutes, multiplier: 1, pending: false });

// Fila calculada (sólo lectura): los valores vienen de la contabilidad del
// backend (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md), nunca de sumar
// filas acá. `amount` decide qué se muestra en cada celda.
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
        const value = day ? amount(day) : plainAmount(0);
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

function NoveltyRow({ row, monthDays, noveltiesByDay, onReview }: { row: NoveltyCoverageRow; monthDays: number[]; noveltiesByDay: Record<string, NoveltyCoverageItem[]>; onReview?: (item: NoveltyCoverageItem, day: number) => void }) {
  const totalMinutes = row.totals.coveredMinutes + row.totals.informativeMinutes + row.totals.pendingApprovalMinutes + row.totals.heldMinutes;
  const totalDetail = [
    row.totals.coveredMinutes ? `${formatCompactDurationMinutes(row.totals.coveredMinutes)} computan` : "",
    row.totals.informativeMinutes ? `${formatCompactDurationMinutes(row.totals.informativeMinutes)} informativas` : "",
    row.totals.pendingApprovalMinutes ? `${formatCompactDurationMinutes(row.totals.pendingApprovalMinutes)} pendientes` : "",
    row.totals.heldMinutes ? `${formatCompactDurationMinutes(row.totals.heldMinutes)} a revisar` : "",
  ].filter(Boolean).join(" · ");
  return (
    <tr className="hours-novelty-row" key={row.noveltyType.id}>
      <td><b>{row.noveltyType.name}</b><span className="table-sub">{row.countsTowardTotal ? "Cobertura configurada" : "Informativa · no suma"}</span></td>
      {monthDays.map((day) => {
        const key = String(day);
        const minutes = row.minutesByDay[key] ?? 0;
        const state = row.stateByDay[key];
        const item = noveltiesByDay[key]?.find((candidate) => candidate.noveltyTypeId === row.noveltyType.id && candidate.state === state);
        if (!state && !minutes) return <td key={day}><span className="hour-cell derived">—</span></td>;
        const className = `hour-cell novelty-coverage-grid-cell is-${state.toLowerCase().replace("_", "-")} ${noveltyColorClass(row.noveltyType.uiColor, row.noveltyType.id)}`;
        const content = <><span>{formatCompactDurationMinutes(state === "COUNTED" ? (row.settlementMinutesByDay[key] ?? minutes) : minutes)}</span><small>{noveltyCoverageStateLabel(state)}</small></>;
        // §17: cualquier día calculado se abre; en revisión, para resolverlo; si no, para ver su detalle.
        return <td key={day}>{item && onReview ? <button type="button" className={className} onClick={() => onReview(item, day)} title={`${row.noveltyType.name}: ${noveltyCoverageStateLabel(state)}`} aria-label={`${row.noveltyType.name}, día ${day}: ${state === "REVIEW_REQUIRED" ? "revisar cobertura" : "ver detalle de la cobertura"}`}>{content}</button> : <span className={className} title={`${row.noveltyType.name}: ${noveltyCoverageStateLabel(state)}`}>{content}</span>}</td>;
      })}
      <td><b title={totalDetail}>{formatCompactDurationMinutes(totalMinutes)}</b><span className="table-sub">{totalDetail}</span></td>
    </tr>
  );
}

/**
 * Cuerpo y pie compartidos de la grilla mensual por concepto (detalle por
 * legajo y panel de cierre): Horas base (tiempo real registrado) →
 * "Distribución de la jornada" (Horas normales + conceptos dentro de la
 * jornada) → "Horas adicionales" → Total para liquidación.
 *
 * Cada fila que se liquida (Horas normales y cada concepto) muestra en cada
 * día y en TOTAL el tiempo PARA LIQUIDACIÓN, con el real como contexto, así
 * liquidación lee directamente cuánto corresponde a cada concepto (§17). No
 * fila final es la suma de esas filas para liquidación (backend
 * settlement.totalMinutes): esta grilla se lee entera en clave de
 * liquidación, salvo Horas base. El tiempo real trabajado está en la
 * tarjeta y en el resumen "Total trabajado".
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
  noveltyCoverageRows = [],
  noveltiesByDay = {},
  onReviewNovelty,
}: {
  rows: EmployeeTimeGridRow[];
  accounting: PeriodAccounting;
  monthDays: number[];
  renderRow: (row: EmployeeTimeGridRow) => ReactNode;
  specialHoursByDay?: SpecialHoursByDay;
  // Tras un guardado optimista, las filas calculadas se atenúan hasta que
  // llega la contabilidad recalculada por el backend.
  syncing?: boolean;
  noveltyCoverageRows?: NoveltyCoverageRow[];
  noveltiesByDay?: Record<string, NoveltyCoverageItem[]>;
  onReviewNovelty?: (item: NoveltyCoverageItem, day: number) => void;
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
        {noveltyCoverageRows.length ? (
          <>
            <GroupRow label="Cobertura por novedades" hint="Separada del trabajo real; sólo computa cuando está aprobada y sin revisión" columnCount={columnCount} />
            {noveltyCoverageRows.map((row) => <NoveltyRow key={row.noveltyType.id} row={row} monthDays={monthDays} noveltiesByDay={noveltiesByDay} onReview={onReviewNovelty} />)}
          </>
        ) : null}
      </tbody>
      <tfoot>
        <DerivedRow
          className={`hours-total-row${derivedClass}`}
          label="Total para liquidación"
          subtitle="Suma de horas para liquidación"
          monthDays={monthDays}
          accounting={accounting}
          amount={(day) => plainAmount(day.settlement.totalMinutes)}
          total={plainAmount(accounting.settlement.totalMinutes)}
          specialHoursByDay={specialHoursByDay}
        />
      </tfoot>
    </>
  );
}
