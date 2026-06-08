import type { NoveltyType } from "../../types/noveltyType.types";

export function NoveltyTypeHistoryTab({ item }: { item: NoveltyType }) {
  return item.history.length ? <div className="timeline">{item.history.map((entry) => <div key={entry.id}><i /><b>{entry.action}</b><span>{new Date(entry.createdAt).toLocaleString("es-AR")} · {entry.createdByUserName}</span><p>{entry.description}</p></div>)}</div> : <div className="empty">Todavía no hay historial registrado para este tipo de novedad.</div>;
}
