import { Power, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { noveltyKindLabels } from "../components/novelty-types/NoveltyTypeFields";
import { NoveltyTypeForm } from "../components/novelty-types/NoveltyTypeForm";
import { useAuth } from "../context/AuthContext";
import { getUserErrorMessage } from "../services/api/apiClient";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import type { NoveltyType } from "../types/noveltyType.types";
import { MISSING_DATA_MESSAGE, noveltyTypeIssues } from "../utils/noveltyTypeCoverage";
import { roleLevel } from "../utils/roles";
import { activoInactivoLabel, statusTone } from "../utils/status";
import { useAsyncAction } from "../utils/useAsyncAction";
import { Section } from "../components/ui/Section";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { confirmAction } from "../services/appDialog";

// Etapa 15L.2B: sin pestaña "Historial" (el backend audita en AuditLog, pero
// esta pantalla no lo consulta todavía). Etapa 7 (NOVELTY_COVERAGE_ENGINE.md
// §14): las pestañas General/Reglas/Finnegans se reemplazan por el mismo
// formulario por secciones de la creación, con resumen de la configuración.
export function NoveltyTypeDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [item, setItem] = useState<NoveltyType | undefined>(undefined);
  const [saved, setSaved] = useState<NoveltyType | undefined>(undefined);
  const [showIssues, setShowIssues] = useState(false);
  const [focusIssuesRequest, setFocusIssuesRequest] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [loadRetry, setLoadRetry] = useState(0);
  const [notice, setNotice] = useState(location.state?.created ? "Tipo de novedad creado correctamente." : "");

  useEffect(() => {
    let alive = true;
    if (!id) return;
    setLoadStatus("loading");
    noveltyTypeApiService.getById(id)
      .then((source) => {
        if (!alive) return;
        setItem(source);
        setSaved(source);
        setLoadStatus("success");
      })
      .catch(() => {
        if (alive) setLoadStatus("error");
      });
    return () => { alive = false; };
  }, [id, loadRetry]);

  const { isRunning: isSaving, run: save } = useAsyncAction(async (event: FormEvent) => {
    event.preventDefault();
    if (!item) return;
    const issues = noveltyTypeIssues(item);
    if (issues.length) {
      setSaveError("");
      setShowIssues(true);
      return setFocusIssuesRequest((value) => value + 1);
    }
    setSaveError("");
    try {
      const updated = await noveltyTypeApiService.update(item.id, item);
      if (updated) {
        setItem(updated);
        setSaved(updated);
      }
      setShowIssues(false);
      setNotice("Cambios guardados correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch (error) {
      // El backend explica en lenguaje de negocio por qué rechaza una configuración.
      setSaveError(getUserErrorMessage(error, "No pudimos guardar el tipo de novedad. Intentá nuevamente."));
    }
  });

  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  if (loadStatus === "loading") return <Section title="Tipo de novedad"><LoadingState text="Cargando tipo de novedad..." /></Section>;
  if (loadStatus === "error") return <Section title="Tipo de novedad"><ErrorState message="No se pudo cargar el tipo de novedad." onRetry={() => setLoadRetry((value) => value + 1)} /></Section>;
  if (!item) return <Navigate to="/configuracion/tipos-novedades" />;

  const toggle = async (alreadyConfirmed = false) => {
    const action = item.status === "ACTIVO" ? "inactivar" : "activar";
    if (!alreadyConfirmed && !await confirmAction(`¿Querés ${action} el tipo de novedad “${item.name}”?`, { title: `${action === "inactivar" ? "Inactivar" : "Activar"} tipo de novedad`, confirmLabel: action === "inactivar" ? "Inactivar" : "Activar", tone: action === "inactivar" ? "danger" : "primary" })) return;
    // Sólo cambia el estado sobre la versión guardada: no envía ediciones sin guardar.
    const base = saved ?? item;
    const next = { ...base, status: base.status === "ACTIVO" ? "INACTIVO" : "ACTIVO" } as NoveltyType;
    try {
      const updated = await noveltyTypeApiService.update(item.id, next);
      if (updated) {
        setItem({ ...item, status: updated.status, updatedAt: updated.updatedAt });
        setSaved(updated);
      }
    } catch {
      setNotice("No pudimos cambiar el estado. Intentá nuevamente.");
    }
  };

  const statusLabel = activoInactivoLabel(item.status);
  const issues = noveltyTypeIssues(item);

  return (
    <>
      <div className="detail-hero catalog-hero">
        <Link to="/configuracion/tipos-novedades" className="back-link">← Volver a tipos</Link>
        <div>
          <div className="avatar">{item.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <p className="eyebrow">{item.code} · {noveltyKindLabels[item.kind]}</p>
            <h1>{item.name}</h1>
            <p>{item.description}</p>
          </div>
        </div>
        <div className="hero-actions">
          <Badge tone={statusTone(statusLabel)}>{statusLabel}</Badge>
          {item.rules.exportsToFinnegans ? <Badge tone="neutral">Finnegans</Badge> : null}
          <button className="table-icon-action" title={item.status === "ACTIVO" ? "Inactivar" : "Activar"} aria-label={item.status === "ACTIVO" ? "Inactivar" : "Activar"} onClick={() => void toggle()}><Power size={14} /><span>{item.status === "ACTIVO" ? "Inactivar" : "Activar"}</span></button>
          <button className="table-icon-action danger-link" title="Ocultar" aria-label="Ocultar" onClick={async () => { if (await confirmAction("El tipo de novedad no se eliminará: quedará inactivo para conservar su trazabilidad.", { title: "Ocultar tipo de novedad", confirmLabel: "Ocultar", tone: "danger" })) await toggle(true); }}><Trash2 size={14} /><span>Ocultar</span></button>
        </div>
      </div>
      {notice && <div className="toast" role="status">{notice}</div>}
      <form onSubmit={save} noValidate>
        <NoveltyTypeForm
          item={item}
          setItem={setItem}
          original={saved}
          issues={showIssues ? issues : undefined}
          focusIssuesRequest={focusIssuesRequest}
          error={showIssues && issues.length ? MISSING_DATA_MESSAGE : saveError}
          actions={<>
            <Button to="/configuracion/tipos-novedades" variant="subtle">Volver</Button>
            <Button variant="primary" disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar cambios"}</Button>
          </>}
        />
      </form>
    </>
  );
}
