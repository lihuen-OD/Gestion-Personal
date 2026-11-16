import { useEffect, useId, useState } from "react";
import type { NoveltyType, NoveltyTypeCoverage } from "../../types/noveltyType.types";
import { formatDayDurationInput, parseDayDurationInput } from "../../utils/hours";
import {
  applyCoverageDayRule,
  applyCoverageMode,
  coverageDayOffOptions,
  coverageDayRuleOptions,
  coverageHolidayOptions,
  coverageModeOptions,
  coverageUsesCalendarPolicies,
  coverageWeekdayOptions,
  issueFor,
  realWorkCompatibilityOptions,
  toggleCoverageWeekday,
  type NoveltyTypeIssue,
} from "../../utils/noveltyTypeCoverage";
import { ChoiceGroup } from "../ui/ChoiceGroup";
import { describedBy, FieldMessages } from "./NoveltyTypeFields";

// Etapa 7 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §14): secciones "Tiempo
// que cubre", "Días y situaciones especiales" e "Impacto en el cálculo".
// Los enums sólo viajan como `value`; la pantalla muestra preguntas de negocio.

type FieldsProps = { item: NoveltyType; setItem: (item: NoveltyType) => void; issues?: NoveltyTypeIssue[]; disabled?: boolean };

function patchCoverage(item: NoveltyType, patch: Partial<NoveltyTypeCoverage>): NoveltyType {
  return { ...item, coverage: { ...item.coverage, ...patch } };
}

function FixedDurationInput({ item, setItem, error, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; error?: string; disabled?: boolean }) {
  const fixedMinutes = item.coverage.fixedMinutes;
  const id = useId();
  const [draft, setDraft] = useState(() => formatDayDurationInput(fixedMinutes));
  // Sincroniza cuando el valor cambia desde afuera (carga del tipo, cambio de modo).
  useEffect(() => {
    if (parseDayDurationInput(draft) !== fixedMinutes) setDraft(formatDayDurationInput(fixedMinutes));
  }, [fixedMinutes]);

  const hint = "Formato HH:mm, por ejemplo 04:00 o 08:30. Máximo 24:00.";
  return <div className="field-stack coverage-duration-field">
    <label>
      Cantidad de horas *
      <input
        inputMode="numeric"
        placeholder="HH:mm"
        maxLength={5}
        value={draft}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error })}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          setItem(patchCoverage(item, { fixedMinutes: parseDayDurationInput(next) }));
        }}
      />
    </label>
    <FieldMessages id={id} hint={hint} error={error} />
  </div>;
}

export function CoverageTimeFields({ item, setItem, issues, disabled }: FieldsProps) {
  const mode = item.coverage.mode;
  return <div className="coverage-section-body">
    <ChoiceGroup
      legend="¿Esta novedad representa tiempo?"
      options={coverageModeOptions}
      value={mode}
      disabled={disabled}
      onChange={(next) => setItem(applyCoverageMode(item, next))}
    />
    {mode === "FIXED_MINUTES" ? <FixedDurationInput item={item} setItem={setItem} disabled={disabled} error={issueFor(issues, "fixedMinutes")} /> : null}
    {mode === "MANUAL_MINUTES" ? (
      <p className="info-note compact">La duración se indica al cargar cada novedad y vale para un único día: este tipo no se puede cargar por rango de fechas.</p>
    ) : null}
    {mode === "EXPECTED_SCHEDULE" ? (
      <p className="info-note compact">Ejemplo: si la persona debía trabajar 8 h ese día, la novedad cubrirá 8 h. Si el sistema no puede determinar la jornada, el día queda para revisión en lugar de inventar una cantidad.</p>
    ) : null}
  </div>;
}

function WorkObligationExplanation() {
  return <div className="coverage-rule-explanation">
    <b>Francos y feriados los decide la jornada de la persona</b>
    <ul>
      <li>Franco: la novedad queda en 0 h.</li>
      <li>Feriado: cuenta sólo si la persona estaba convocada a trabajar ese día.</li>
      <li>Día sin obligación de trabajar: la novedad queda en 0 h.</li>
    </ul>
  </div>;
}

