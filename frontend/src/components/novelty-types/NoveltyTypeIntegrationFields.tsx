import type { NoveltyType } from "../../types/noveltyType.types";
import { issueFor, type NoveltyTypeIssue } from "../../utils/noveltyTypeCoverage";
import { finnegansValueUnitDescriptions, finnegansValueUnitLabels, finnegansValueUnits, TextAreaField } from "./NoveltyTypeFields";

// Etapa 7: sección "Integración y otras opciones" (Finnegans + observaciones
// internas). La lógica de Finnegans no cambia en esta etapa (es la etapa 9).
export function NoveltyTypeIntegrationFields({ item, setItem, issues, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; issues?: NoveltyTypeIssue[]; disabled?: boolean }) {
  const linkError = issueFor(issues, "finnegansLink");
  const unitError = issueFor(issues, "finnegansValueUnit");
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
        <label>Código Finnegans *<input disabled={disabled} spellCheck={false} value={item.finnegansCode || ""} onChange={(event) => setItem({ ...item, finnegansCode: event.target.value })} /></label>
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
        </label>
        {item.rules.finnegansValueUnit ? <small className="field-hint finnegans-unit-hint">{finnegansValueUnitDescriptions[item.rules.finnegansValueUnit]}</small> : null}
        {linkError ? <small className="field-error form-wide" role="alert">{linkError}</small> : null}
        <label className="mini-check">
          <input type="checkbox" disabled={disabled} checked={item.rules.finnegansRequiresValidity} onChange={(event) => setItem({ ...item, rules: { ...item.rules, finnegansRequiresValidity: event.target.checked } })} />
          <span>Requiere vigencia (fecha desde y fecha hasta obligatorias para exportar)</span>
        </label>
      </div>
    ) : null}
    {unitError ? <p className="field-error" role="alert">{unitError}</p> : null}

    {item.coverage.mode === "MANUAL_MINUTES" ? null : (
      <div className="novelty-legacy-hours">
        <span className="novelty-legacy-hours-title">Registro administrativo de horas</span>
        <label className="catalog-rule-card">
          <input type="checkbox" disabled={disabled} checked={item.rules.allowsHours} onChange={() => setItem({ ...item, rules: { ...item.rules, allowsHours: !item.rules.allowsHours } })} />
          <span>
            <b>Pedir una cantidad de horas al cargar (sólo como dato)</b>
            <small>Capacidad anterior al cálculo de cobertura: anota una cantidad en la novedad y se usa en la exportación a Finnegans en horas. No es tiempo cubierto, no suma al total ni cambia el cálculo. Para que la novedad cubra horas, configurá «Tiempo que cubre».</small>
          </span>
        </label>
      </div>
    )}

    <div className="novelty-internal-notes">
      <TextAreaField label="Observaciones internas" value={item.notes || ""} disabled={disabled} hint="Sólo visibles en esta configuración." onChange={(notes) => setItem({ ...item, notes })} />
    </div>
  </div>;
}
