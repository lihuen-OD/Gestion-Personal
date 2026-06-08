import { Eye, Power } from "lucide-react";
import { Link } from "react-router-dom";
import type { NoveltyType } from "../../types/noveltyType.types";

function yes(value: boolean) { return value ? "Sí" : "No"; }

export function NoveltyTypeTable({ items, canEdit, onToggleStatus }: { items: NoveltyType[]; canEdit: boolean; onToggleStatus: (item: NoveltyType) => void }) {
  return items.length ? <table><thead><tr><th>Código</th><th>Novedad interna</th><th>Tipo</th><th>Finnegans</th><th>Asistencia</th><th>Liquidación</th><th>Aprobación</th><th>Doc.</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>
    <td><b>{item.code}</b></td>
    <td><b>{item.name}</b><span className="table-sub">{item.description}</span></td>
    <td>{item.kind}</td>
    <td>{item.finnegansLinks.length ? item.finnegansLinks.map((link) => link.code).join(", ") : "-"}</td>
    <td>{yes(item.rules.affectsAttendance)}</td>
    <td>{yes(item.rules.affectsSettlement)}</td>
    <td>{yes(item.rules.requiresApproval)}</td>
    <td>{yes(item.rules.requiresDocumentation)}</td>
    <td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td>
    <td><div className="table-actions"><Link className="table-link" to={`/configuracion/tipos-novedades/${item.id}`}><Eye size={15} /> Ver</Link>{canEdit && <button className="icon-button" title="Activar/Inactivar" onClick={() => onToggleStatus(item)}><Power size={16} /></button>}</div></td>
  </tr>)}</tbody></table> : <div className="empty">No hay tipos de novedades para los filtros aplicados.</div>;
}
