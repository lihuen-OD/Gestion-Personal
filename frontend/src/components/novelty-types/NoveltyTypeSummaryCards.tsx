import type { NoveltyType } from "../../types/noveltyType.types";
import { StatCard } from "../ui/StatCard";

export function NoveltyTypeSummaryCards({ items }: { items: NoveltyType[] }) {
  const active = items.filter((item) => item.status === "ACTIVO").length;
  const withFinnegans = items.filter((item) => item.rules.exportsToFinnegans || item.finnegansLinks.some((link) => link.status === "ACTIVO")).length;
  const blocking = items.filter((item) => item.rules.blocksTimeEntry).length;
  const documentation = items.filter((item) => item.rules.requiresDocumentation).length;
  return <div className="stat-grid novelty-type-summary">
    <StatCard label="Novedades activas" value={active} detail="Disponibles para cargar" />
    <StatCard label="Exportan Finnegans" value={withFinnegans} detail="Con codigo externo activo" />
    <StatCard label="Bloquean horas" value={blocking} detail="Dejan el dia en 0 hs" />
    <StatCard label="Requieren documentacion" value={documentation} detail="Generan control documental" />
  </div>;
}
