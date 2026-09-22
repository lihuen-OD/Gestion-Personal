import type { Position } from "../../types/position.types";
import { auditActionLabel } from "../../utils/auditLabels";
import { formatDateTime } from "../../utils/date";

export function PuestoHistoryTab({ position }: { position: Position }) {
  const rows = [...(position.history || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!rows.length) return <div className="empty"><span>Todavia no hay historial para este puesto.</span></div>;
  return <div className="timeline">{rows.map((row) => <div key={row.id}><i /><b>{auditActionLabel(row.action)}</b><span>{formatDateTime(row.createdAt)} · {row.createdByUserName}</span><p>{row.description}{row.oldValue || row.newValue ? ` · ${row.oldValue || "-"} -> ${row.newValue || "-"}` : ""}</p></div>)}</div>;
}
