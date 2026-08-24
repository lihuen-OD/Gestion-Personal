import { Eye, Power } from "lucide-react";
import { Link } from "react-router-dom";
import { OverflowCell } from "../ui/OverflowCell";
import { TableShell } from "../ui/TableShell";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import type { NoveltyType } from "../../types/noveltyType.types";
import { noveltyTimeImpactLabel } from "./NoveltyTypeFields";

function yes(value: boolean) { return value ? "Si" : "No"; }

export function NoveltyTypeTable({ items, canEdit, onToggleStatus }: { items: NoveltyType[]; canEdit: boolean; onToggleStatus: (item: NoveltyType) => void }) {
  return items.length ? <TableShell minWidth={1180}><table><thead><tr><th>Codigo</th><th>Novedad</th><th>Origen</th><th>Tipo</th><th>Comportamiento horas</th><th>Exporta</th><th>Finnegans</th><th>Doc.</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>
    <td><b>{item.code}</b></td>
    <td><b>{item.name}</b><span className="table-sub">{item.description}</span></td>
    <td><Badge tone="neutral">{item.origin || "INTERNA"}</Badge></td>
    <td>{item.kind}</td>
    <td><OverflowCell value={`${noveltyTimeImpactLabel(item.rules.timeImpact)}${item.rules.blocksTimeEntry ? "\nBloquea carga diaria" : ""}`} /></td>
    <td>{yes(item.rules.exportsToFinnegans)}</td>
    <td>{item.finnegansLinks.length ? <OverflowCell value={item.finnegansLinks.map((link) => link.code).join(", ")} /> : "-"}</td>
    <td>{yes(item.rules.requiresDocumentation)}</td>
    <td><Badge tone={item.status === "ACTIVO" ? "success" : "neutral"}>{item.status}</Badge></td>
    <td><div className="table-actions"><Link className="table-icon-action" title="Ver detalle" aria-label="Ver detalle" to={`/configuracion/tipos-novedades/${item.id}`}><Eye size={14} /><span>Ver detalle</span></Link>{canEdit && <button className="table-icon-action" title="Activar/Inactivar" aria-label="Activar/Inactivar" onClick={() => onToggleStatus(item)}><Power size={14} /><span>Activar/Inactivar</span></button>}</div></td>
  </tr>)}</tbody></table></TableShell> : <EmptyState text="No hay tipos de novedades para los filtros aplicados." />;
}
