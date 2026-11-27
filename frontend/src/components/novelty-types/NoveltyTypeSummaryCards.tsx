import type { NoveltyType } from "../../types/noveltyType.types";
import { StatCard } from "../ui/StatCard";

// Etapa 15L.2B (docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md,
// punto 21): sólo KPIs útiles -- se quitan "Bloquean horas" (usaba el
// legacy blocksTimeEntry con un detail engañoso, "Dejan el día en 0 hs",
// que ya no es cierto desde la Etapa 15G.1) y "Requieren documentación"
// (detalle de configuración, no un indicador de catálogo relevante acá).
export function NoveltyTypeSummaryCards({ items }: { items: NoveltyType[] }) {
  const active = items.filter((item) => item.status === "ACTIVO").length;
  const withFinnegans = items.filter((item) => item.rules.exportsToFinnegans).length;
  const requiresDocumentation = items.filter((item) => item.rules.requiresDocumentation).length;
  return <div className="stat-grid novelty-type-summary">
    <StatCard label="Total de tipos" value={items.length} detail="Catálogo completo" />
    <StatCard label="Activos" value={active} detail="Disponibles para cargar" />
    <StatCard label="Exportables a Finnegans" value={withFinnegans} detail="Con exportación habilitada" />
    <StatCard label="Requieren documentación" value={requiresDocumentation} detail="Solicitan respaldo al cargar" />
  </div>;
}
