import type { NoveltyType } from "../../types/noveltyType.types";

export function NoveltyTypeSummaryCards({ items }: { items: NoveltyType[] }) {
  const active = items.filter((item) => item.status === "ACTIVO").length;
  const withFinnegans = items.filter((item) => item.rules.exportsToFinnegans || item.finnegansLinks.some((link) => link.status === "ACTIVO")).length;
  const blocking = items.filter((item) => item.rules.blocksTimeEntry).length;
  const documentation = items.filter((item) => item.rules.requiresDocumentation).length;
  return <div className="stat-grid novelty-type-summary">
    <div className="stat-card"><div><small>Novedades activas</small><strong>{active}</strong><span>Disponibles para cargar</span></div></div>
    <div className="stat-card"><div><small>Exportan Finnegans</small><strong>{withFinnegans}</strong><span>Con codigo externo activo</span></div></div>
    <div className="stat-card"><div><small>Bloquean horas</small><strong>{blocking}</strong><span>Dejan el dia en 0 hs</span></div></div>
    <div className="stat-card"><div><small>Requieren documentacion</small><strong>{documentation}</strong><span>Generan control documental</span></div></div>
  </div>;
}
