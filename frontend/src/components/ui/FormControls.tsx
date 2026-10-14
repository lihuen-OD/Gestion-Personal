import type { InputHTMLAttributes, ReactNode } from "react";

type FieldProps = {
  label: string;
  value: string;
  set: (value: string) => void;
  type?: string;
  disabled?: boolean;
  spellCheck?: InputHTMLAttributes<HTMLInputElement>["spellCheck"];
};

export function Field({ label, value, set, type = "text", disabled, spellCheck = false }: FieldProps) {
  return <label>{label}<input type={type} value={value} disabled={disabled} spellCheck={spellCheck} lang={spellCheck ? "es-AR" : undefined} onChange={(event) => set(event.target.value)} /></label>;
}

export function FormGrid({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`form-grid ${className}`.trim()}>{children}</div>;
}

export function FormActions({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`form-actions ${className}`.trim()}>{children}</div>;
}

export function Select({ label, value, set, options, disabled }: { label: string; value: string; set: (value: string) => void; options: string[]; disabled?: boolean }) {
  return <label>{label}<select value={value} disabled={disabled} onChange={(event) => set(event.target.value)}><option value="">Seleccionar</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}
