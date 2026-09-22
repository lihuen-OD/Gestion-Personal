import { useEffect, useState } from "react";
import { Bell, Check, Eye, FilePlus2 } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FilterPanel } from "../components/ui/FilterPanel";
import { NOTIFICATIONS_POLL_INTERVAL_MS, workforceApiService, type SystemNotification, type SystemNotificationListMeta } from "../services/api/workforceApiService";
import { NoveltyFromContextModal } from "../components/novelties/NoveltyFromContextModal";
import { buildNoveltyPrefillFromNotification, type NoveltyPrefillContext } from "../utils/noveltyFromAlert";
import { TOAST_SUCCESS_MS } from "../utils/toast";
import { formatCalendarDate, formatDateTime } from "../utils/date";

const PAGE_SIZE = 20;
type StatusFilter = "" | "NO_LEIDA" | "LEIDA";

const emptyMeta: SystemNotificationListMeta = { total: 0, page: 1, pageSize: PAGE_SIZE, hasMore: false };

// Etapa 15M.19E: `createdAt` es cuándo se insertó la fila, no cuándo pasó el
// hecho de negocio — para una notificación recuperada por catch-up
// (15M.19A/B) días después, mostrar sólo `createdAt` la hace parecer que
// ocurrió "hoy". `eventDate` (nuevo en el DTO) trae la fecha real ya
// persistida en la entidad de origen. `AttendanceInactivityIncident.
// operationalDate` es `@db.Date` (calendario puro) — se formatea con
// `formatCalendarDate` (sin `new Date().toLocaleDateString()`, que corre la
// fecha un día para atrás en Argentina, mismo riesgo ya corregido en la
// Etapa 15M.20 para este mismo tipo de campo). `ShiftAlert.actualAt`/
// `WorkShift.startAt` son instantes reales — se formatean con fecha y hora.
function notificationEventDateLabel(item: SystemNotification): string | null {
  if (!item.eventDate) return null;
  if (item.entityType === "AttendanceInactivityIncident") return formatCalendarDate(item.eventDate);
  const date = new Date(item.eventDate);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateTime(date);
}

/**
 * Etapa 15M.19C: fusiona un refresco silencioso (siempre página 1, hasta
 * PAGE_SIZE notificaciones — las más recientes por createdAt desc) con lo
 * que ya está en pantalla, sin perder páginas cargadas con "Cargar más" ni
 * duplicar filas. Las filas frescas (nuevas o con campos actualizados) van
 * primero; lo que ya estaba cargado y no vino en esta página 1 fresca se
 * conserva después, en su orden relativo — nunca se descarta por el sólo
 * hecho de no reaparecer en una ventana de sólo 20 elementos.
 *
 * El estado "leída" es monótono (el producto no tiene "marcar como no
 * leída"): si el estado local de una fila ya avanzó a LEIDA, un refresco que
 * todavía no vio esa escritura (carrera de red entre el POST de lectura y un
 * poll en vuelo) nunca la revierte.
 *
 * Etapa 15M.19D (docs/decisions/NOTIFICATIONS_END_TO_END_ACCEPTANCE_15M19D.md
 * §26): esta conservación de "lo que no reapareció" sólo es válida para un
 * filtro cuya pertenencia es monótona no decreciente — "" (Todas) y "LEIDA"
 * nunca pierden una fila que ya matcheaba (una vez leída, nunca vuelve a
 * NO_LEIDA). Bajo el filtro "NO_LEIDA" la pertenencia SÍ puede pasar a falsa
 * (otro cliente la marca como leída) — ahí "ausente de la página 1 fresca"
 * ya no distingue "está más abajo, sin re-pedir todavía" de "dejó de
 * pertenecer al filtro". Ver `refreshSilently` para el tratamiento distinto
 * de ese caso.
 */
function mergeNotifications(current: SystemNotification[], fresh: SystemNotification[]): SystemNotification[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const freshIds = new Set(fresh.map((item) => item.id));
  const reconciled = fresh.map((item) => {
    const existing = currentById.get(item.id);
    if (existing?.status === "LEIDA" && item.status !== "LEIDA") return { ...item, status: existing.status };
    return item;
  });
  const remaining = current.filter((item) => !freshIds.has(item.id));
  return [...reconciled, ...remaining];
}

