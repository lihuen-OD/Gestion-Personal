import { Eye, Power } from "lucide-react";
import { Link } from "react-router-dom";
import { OverflowCell } from "../ui/OverflowCell";
import { TableShell } from "../ui/TableShell";
import type { NoveltyType } from "../../types/noveltyType.types";

function yes(value: boolean) { return value ? "Si" : "No"; }

export function NoveltyTypeTable({ items, canEdit, onToggleStatus }: { items: NoveltyType[]; canEdit: boolean; onToggleStatus: (item: NoveltyType) => void }) {
  return items.length ? <TableShell minWidth={1180}><table><thead><tr><th>Codigo</th><th>Novedad</th><th>Origen</th><th>Tipo</th><th>Comportamiento horas</th><th>Exporta</th><th>Finnegans</th><th>Doc.</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>
    <td><b>{item.code}</b></td>
    <td><b>{item.name}</b><span className="table-sub">{item.description}</span></td>
    <td><span className="badge neutral">{item.origin || "INTERNA"}</span></td>
    <td>{item.kind}</td>
    <td><OverflowCell value={`${item.rules.timeImpact || "NO_AFECTA_HORAS"}${item.rules.blocksTimeEntry ? "\nBloquea carga diaria" : ""}`} /></td>
    <td>{yes(item.rules.exportsToFinnegans)}</td>
    <td>{item.finnegansLinks.length ? <OverflowCell value={item.finnegansLinks.map((link) => link.code).join(", ")} /> : "-"}</td>
    <td>{yes(item.rules.requiresDocumentation)}</td>
    <td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td>
    <td><div className="table-actions"><Link className="table-link table-icon-action" title="Ver detalle" aria-label="Ver detalle" to={`/configuracion/tipos-novedades/${item.id}`}><Eye size={14} /><span>Ver detalle</span></Link>{canEdit && <button className="table-icon-action" title="Activar/Inactivar" aria-label="Activar/Inactivar" onClick={() => onToggleStatus(item)}><Power size={14} /><span>Activar/Inactivar</span></button>}</div></td>
  </tr>)}</tbody></table></TableShell> : <div className="empty">No hay tipos de novedades para los filtros aplicados.</div>;
}
