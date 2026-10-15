import { Archive, Building2, Factory, LandPlot, LayoutGrid, Layers, Map as MapIcon, MapPin, Users, Wallet, type LucideIcon } from "lucide-react";
import type { OrgTreeNodeType } from "./orgStructureTree";

const icons: Record<OrgTreeNodeType, LucideIcon> = {
  COMPANY: Building2,
  BUSINESS_UNIT: Layers,
  SECTOR: Users,
  AREA: LayoutGrid,
  PROVINCE: MapIcon,
  ZONE: MapPin,
  ESTABLISHMENT: Factory,
  ESTABLISHMENT_UNIT: LandPlot,
  COST_CENTER: Wallet,
  GROUP: Archive,
};

// Chip de color por tipo de nodo (paleta en .org-node-icon.type-*, styles.css).
export function OrgNodeIcon({ type, size = 14, large = false }: { type: OrgTreeNodeType; size?: number; large?: boolean }) {
  const Icon = icons[type];
  return (
    <span className={`org-node-icon type-${type.toLowerCase()}${large ? " large" : ""}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}