export function NotificationsPage() {
  const [items, setItems] = useState<SystemNotification[]>([]);
  const [meta, setMeta] = useState<SystemNotificationListMeta>(emptyMeta);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  // Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md): "Crear
  // novedad" es el punto principal de este flujo -- Notificaciones agrupa
  // TODAS las alertas del fichador, no sólo las de turno. Crear la
  // novedad no marca la notificación como leída ni cambia su estado; eso
  // sigue siendo "Marcar leída", una acción manual aparte.
  const [noveltyContext, setNoveltyContext] = useState<NoveltyPrefillContext>();
  const [noveltyNotice, setNoveltyNotice] = useState("");

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

    // Etapa 15M.19C (docs/decisions/NOTIFICATIONS_PAGE_LIVE_REFRESH_15M19C.md):
    // refresco silencioso — misma capa de acceso (workforceApiService), mismo
    // endpoint y filtro activo, pero NUNCA toca loading/error ni reemplaza la
    // lista entera (fusiona vía mergeNotifications). Un fallo acá se ignora a
    // propósito: la lista visible no se toca, y el próximo tick/evento
    // reintenta solo — nunca tapa contenido ya visible con una pantalla de
    // error por un refresh de fondo.
    function refreshSilently() {
      workforceApiService
        .notifications({ page: 1, take: PAGE_SIZE, status: statusFilter || undefined })
        .then((result) => {
          if (!mounted) return;
          // Etapa 15M.19D §26: bajo "NO_LEIDA" la pertenencia al filtro puede
          // pasar a falsa (otro cliente marcó la fila como leída) — la página
          // 1 fresca YA es, en ese caso, la verdad completa (el backlog de no
          // leídas rara vez supera PAGE_SIZE, y aunque lo superara, preferir
          // una bandeja "No leídas" correcta sobre preservar páginas
          // profundas de un filtro que puede encogerse). Reemplazo completo,
          // sigue sin loading/error — sigue siendo un refresco silencioso.
          // "" y "LEIDA" son monótonos (una fila que ya matcheaba nunca deja
          // de hacerlo) — ahí sí vale la fusión que preserva páginas
          // profundas (mergeNotifications).
          if (statusFilter === "NO_LEIDA") {
            setItems(result.items);
            setMeta(result.meta);
            return;
          }
          let mergedLength = 0;
          setItems((current) => {
            const merged = mergeNotifications(current, result.items);
            mergedLength = merged.length;
            return merged;
          });
          // Sólo total/hasMore se actualizan acá — page/pageSize quedan
          // intactos: pisarlos con el page=1 de este refresco silencioso
          // rompería "Cargar más" (siempre pediría la página siguiente a 1).
          setMeta((current) => ({ ...current, total: result.meta.total, hasMore: mergedLength < result.meta.total }));
        })
        .catch(() => undefined);
    }

    const timer = window.setInterval(refreshSilently, NOTIFICATIONS_POLL_INTERVAL_MS);
    // Etapa 15M.19C §11/21: mismo evento que ya usa la campana del topbar
    // (AppShell.tsx) — reacciona sin esperar al próximo tick. `markRead`, más
    // abajo, ya lo dispara al marcar como leída; también puede llegar de
    // otra pestaña/flujo futuro. `focus` cubre volver a la pestaña/app.
    window.addEventListener("app:notifications-changed", refreshSilently);
    window.addEventListener("focus", refreshSilently);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener("app:notifications-changed", refreshSilently);
      window.removeEventListener("focus", refreshSilently);
    };
  }, [statusFilter, refresh]);

  const loadMore = async () => {
    if (!meta.hasMore || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const result = await workforceApiService.notifications({ page: meta.page + 1, take: PAGE_SIZE, status: statusFilter || undefined });
      // Etapa 15M.19C: de-dup por id — si un refresco silencioso de la
      // página 1 ya trajo alguna de estas filas (offset movido por
      // notificaciones nuevas insertadas entre medio), no se duplica.
      setItems((current) => {
        const existingIds = new Set(current.map((row) => row.id));
        return [...current, ...result.items.filter((row) => !existingIds.has(row.id))];
      });
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
      setItems((current) =>
        // Etapa 15M.19C §12: bajo el filtro "No leídas", una fila recién
        // marcada como leída deja de pertenecer a la vista actual — se
        // quita de inmediato en vez de quedar visible con el badge "Leída"
        // hasta el próximo refresco.
        statusFilter === "NO_LEIDA"
          ? current.filter((row) => row.id !== item.id)
          : current.map((row) => (row.id === item.id ? { ...row, status: "LEIDA" } : row)),
      );
      if (statusFilter === "NO_LEIDA") setMeta((current) => ({ ...current, total: Math.max(0, current.total - 1) }));
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
        {status === "success" ? items.map((item) => {
          const employee = item.employee;
          return <article className={`notification-row ${item.status === "NO_LEIDA" ? "unread" : ""}`} key={item.id}>
          <div className="notification-icon"><Bell size={17}/></div><div><b>{item.title}</b>{employee ? <span className="notification-person">{employee.lastName}, {employee.firstName} · Legajo {employee.legajo}</span> : null}<p>{item.message}</p><small>{notificationEventDateLabel(item) ?? formatDateTime(item.createdAt)}</small></div>
          {/* Etapa 14G.6: "Ver detalle" antes marcaba como leída como efecto
              colateral de la navegación (además del botón explícito "Marcar
              leída", que hacía lo mismo) -- sin ninguna distinción visual
              entre ambas acciones. Ahora navegar sólo navega; "Marcar leída"
              sigue siendo la única forma explícita de marcar como leída. */}
          <div className="notification-actions">
            {item.link ? <Link className="table-icon-action" title="Ver detalle" aria-label="Ver detalle" to={item.link}><Eye size={14} /><span>Ver detalle</span></Link> : null}
            {/* Sólo si el backend ya resolvió el empleado para esta
                notificación (ShiftAlert/WorkShift/Employee/
                AttendanceInactivityIncident -- los 4 entityType que
                workforce.service.ts::notifications() enriquece hoy). Sin
                eso no hay datos suficientes para precargar nada. */}
            {employee ? <button type="button" className="table-icon-action" title="Crear novedad" aria-label="Crear novedad" onClick={() => setNoveltyContext(buildNoveltyPrefillFromNotification({ ...item, employee }))}><FilePlus2 size={14} /><span>Crear novedad</span></button> : null}
            {item.status === "NO_LEIDA" ? <button className="table-link" onClick={() => void markRead(item)}><Check size={15}/> Marcar leída</button> : <Badge tone="neutral">Leída</Badge>}
          </div>
        </article>;
        }) : null}
        {status === "success" && !items.length ? <div className="empty">{emptyText}</div> : null}
      </div>
      {status === "success" && meta.hasMore ? <div className="attendance-load-more"><Button variant="subtle" onClick={() => void loadMore()} loading={loadingMore}>Cargar {Math.min(PAGE_SIZE, meta.total - items.length)} más</Button></div> : null}
    </Section>

    {noveltyContext ? (
      <NoveltyFromContextModal
        context={noveltyContext}
        close={() => setNoveltyContext(undefined)}
        saved={() => {
          setNoveltyContext(undefined);
          setNoveltyNotice("Novedad creada. RRHH la revisa como cualquier otra novedad.");
          // Etapa 15M.16: faltaba este auto-cierre -- el mensaje quedaba
          // anclado en pantalla indefinidamente (mismo bug duplicado en
          // AttendancePage.tsx, mismo flujo de origen). El resto de los
          // ".toast" de la app siempre se limpian solos; éste era la
          // excepción, no la regla.
          setTimeout(() => setNoveltyNotice(""), TOAST_SUCCESS_MS);
        }}
      />
    ) : null}

    {noveltyNotice ? <div className="toast" role="status">{noveltyNotice}</div> : null}
  </>;
}
