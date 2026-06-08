import type { Position } from "../../types/position.types";

export function PuestoHistoryTab({ position }: { position: Position }) {
  const rows = [...(position.history || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!rows.length) return <div className="empty"><span>Todavia no hay historial para este puesto.</span></div>;
  return <div className="timeline">{rows.map((row) => <div key={row.id}><i /><b>{row.action}</b><span>{new Date(row.createdAt).toLocaleString("es-AR")} · {row.createdByUserName}</span><p>{row.description}{row.oldValue || row.newValue ? ` · ${row.oldValue || "-"} -> ${row.newValue || "-"}` : ""}</p></div>)}</div>;
}
