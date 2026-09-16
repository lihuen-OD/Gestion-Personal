import type { NoveltyType } from "../../types/noveltyType.types";
import { finnegansValueUnitDescriptions, finnegansValueUnitLabels, finnegansValueUnits } from "./NoveltyTypeFields";

export function NoveltyTypeFinnegansTab({ item, setItem, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; disabled?: boolean }) {
  const toggleExports = (exportsToFinnegans: boolean) => {
    setItem({ ...item, rules: { ...item.rules, exportsToFinnegans } });
  };

  return <div className="catalog-finnegans">
    <label className="catalog-rule-card">
      <input type="checkbox" disabled={disabled} checked={item.rules.exportsToFinnegans} onChange={(event) => toggleExports(event.target.checked)} />
      <span>
        <b>Exportar esta novedad a Finnegans</b>
        <small>Se incluye en la vista mensual de exportación cuando la novedad está aprobada. Si se desactiva, la configuración de abajo se conserva para poder reactivarla más adelante.</small>
      </span>
    </label>

    {item.rules.exportsToFinnegans ? (
      <div className="form-grid">
        <label>Código Finnegans *<input disabled={disabled} value={item.finnegansCode || ""} onChange={(event) => setItem({ ...item, finnegansCode: event.target.value })} /></label>
        <label>Nombre Finnegans *<input disabled={disabled} value={item.finnegansName || ""} onChange={(event) => setItem({ ...item, finnegansName: event.target.value })} /></label>
        <label>
          Unidad de Valor 1 *
          <select
            disabled={disabled}
            value={item.rules.finnegansValueUnit || ""}
            onChange={(event) => setItem({ ...item, rules: { ...item.rules, finnegansValueUnit: (event.target.value || null) as NoveltyType["rules"]["finnegansValueUnit"] } })}
          >
            <option value="">Seleccioná una unidad</option>
            {finnegansValueUnits.map((unit) => <option key={unit} value={unit}>{finnegansValueUnitLabels[unit]}</option>)}
          </select>
          {item.rules.finnegansValueUnit ? <small>{finnegansValueUnitDescriptions[item.rules.finnegansValueUnit]}</small> : null}
        </label>
        <label className="mini-check">
          <input type="checkbox" disabled={disabled} checked={item.rules.finnegansRequiresValidity} onChange={(event) => setItem({ ...item, rules: { ...item.rules, finnegansRequiresValidity: event.target.checked } })} />
          <span>Requiere vigencia (fecha desde y fecha hasta obligatorias para exportar)</span>
        </label>
      </div>
    ) : null}
  </div>;
}
