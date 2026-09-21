// Checkbox + etiqueta con estado "Activo"/"Inactivo", compartido entre las
// pantallas de catálogo que definen reglas booleanas (Categorías documentales,
// Parámetros de auditoría) — antes duplicado idéntico en cada una.
export function BoolCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="catalog-rule-card">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span><b>{label}</b><small>{checked ? "Activo" : "Inactivo"}</small></span>
    </label>
  );
}
