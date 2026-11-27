import { AlertTriangle } from "lucide-react";
import type { NoveltyCoveragePreview } from "../../services/api/noveltyApiService";
import { formatDurationMinutes } from "../../utils/hours";
import { MAX_PREVIEW_EMPLOYEES, previewDayView, summarizeNoveltyPreview, type NoveltyLoadLayout, type NoveltyPreviewDayView } from "../../utils/noveltyLoad";
import { Button } from "../ui/Button";
import type { NoveltyCoveragePreviewState } from "./useNoveltyCoveragePreview";

// Etapa 8 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §15): vista previa de
// cobertura antes de guardar. Todo lo que muestra lo calculó el backend; acá
// sólo se traduce a lenguaje de negocio y se suma lo ya calculado.

function DayRow({ day }: { day: NoveltyPreviewDayView }) {
  const amounts: string[] = [];
  if (day.provisional) amounts.push("Cobertura provisional: 0 h");
  else if (day.informative) amounts.push(`Duración: ${formatDurationMinutes(day.baseMinutes)}`, "No suma al total");
  else if (!day.noHours) amounts.push(`Cubre: ${formatDurationMinutes(day.baseMinutes)}`);
  if (day.multiplier > 1 && day.baseMinutes > 0) amounts.push(`Multiplicador ×${day.multiplier}`);
  if (day.settlementMinutes != null && day.baseMinutes > 0) amounts.push(`Liquidación: ${formatDurationMinutes(day.settlementMinutes)}`);
  return (
    <li className={`novelty-preview-day tone-${day.tone}`}>
      <div className="novelty-preview-day-head">
        <b>{day.dateLabel}</b>
        <span className="novelty-preview-day-title">{day.tone === "review" ? <AlertTriangle size={13} aria-hidden="true" /> : null}{day.title}</span>
      </div>
      {day.detail ? <p className="novelty-preview-day-detail">{day.detail}</p> : null}
      {amounts.length ? <p className="novelty-preview-day-amounts">{amounts.join(" · ")}</p> : null}
      {day.workedMinutes > 0 ? <p className="novelty-preview-day-worked">Trabajo registrado: {formatDurationMinutes(day.workedMinutes)}</p> : null}
      {day.messages.map((message) => <p key={message} className="novelty-preview-day-warning">{message}</p>)}
    </li>
  );
}

function Summary({ preview, layout }: { preview: NoveltyCoveragePreview; layout: NoveltyLoadLayout }) {
  const summary = summarizeNoveltyPreview(preview);
  const people = preview.employees.length;
  const items: Array<[string, string]> = [[people > 1 ? "Días (todas las personas)" : "Días", String(summary.days)]];
  if (layout.quantity !== "NONE") {
    if (summary.informativeMinutes > 0 || !layout.countsTowardTotal) {
      items.push(["Informativas", formatDurationMinutes(summary.informativeMinutes)]);
    } else {
      items.push(["Cubiertas", formatDurationMinutes(summary.coveredMinutes)], ["Computables", formatDurationMinutes(summary.computableMinutes)], ["Para liquidación", formatDurationMinutes(summary.settlementMinutes)]);
    }
  }
  if (summary.reviewDays) items.push(["Requieren revisión", summary.reviewDays === 1 ? "1 día" : `${summary.reviewDays} días`]);
  return (
    <dl className="novelty-preview-summary">
      {items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

function EmployeeDays({ days, layout }: { days: NoveltyCoveragePreview["employees"][number]["days"]; layout: NoveltyLoadLayout }) {
  const views = days.map(previewDayView);
  // Una novedad sin horas sólo muestra los días con algo que avisar.
  const visible = layout.quantity === "NONE" ? views.filter((day) => day.messages.length) : views;
  if (layout.quantity === "NONE" && !visible.length) return <p className="novelty-preview-empty">Sin horas de cobertura.</p>;
  return <ul className="novelty-preview-days">{visible.map((day) => <DayRow key={day.date} day={day} />)}</ul>;
}

export function NoveltyCoveragePreviewPanel({
  state,
  layout,
  employeeCount,
  missingHint,
  onRetry,
}: {
  state: NoveltyCoveragePreviewState;
  layout: NoveltyLoadLayout | null;
  employeeCount: number;
  /** Qué falta completar para poder calcular (estado inicial). */
  missingHint: string;
  onRetry: () => void;
}) {
  let body;
  // Lo que se anuncia a lectores de pantalla: una frase, no la lista completa.
  let announcement = "";
  if (employeeCount > MAX_PREVIEW_EMPLOYEES) {
    body = <p className="novelty-preview-empty">La vista previa está disponible hasta {MAX_PREVIEW_EMPLOYEES} personas. La novedad se puede guardar igual.</p>;
  } else if (state.status === "idle" || !layout) {
    body = <p className="novelty-preview-empty">{missingHint}</p>;
  } else if (state.status === "loading") {
    body = <p className="novelty-preview-empty">Calculando vista previa…</p>;
    announcement = "Calculando vista previa.";
  } else if (state.status === "error") {
    announcement = state.message;
    body = <div className="novelty-preview-error">
      <p>{state.message}</p>
      {state.detail ? <p>{state.detail}</p> : null}
      <Button variant="subtle" onClick={onRetry}>Reintentar</Button>
    </div>;
  } else {
    const preview = state.data;
    const summary = summarizeNoveltyPreview(preview);
    const conflicts = summary.conflictDays;
    announcement = `Vista previa actualizada: ${summary.days === 1 ? "1 día" : `${summary.days} días`}${summary.reviewDays ? `, ${summary.reviewDays} para revisar` : ""}.`;
    body = <>
      {layout.quantity === "NONE" ? <p className="novelty-preview-none">Sin horas de cobertura</p> : null}
      <Summary preview={preview} layout={layout} />
      {conflicts ? (
        <p className="novelty-preview-conflict" role="note"><AlertTriangle size={14} aria-hidden="true" />{layout.quantity === "NONE" ? "Existe trabajo registrado en la fecha. La novedad deberá revisarse." : `Hay trabajo registrado en ${conflicts === 1 ? "1 día" : `${conflicts} días`}: la novedad podrá guardarse, pero quedará para revisión.`}</p>
      ) : null}
      {preview.employees.length === 1 ? (
        <EmployeeDays days={preview.employees[0]!.days} layout={layout} />
      ) : (
        preview.employees.map(({ employee, days }) => (
          <details key={employee.id} className="novelty-preview-employee">
            <summary>{employee.legajo} · {employee.lastName}, {employee.firstName}</summary>
            <EmployeeDays days={days} layout={layout} />
          </details>
        ))
      )}
    </>;
  }

  return (
    <section className="novelty-preview" aria-labelledby="novelty-preview-title">
      <h4 id="novelty-preview-title">Vista previa de cobertura</h4>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <div className="novelty-preview-body" aria-busy={state.status === "loading" || undefined}>{body}</div>
    </section>
  );
}