export function CoverageDayFields({ item, setItem, issues, disabled }: FieldsProps) {
  const coverage = item.coverage;
  if (coverage.mode === "EXPECTED_SCHEDULE") {
    return <div className="coverage-section-body">
      <div className="coverage-fixed-answer">
        <span>¿Qué días puede cubrir?</span>
        <b>Sólo días en los que debía trabajar</b>
        <small>Al cubrir la jornada que la persona debía cumplir, sólo cuenta en los días en los que tenía obligación de trabajar.</small>
      </div>
      <WorkObligationExplanation />
    </div>;
  }

  const weekdaysError = issueFor(issues, "weekdays");
  return <div className="coverage-section-body">
    <ChoiceGroup
      legend="¿Qué días puede cubrir?"
      options={coverageDayRuleOptions}
      value={coverage.dayRule}
      columns={3}
      disabled={disabled}
      onChange={(next) => setItem(applyCoverageDayRule(item, next))}
    >
      {coverage.dayRule === "SELECTED_WEEKDAYS" ? (
        <div className="coverage-weekdays" role="group" aria-label="Días de la semana que cubre" aria-invalid={weekdaysError ? true : undefined} aria-describedby={weekdaysError ? "coverage-weekdays-error" : undefined}>
          {coverageWeekdayOptions.map((day) => {
            const checked = coverage.weekdays.includes(day.value);
            return <label key={day.value} className={`coverage-weekday${checked ? " selected" : ""}`} title={day.long}>
              <input type="checkbox" checked={checked} disabled={disabled} aria-label={day.long} onChange={() => setItem(toggleCoverageWeekday(item, day.value))} />
              <span aria-hidden="true">{day.short}</span>
            </label>;
          })}
          {weekdaysError ? <small id="coverage-weekdays-error" className="field-error" role="alert">{weekdaysError}</small> : null}
        </div>
      ) : null}
    </ChoiceGroup>

    {coverageUsesCalendarPolicies(coverage) ? <>
      <ChoiceGroup
        legend="¿Qué sucede si la persona tiene franco ese día?"
        options={coverageDayOffOptions}
        value={coverage.onDayOff}
        disabled={disabled}
        error={issueFor(issues, "onDayOff")}
        onChange={(onDayOff) => setItem(patchCoverage(item, { onDayOff }))}
      />
      <ChoiceGroup
        legend="Si uno de estos días es feriado:"
        hint="No hay una opción predeterminada: elegí la política que corresponde a esta novedad."
        options={coverageHolidayOptions}
        value={coverage.onHoliday}
        columns={3}
        disabled={disabled}
        error={issueFor(issues, "onHoliday")}
        onChange={(onHoliday) => setItem(patchCoverage(item, { onHoliday }))}
      />
    </> : <WorkObligationExplanation />}
  </div>;
}

const countsOptions = [
  { value: "yes", label: "Sí, suma al total computable", description: "Una vez aprobada, sus horas se suman al total del día." },
  { value: "no", label: "No, sólo es informativa", description: "Se muestra con su cantidad, pero no aumenta el total. Ej.: llegada tarde." },
] as const;

const specialHoursOptions = [
  { value: "yes", label: "Sí, aplica multiplicadores", description: "Las horas cubiertas conservan su duración, pero pueden valer distinto para liquidación." },
  { value: "no", label: "No aplica", description: "Las horas cubiertas se liquidan por su duración base." },
] as const;

export function CoverageImpactFields({ item, setItem, disabled }: FieldsProps) {
  const coverage = item.coverage;
  const registersTime = coverage.mode !== "NONE";
  return <div className="coverage-section-body">
    {registersTime ? <>
      <ChoiceGroup
        legend="¿Suma al total de horas?"
        hint="Si no suma, la novedad se mostrará pero sus horas no aumentarán el total."
        options={[...countsOptions]}
        value={coverage.countsTowardTotal ? "yes" : "no"}
        disabled={disabled}
        onChange={(value) => setItem(patchCoverage(item, { countsTowardTotal: value === "yes" }))}
      />
      <ChoiceGroup
        legend="¿Debe aplicar reglas de domingos, feriados u Horas Especiales?"
        options={[...specialHoursOptions]}
        value={coverage.appliesSpecialHours ? "yes" : "no"}
        disabled={disabled}
        onChange={(value) => setItem(patchCoverage(item, { appliesSpecialHours: value === "yes" }))}
      >
        <div className="coverage-multiplier-example" aria-label="Ejemplo de multiplicador">
          <span><small>Horas cubiertas</small><b>8 h</b></span>
          <span><small>Domingo</small><b>×2</b></span>
          <span><small>Para liquidación</small><b>16 h</b></span>
          <p>Siguen siendo 8 h cubiertas: no son 16 h trabajadas.</p>
        </div>
      </ChoiceGroup>
    </> : (
      <p className="info-note compact">Como no registra horas, esta novedad no suma al total ni aplica multiplicadores.</p>
    )}
    <ChoiceGroup
      legend="¿Puede existir esta novedad el mismo día que hay horas trabajadas?"
      hint="Si se registra trabajo real en un día donde esta novedad no puede coexistir, el sistema lo marcará para revisión."
      options={realWorkCompatibilityOptions}
      value={coverage.realWorkCompatibility}
      disabled={disabled}
      onChange={(realWorkCompatibility) => setItem(patchCoverage(item, { realWorkCompatibility }))}
    />
  </div>;
}
