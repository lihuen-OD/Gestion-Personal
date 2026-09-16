import type { FinnegansNoveltyLink, NoveltyType } from "../../types/noveltyType.types";
import { findPrincipalLinkIndex, finnegansValueUnitDescriptions, finnegansValueUnitLabels, finnegansValueUnits, newPrincipalLink } from "./NoveltyTypeFields";

export function NoveltyTypeFinnegansTab({ item, setItem, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; disabled?: boolean }) {
  const principalIndex = findPrincipalLinkIndex(item.finnegansLinks);
  const principal = principalIndex >= 0 ? item.finnegansLinks[principalIndex] : undefined;
  const secondaryCount = item.finnegansLinks.length - (principalIndex >= 0 ? 1 : 0);

  const updatePrincipal = (patch: Partial<FinnegansNoveltyLink>) => {
    if (principalIndex >= 0) {
      const links = item.finnegansLinks.map((link, index) => (index === principalIndex ? { ...link, ...patch } : link));
      setItem({ ...item, finnegansLinks: links });
      return;
    }
    setItem({ ...item, finnegansLinks: [{ ...newPrincipalLink(item.name), ...patch }] });
  };

  const toggleExports = (exportsToFinnegans: boolean) => {
    const links = exportsToFinnegans && !item.finnegansLinks.length ? [newPrincipalLink(item.name)] : item.finnegansLinks;
    setItem({ ...item, finnegansLinks: links, rules: { ...item.rules, exportsToFinnegans } });
  };

  const setRequiresValidity = (finnegansRequiresValidity: boolean) => {
    // Etapa 15L.2B, 15L.1 §14: el exportador hace un OR entre
    // NoveltyType.hasValidity (ya sincronizado con finnegansRequiresValidity
    // por el backend) y FinnegansNoveltyLink.hasValidity -- sin esto,
    // apagar "Requiere vigencia" acá no tendría efecto real si el vínculo
    // ya tenía hasValidity=true de antes.
    const links = principalIndex >= 0
      ? item.finnegansLinks.map((link, index) => (index === principalIndex ? { ...link, hasValidity: finnegansRequiresValidity } : link))
      : item.finnegansLinks;
    setItem({ ...item, finnegansLinks: links, rules: { ...item.rules, finnegansRequiresValidity } });
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
      <>
        {secondaryCount > 0 ? (
          <div className="info-note compact">
            Este tipo tiene configuraciones Finnegans adicionales creadas anteriormente. En esta pantalla se utiliza la configuración principal.
          </div>
        ) : null}

        <div className="form-grid">
          <label>Código Finnegans *<input disabled={disabled} value={principal?.code || ""} onChange={(event) => updatePrincipal({ code: event.target.value })} /></label>
          <label>Nombre Finnegans *<input disabled={disabled} value={principal?.name || ""} onChange={(event) => updatePrincipal({ name: event.target.value })} /></label>
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
            <input type="checkbox" disabled={disabled} checked={item.rules.finnegansRequiresValidity} onChange={(event) => setRequiresValidity(event.target.checked)} />
            <span>Requiere vigencia (fecha desde y fecha hasta obligatorias para exportar)</span>
          </label>
        </div>
      </>
    ) : null}
  </div>;
}
