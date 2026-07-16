import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { workforceApiService, type SystemNotification } from "../services/api/workforceApiService";

export function NotificationsPage() {
  const [items, setItems] = useState<SystemNotification[]>([]);
  const [error, setError] = useState("");
  const load = () => workforceApiService.notifications().then(setItems).catch(() => setError("No se pudo cargar el historial de notificaciones."));
  useEffect(() => { void load(); }, []);

  const markRead = async (item: SystemNotification) => {
    if (item.status === "LEIDA") return;
    await workforceApiService.readNotification(item.id);
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "LEIDA" } : row));
  };

  return <>
    <PageHeader eyebrow="SEGUIMIENTO" title="Notificaciones" description="Alertas de fichada, novedades, cierres mensuales y solicitudes que requieren atención." />
    {error ? <div className="form-error">{error}</div> : null}
    <Section title="Historial" subtitle={`${items.filter((item) => item.status === "NO_LEIDA").length} sin leer · ${items.length} notificaciones`}>
      <div className="notification-list">
        {items.map((item) => <article className={`notification-row ${item.status === "NO_LEIDA" ? "unread" : ""}`} key={item.id}>
          <div className="notification-icon"><Bell size={17}/></div><div><b>{item.title}</b><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString("es-AR")}</small></div>
          <div className="notification-actions">{item.link ? <Link className="table-link" to={item.link} onClick={() => void markRead(item)}>Ver detalle</Link> : null}{item.status === "NO_LEIDA" ? <button className="table-link" onClick={() => void markRead(item)}><Check size={15}/> Marcar leída</button> : <span className="badge neutral">Leída</span>}</div>
        </article>)}
        {!items.length && !error ? <div className="empty">No hay notificaciones todavía.</div> : null}
      </div>
    </Section>
  </>;
}
