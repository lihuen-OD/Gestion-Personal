export function Field({ label, value, set, type = "text", disabled }: { label: string; value: string; set: (value: string) => void; type?: string; disabled?: boolean }) {
  return <label>{label}<input type={type} value={value} disabled={disabled} onChange={(event) => set(event.target.value)} /></label>;
}

export function Select({ label, value, set, options, disabled }: { label: string; value: string; set: (value: string) => void; options: string[]; disabled?: boolean }) {
  return <label>{label}<select value={value} disabled={disabled} onChange={(event) => set(event.target.value)}><option value="">Seleccionar</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}
