import type { NoveltyType } from "../../types/noveltyType.types";

export function NoveltyTypeSummaryCards({ items }: { items: NoveltyType[] }) {
  const active = items.filter((item) => item.status === "ACTIVO").length;
  const withFinnegans = items.filter((item) => item.finnegansLinks.some((link) => link.status === "ACTIVO")).length;
  const settlement = items.filter((item) => item.rules.affectsSettlement).length;
  const documentation = items.filter((item) => item.rules.requiresDocumentation).length;
  return <div className="stat-grid novelty-type-summary">
    <div className="stat-card"><div><small>Tipos activos</small><strong>{active}</strong><span>Disponibles para cargar novedades</span></div></div>
    <div className="stat-card"><div><small>Con Finnegans</small><strong>{withFinnegans}</strong><span>Con equivalencia externa activa</span></div></div>
    <div className="stat-card"><div><small>Afectan liquidación</small><strong>{settlement}</strong><span>Impactan en conceptos liquidables</span></div></div>
    <div className="stat-card"><div><small>Requieren documentación</small><strong>{documentation}</strong><span>Generan control documental</span></div></div>
  </div>;
}
