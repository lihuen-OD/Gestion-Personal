import { Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "../ui/Badge";
import { OverflowCell } from "../ui/OverflowCell";
import { SortableHeader } from "../ui/SortableHeader";
import type { OrgArea, OrgBusinessUnit, OrgCostCenter, OrgEstablishment, OrgSector, OrgStructureCatalog, OrgStructureEntity, OrgStructureEntityType, OrgStructureStatus } from "../../types/orgStructure.types";
import { activoInactivoLabel } from "../../utils/status";
import { useSort, type SortAccessors } from "../../utils/sort";
import { isPendingReload } from "./orgStructureEntities";
import { costCenterLinkCounts, PENDING_RELOAD_LABEL } from "./orgStructureTree";

type ColumnKey = "code" | "name" | "primary" | "secondary" | "status";
interface RelationColumn { label: string; value: (item: OrgStructureEntity) => string }

const nameIn = (items: Array<{ id: string; name: string }>, id: string | undefined) => items.find((item) => item.id === id)?.name ?? "";
const count = (value: number) => (value ? String(value) : "");

// Dos columnas de relación por tipo: el padre del modelo nuevo y un dato de
// contexto. Un registro de la estructura anterior no tiene padre nuevo: la
// celda queda vacía y el nombre lleva la marca "Pendiente de recarga".
function relationColumns(type: OrgStructureEntityType, catalog: OrgStructureCatalog): [RelationColumn, RelationColumn] {
  const costCenters = costCenterLinkCounts(catalog);
  if (type === "COMPANY") return [
    { label: "Unidades de negocio", value: (item) => count(catalog.businessUnits.filter((unit) => unit.companyId === item.id).length) },
    { label: "Centros de costo", value: (item) => count(costCenters.get(item.id) ?? 0) },
  ];
  if (type === "BUSINESS_UNIT") return [
    { label: "Empresa", value: (item) => nameIn(catalog.companies, (item as OrgBusinessUnit).companyId) },
    { label: "Sectores", value: (item) => count(catalog.sectors.filter((sector) => sector.businessUnitId === item.id).length) },
  ];
  if (type === "SECTOR") return [
    { label: "Unidad de negocio", value: (item) => nameIn(catalog.businessUnits, (item as OrgSector).businessUnitId) },
    { label: "Áreas", value: (item) => count(catalog.areas.filter((area) => area.sectorId === item.id).length) },
  ];
  if (type === "AREA") return [
    { label: "Sector", value: (item) => nameIn(catalog.sectors, (item as OrgArea).sectorId) },
    { label: "Unidad de negocio", value: (item) => nameIn(catalog.businessUnits, catalog.sectors.find((sector) => sector.id === (item as OrgArea).sectorId)?.businessUnitId) },
  ];
  if (type === "ZONE") return [
    { label: "Establecimientos", value: (item) => count(catalog.establishments.filter((establishment) => establishment.zoneId === item.id).length) },
    { label: "Establecimientos activos", value: (item) => count(catalog.establishments.filter((establishment) => establishment.zoneId === item.id && establishment.status === "ACTIVO").length) },
  ];
  if (type === "ESTABLISHMENT") return [
    { label: "Zona", value: (item) => nameIn(catalog.zones, (item as OrgEstablishment).zoneId) },
    { label: "Localidad", value: (item) => [(item as OrgEstablishment).locality, (item as OrgEstablishment).province].filter(Boolean).join(", ") },
  ];
  const links = (item: OrgCostCenter) => item.companyIds.length + item.businessUnitIds.length + item.sectorIds.length + item.areaIds.length + item.establishmentIds.length;
  return [
    { label: "Empresas", value: (item) => (item as OrgCostCenter).companyIds.map((id) => nameIn(catalog.companies, id)).filter(Boolean).join(", ") },
    { label: "Vínculos", value: (item) => count(links(item as OrgCostCenter)) },
  ];
}

function StatusBadge({ status }: { status: OrgStructureStatus }) {
  return <Badge tone={status === "ACTIVO" ? "success" : "neutral"}>{activoInactivoLabel(status)}</Badge>;
}

// Montado con `key={type}`: el orden arranca sin interacción en cada pestaña.
export function OrgStructureTable({ type, catalog, items, onEdit, onDelete }: { type: OrgStructureEntityType; catalog: OrgStructureCatalog; items: readonly OrgStructureEntity[]; onEdit: (item: OrgStructureEntity) => void; onDelete: (item: OrgStructureEntity) => void }) {
  const [primary, secondary] = useMemo(() => relationColumns(type, catalog), [type, catalog]);
  const accessors = useMemo<SortAccessors<OrgStructureEntity, ColumnKey>>(() => ({
    code: (item) => item.code,
    name: (item) => item.name,
    primary: (item) => primary.value(item) || null,
    secondary: (item) => secondary.value(item) || null,
    status: (item) => activoInactivoLabel(item.status),
  }), [primary, secondary]);
  const { sorted, sort, toggleSort } = useSort(items, accessors);
  const columns: Array<{ key: ColumnKey; label: string }> = [
    { key: "code", label: "Código" },
    { key: "name", label: "Nombre" },
    { key: "primary", label: primary.label },
    { key: "secondary", label: secondary.label },
    { key: "status", label: "Estado" },
  ];
  return <table>
    <thead><tr>
      {columns.map((column) => <SortableHeader key={column.key} label={column.label} sortKey={column.key} sort={sort} onSort={toggleSort} />)}
      <th>Acción</th>
    </tr></thead>
    <tbody>{sorted.map((item) => <tr key={item.id}>
      <td><b>{item.code}</b></td>
      <td><OverflowCell value={item.name} />{isPendingReload(item) ? <span className="table-sub"><Badge tone="warning">{PENDING_RELOAD_LABEL}</Badge></span> : null}</td>
      <td><OverflowCell value={primary.value(item) || "-"} /></td>
      <td><OverflowCell value={secondary.value(item) || "-"} /></td>
      <td><StatusBadge status={item.status} /></td>
      <td><div className="table-actions">
        <button className="table-icon-action" title="Editar" aria-label={`Editar ${item.name}`} onClick={() => onEdit(item)}><Pencil size={14}/><span>Editar</span></button>
        <button className="table-icon-action danger-link" title="Eliminar" aria-label={`Eliminar ${item.name}`} onClick={() => onDelete(item)}><Trash2 size={14}/><span>Eliminar</span></button>
      </div></td>
    </tr>)}</tbody>
  </table>;
}
