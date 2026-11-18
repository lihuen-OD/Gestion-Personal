import { useId, type ReactNode } from "react";

export type ChoiceOption<T extends string> = { value: T; label: string; description?: string };

/**
 * Pregunta de opción única presentada como tarjetas (radio nativo, navegable
 * con flechas). Para preguntas de negocio con pocas opciones donde cada una
 * necesita una línea de explicación; para listas largas usar <select>.
 */
export function ChoiceGroup<T extends string>({
  legend,
  hint,
  options,
  value,
  onChange,
  disabled,
  error,
  columns = 2,
  children,
}: {
  legend: string;
  hint?: ReactNode;
  options: ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  error?: string;
  columns?: 1 | 2 | 3 | 4;
  children?: ReactNode;
}) {
  const name = useId();
  const errorId = `${name}-error`;
  return (
    <fieldset className={`choice-group${error ? " has-error" : ""}`} aria-describedby={error ? errorId : undefined} aria-invalid={error ? true : undefined}>
      <legend>{legend}</legend>
      {hint ? <p className="choice-group-hint">{hint}</p> : null}
      <div className={`choice-group-options columns-${columns}`}>
        {options.map((option) => (
          <label key={option.value} className={`choice-card${value === option.value ? " selected" : ""}`}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} />
            <span>
              <b>{option.label}</b>
              {option.description ? <small>{option.description}</small> : null}
            </span>
          </label>
        ))}
      </div>
      {children}
      {error ? <p id={errorId} className="field-error" role="alert">{error}</p> : null}
    </fieldset>
  );
}
