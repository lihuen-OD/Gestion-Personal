export type FieldMessagesProps = { hint?: string; error?: string };

/** Ayuda y error fuera del <label> (no ensucian el nombre accesible) y vinculados con aria-describedby. */
export function FieldMessages({ id, hint, error }: FieldMessagesProps & { id: string }) {
  return <>
    {hint ? <small id={`${id}-hint`} className="field-hint">{hint}</small> : null}
    {error ? <small id={`${id}-error`} className="field-error" role="alert">{error}</small> : null}
  </>;
}

export function describedBy(id: string, { hint, error }: FieldMessagesProps) {
  return [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
}
