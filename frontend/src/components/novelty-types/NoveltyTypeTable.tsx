import { Eye, Power } from "lucide-react";
import { Link } from "react-router-dom";
import { TableShell } from "../ui/TableShell";
import { SortableHeader } from "../ui/SortableHeader";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import type { NoveltyType } from "../../types/noveltyType.types";
import { noveltyKindLabels } from "./NoveltyTypeFields";
import { activoInactivoLabel, statusTone } from "../../utils/status";
import { useSort, type SortAccessors } from "../../utils/sort";

function yes(value: boolean) { return value ? "Si" : "No"; }

const sortAccessors: SortAccessors<NoveltyType, "code" | "name" | "kind" | "status"> = {
  code: (item) => item.code,
  name: (item) => item.name,
  kind: (item) => noveltyKindLabels[item.kind],
  status: (item) => activoInactivoLabel(item.status),
};

// Etapa 15L.2B (docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md,
// punto 20): columnas realmente útiles -- se quita "Origen" (legacy,
// redundante con Finnegans, ver 15L.1 §9) y "Doc."/"Comportamiento horas"
// (detalle de configuración, no de listado; se ve en el detalle del tipo).
export function NoveltyTypeTable({ items, canEdit, onToggleStatus }: { items: NoveltyType[]; canEdit: boolean; onToggleStatus: (item: NoveltyType) => void }) {
  const { sorted, sort, toggleSort } = useSort(items, sortAccessors);
  return items.length ? <TableShell minWidth={960}><table><thead><tr><SortableHeader label="Codigo" sortKey="code" sort={sort} onSort={toggleSort} /><SortableHeader label="Novedad" sortKey="name" sort={sort} onSort={toggleSort} /><SortableHeader label="Categoria" sortKey="kind" sort={sort} onSort={toggleSort} /><SortableHeader label="Estado" sortKey="status" sort={sort} onSort={toggleSort} /><th>Finnegans</th><th>Aprobacion</th><th>Acciones</th></tr></thead><tbody>{sorted.map((item) => {
    const statusLabel = activoInactivoLabel(item.status);
    return <tr key={item.id}>
    <td><b>{item.code}</b></td>
    <td><b>{item.name}</b><span className="table-sub">{item.description}</span></td>
    <td>{noveltyKindLabels[item.kind]}</td>
    <td><Badge tone={statusTone(statusLabel)}>{statusLabel}</Badge></td>
    <td>{yes(item.rules.exportsToFinnegans)}</td>
    <td>{yes(item.rules.requiresApproval)}</td>
    <td><div className="table-actions"><Link className="table-icon-action" title="Ver detalle" aria-label="Ver detalle" to={`/configuracion/tipos-novedades/${item.id}`}><Eye size={14} /><span>Ver detalle</span></Link>{canEdit && <button className="table-icon-action" title="Activar/Inactivar" aria-label="Activar/Inactivar" onClick={() => onToggleStatus(item)}><Power size={14} /><span>Activar/Inactivar</span></button>}</div></td>
  </tr>;
  })}</tbody></table></TableShell> : <EmptyState text="No hay tipos de novedades para los filtros aplicados." />;
}
