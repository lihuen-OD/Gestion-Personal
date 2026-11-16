import { useId, type ReactNode } from "react";
import type { NoveltyType } from "../../types/noveltyType.types";
import { DOCUMENT_FILE_ACCEPT } from "../../utils/documentFile";
import { formatDurationMinutes } from "../../utils/hours";
import { noveltyLoadLayout, noveltyTypeLoadSummary, type NoveltyLoadIssue, type NoveltyLoadIssueField, type NoveltyLoadValues } from "../../utils/noveltyLoad";
import { describedBy, FieldMessages } from "../ui/FieldMessages";

// Etapa 8 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §15): campos de una
// novedad según su Tipo. El Tipo decide; acá no se vuelve a preguntar
// cantidad fija, compatibilidad, suma ni multiplicadores.

function issueFor(issues: NoveltyLoadIssue[] | undefined, field: NoveltyLoadIssueField) {
  return issues?.find((issue) => issue.field === field)?.message;
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: (props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode }) {
  return <div className="field-stack">
    <label htmlFor={id}>{label}</label>
    {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy(id, { hint, error }) })}
    <FieldMessages id={id} hint={hint} error={error} />
  </div>;
}

export function NoveltyTypeLoadSummary({ type }: { type: NoveltyType }) {
  return <div className="novelty-type-load-summary">
    <b>{type.name}</b>
    <ul>{noveltyTypeLoadSummary(type).map((line) => <li key={line}>{line}</li>)}</ul>
  </div>;
}

export function NoveltyLoadFields({
  type,
  values,
  onChange,
  issues,
  isRrhh,
  disabled,
}: {
  type: NoveltyType;
  values: NoveltyLoadValues;
  onChange: (values: NoveltyLoadValues) => void;
  issues?: NoveltyLoadIssue[];
  isRrhh: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const layout = noveltyLoadLayout(type);
  const set = (patch: Partial<NoveltyLoadValues>) => onChange({ ...values, ...patch });

  return <div className="novelty-load-fields">
    <div className="novelty-load-dates">
        <Field id={`${id}-from`} label={layout.dateMode === "range" ? "Desde *" : "Fecha *"} error={issueFor(issues, "fromDate")}>
          {(props) => <input {...props} type="date" value={values.fromDate} disabled={disabled} onChange={(event) => set({ fromDate: event.target.value })} />}
        </Field>
        {layout.dateMode === "range" ? (
          <Field
            id={`${id}-to`}
            label={layout.toDateRequired ? "Hasta *" : "Hasta (opcional)"}
            hint={layout.toDateRequired ? undefined : "Si la dejás vacía, la novedad vale sólo para la fecha desde."}
            error={issueFor(issues, "toDate")}
          >
            {(props) => <input {...props} type="date" value={values.toDate} min={values.fromDate || undefined} disabled={disabled} onChange={(event) => set({ toDate: event.target.value })} />}
          </Field>
        ) : null}
    </div>

    {layout.quantity === "FIXED" && layout.fixedMinutes ? (
      <p className="novelty-load-quantity-note">Este tipo cubre {formatDurationMinutes(layout.fixedMinutes)} por día según su configuración.</p>
    ) : null}
    {layout.quantity === "EXPECTED" ? (
      <p className="novelty-load-quantity-note">Las horas se calcularán según la jornada que debía cumplir la persona.</p>
    ) : null}
    {layout.quantity === "MANUAL" ? (
      <Field id={`${id}-duration`} label="Duración *" hint="Formato HH:mm, por ejemplo 01:00 o 03:30. Vale para un solo día." error={issueFor(issues, "duration")}>
        {(props) => <input {...props} className="novelty-load-duration" inputMode="numeric" placeholder="HH:mm" maxLength={5} value={values.duration} disabled={disabled} onChange={(event) => set({ duration: event.target.value })} />}
      </Field>
    ) : null}
    {layout.legacyHours ? (
      <Field id={`${id}-legacy`} label="Cantidad de horas informativa" hint="Este valor es sólo un dato adicional. No cubre horas ni suma al total." error={issueFor(issues, "legacyHours")}>
        {(props) => <input {...props} className="novelty-load-duration" type="number" min="0" step="0.25" inputMode="decimal" value={values.legacyHours} disabled={disabled} onChange={(event) => set({ legacyHours: event.target.value })} />}
      </Field>
    ) : null}

    <Field id={`${id}-observation`} label={layout.observationRequired ? "Observación *" : "Observación"} error={issueFor(issues, "observation")}>
      {(props) => <textarea {...props} spellCheck lang="es-AR" value={values.observation} disabled={disabled} placeholder="Detalle de la novedad" onChange={(event) => set({ observation: event.target.value })} />}
    </Field>

    {layout.documentationRequired ? (
      <div className="document-upload-card novelty-load-document">
        <Field id={`${id}-file`} label="Documentación *" hint="Obligatoria para este tipo. Imagen, PDF, Word o Excel, hasta 10 MB." error={issueFor(issues, "file")}>
          {(props) => <input {...props} type="file" accept={DOCUMENT_FILE_ACCEPT} disabled={disabled} onChange={(event) => set({ file: event.target.files?.[0] || null })} />}
        </Field>
        {values.file ? <small>Archivo seleccionado: {values.file.name}</small> : null}
      </div>
    ) : null}

    {layout.requiresApproval ? (
      <p className="info-note compact">
        {isRrhh
          ? "Este tipo requiere aprobación. Como RRHH, la novedad queda aprobada al guardarla."
          : "Esta novedad quedará pendiente hasta ser aprobada. Mientras esté pendiente será visible, pero no sumará al total."}
      </p>
    ) : null}
  </div>;
}
