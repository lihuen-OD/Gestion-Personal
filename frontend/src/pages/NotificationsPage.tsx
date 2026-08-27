import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FilterPanel } from "../components/ui/FilterPanel";
import { workforceApiService, type SystemNotification, type SystemNotificationListMeta } from "../services/api/workforceApiService";

const PAGE_SIZE = 20;
type StatusFilter = "" | "NO_LEIDA" | "LEIDA";

const emptyMeta: SystemNotificationListMeta = { total: 0, page: 1, pageSize: PAGE_SIZE, hasMore: false };

export function NotificationsPage() {
  const [items, setItems] = useState<SystemNotification[]>([]);
  const [meta, setMeta] = useState<SystemNotificationListMeta>(emptyMeta);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let mounted = true;
    // Etapa 9I: sólo mostrar el skeleton de página completa cuando todavía no
    // hay notificaciones en pantalla — cambiar el filtro con la lista ya
    // poblada no debe blanquearla (mismo patrón ya usado en EmployeesPage/
    // NoveltiesPage).
    if (!items.length) setStatus("loading");
    setError("");
    workforceApiService
      .notifications({ page: 1, take: PAGE_SIZE, status: statusFilter || undefined })
      .then((result) => {
        if (!mounted) return;
        setItems(result.items);
        setMeta(result.meta);
        setStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setError("No se pudieron cargar las notificaciones.");
        setStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [statusFilter, refresh]);

  const loadMore = async () => {
    if (!meta.hasMore || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const result = await workforceApiService.notifications({ page: meta.page + 1, take: PAGE_SIZE, status: statusFilter || undefined });
      setItems((current) => [...current, ...result.items]);
      setMeta(result.meta);
    } catch {
      setError("No se pudieron cargar las notificaciones.");
    } finally {
      setLoadingMore(false);
    }
  };

  const markRead = async (item: SystemNotification) => {
    if (item.status === "LEIDA") return;
    try {
      await workforceApiService.readNotification(item.id);
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, status: "LEIDA" } : row)));
      window.dispatchEvent(new Event("app:notifications-changed"));
    } catch {
      setError("No se pudo marcar la notificación como leída.");
    }
  };

  const subtitle = status === "loading"
    ? "Consultando notificaciones..."
    : statusFilter === "NO_LEIDA" ? `${meta.total} sin leer`
    : statusFilter === "LEIDA" ? `${meta.total} leídas`
    : `${meta.total} notificaciones`;

  const emptyText = statusFilter === "NO_LEIDA" ? "No tenés notificaciones sin leer." : "No hay notificaciones todavía.";

  return <>
    <PageHeader eyebrow="SEGUIMIENTO" title="Notificaciones" description="Alertas de fichada, novedades, cierres mensuales y solicitudes que requieren atención." />
    <Section title="Historial" subtitle={subtitle}>
      <FilterPanel title="Filtros" onClear={() => setStatusFilter("")}>
        <label>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
          <option value="">Todas</option>
          <option value="NO_LEIDA">No leídas</option>
          <option value="LEIDA">Leídas</option>
        </select></label>
      </FilterPanel>
      {error && status !== "error" ? <div className="form-error">{error}</div> : null}
      <div className="notification-list">
        {status === "loading" ? <LoadingState text="Cargando notificaciones..." /> : null}
        {status === "error" ? <ErrorState message={error} onRetry={() => setRefresh((value) => value + 1)} /> : null}
        {status === "success" ? items.map((item) => <article className={`notification-row ${item.status === "NO_LEIDA" ? "unread" : ""}`} key={item.id}>
          <div className="notification-icon"><Bell size={17}/></div><div><b>{item.title}</b>{item.employee ? <span className="notification-person">{item.employee.lastName}, {item.employee.firstName} · Legajo {item.employee.legajo}</span> : null}<p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString("es-AR")}</small></div>
          <div className="notification-actions">{item.link ? <Link className="table-link" to={item.link} onClick={() => void markRead(item)}>Ver detalle</Link> : null}{item.status === "NO_LEIDA" ? <button className="table-link" onClick={() => void markRead(item)}><Check size={15}/> Marcar leída</button> : <Badge tone="neutral">Leída</Badge>}</div>
        </article>) : null}
        {status === "success" && !items.length ? <div className="empty">{emptyText}</div> : null}
      </div>
      {status === "success" && meta.hasMore ? <div className="attendance-load-more"><Button variant="subtle" onClick={() => void loadMore()} loading={loadingMore}>Cargar {Math.min(PAGE_SIZE, meta.total - items.length)} más</Button></div> : null}
    </Section>
  </>;
}
