import type { HourConcept } from "../../types/hourConcept.types";
import type { ConceptAccounting, PeriodAccountingSummary } from "../../types/workedTimeAccounting.types";
import { formatDurationMinutes } from "../../utils/hours";

type ConceptLookup = Map<string, Pick<HourConcept, "name">>;

function ConceptRows({ concepts, names, showSettlement }: { concepts: ConceptAccounting[]; names: ConceptLookup; showSettlement: boolean }) {
  return (
    <>
      {concepts.map((concept) => (
        <tr key={concept.hourConceptId} className="is-child">
          <th scope="row">{names.get(concept.hourConceptId)?.name ?? "Concepto horario"}</th>
          <td>{formatDurationMinutes(concept.realMinutes)}</td>
          {showSettlement ? <td>{formatDurationMinutes(concept.settlementMinutes)}</td> : null}
        </tr>
      ))}
    </>
  );
}

/**
 * Composición del período (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md):
 * responde por separado "¿cuánto trabajó realmente?" y "¿cómo se compone para
 * liquidación?". Todos los valores vienen de la contabilidad del backend.
 */
export function HoursAccountingSummary({
  accounting,
  concepts,
  syncing = false,
}: {
  accounting: PeriodAccountingSummary;
  concepts: Array<Pick<HourConcept, "id" | "name">>;
  syncing?: boolean;
}) {
  const names: ConceptLookup = new Map(concepts.map((concept) => [concept.id, concept]));
  const withinBase = accounting.concepts.filter((concept) => concept.treatment === "WITHIN_BASE" && concept.realMinutes > 0);
  const additive = accounting.concepts.filter((concept) => concept.treatment === "ADDITIVE_TO_WORKED_TOTAL" && concept.realMinutes > 0);
  const showSettlement = accounting.hasSpecialMultiplier;
  const columnCount = showSettlement ? 3 : 2;

  return (
    <div className={syncing ? "hours-composition is-syncing" : "hours-composition"} aria-busy={syncing || undefined}>
      <table>
        <thead>
          <tr>
            <th scope="col">Composición</th>
            <th scope="col">Horas reales</th>
            {showSettlement ? <th scope="col">Para liquidación</th> : null}
          </tr>
        </thead>
        <tbody>
          <tr className="is-base">
            <th scope="row">
              Horas base
              <span className="table-sub">Registradas por fichada o carga</span>
            </th>
            <td>{formatDurationMinutes(accounting.baseMinutes)}</td>
            {showSettlement ? <td aria-label="No aplica">—</td> : null}
          </tr>
          {withinBase.length ? (
            <>
              <tr className="is-group"><th scope="rowgroup" colSpan={columnCount}>Distribución de la jornada</th></tr>
              <tr className="is-child">
                <th scope="row">Horas normales</th>
                <td>{formatDurationMinutes(accounting.normalResidualMinutes)}</td>
                {showSettlement ? <td>{formatDurationMinutes(accounting.settlement.normalMinutes)}</td> : null}
              </tr>
              <ConceptRows concepts={withinBase} names={names} showSettlement={showSettlement} />
            </>
          ) : (
            <tr className="is-child">
              <th scope="row">Horas normales</th>
              <td>{formatDurationMinutes(accounting.normalResidualMinutes)}</td>
              {showSettlement ? <td>{formatDurationMinutes(accounting.settlement.normalMinutes)}</td> : null}
            </tr>
          )}
          {additive.length ? (
            <>
              <tr className="is-group"><th scope="rowgroup" colSpan={columnCount}>Horas adicionales</th></tr>
              <ConceptRows concepts={additive} names={names} showSettlement={showSettlement} />
            </>
          ) : null}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{showSettlement ? "Total trabajado · Equivalencia" : "Total trabajado"}</th>
            <td>{formatDurationMinutes(accounting.totalWorkedMinutes)}</td>
            {showSettlement ? <td>{formatDurationMinutes(accounting.settlement.totalMinutes)}</td> : null}
          </tr>
        </tfoot>
      </table>
      {accounting.withinBaseOverlapMinutes > 0 ? (
        <p className="hours-composition-note">
          {formatDurationMinutes(accounting.withinBaseOverlapMinutes)} se superponen entre conceptos dentro de la jornada: cada concepto conserva sus horas, pero se descuentan una sola vez de las horas normales.
        </p>
      ) : null}
      {accounting.withinBaseExcessMinutes > 0 ? (
        <p className="hours-composition-note warning">
          Hay {formatDurationMinutes(accounting.withinBaseExcessMinutes)} cargadas dentro de la jornada en días sin horas base suficientes. Revisá esas cargas: no se suman como horas adicionales.
        </p>
      ) : null}
    </div>
  );
}
