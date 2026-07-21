import { Power, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { NoveltyTypeFinnegansTab } from "../components/novelty-types/NoveltyTypeFinnegansTab";
import { NoveltyTypeHistoryTab } from "../components/novelty-types/NoveltyTypeHistoryTab";
import { NoveltyTypeIdentificationTab } from "../components/novelty-types/NoveltyTypeIdentificationTab";
import { NoveltyTypeRulesTab } from "../components/novelty-types/NoveltyTypeRulesTab";
import { useAuth } from "../context/AuthContext";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import type { NoveltyType } from "../types/noveltyType.types";
import { roleLevel } from "../utils/roles";
import { useAsyncAction } from "../utils/useAsyncAction";
import { Section } from "../components/ui/Section";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";

const tabs = ["Identificacion", "Reglas operativas", "Finnegans", "Historial"];
const tabItems = tabs.map((label, index) => ({ key: String(index), label: `${index + 1}. ${label}` }));

export function NoveltyTypeDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [item, setItem] = useState<NoveltyType | undefined>(undefined);
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [loadRetry, setLoadRetry] = useState(0);
  const [tab, setTab] = useState(0);
  const [notice, setNotice] = useState(location.state?.created ? "Tipo de novedad creado correctamente." : "");

  useEffect(() => {
    let alive = true;
    if (!id) return;
    setLoadStatus("loading");
    noveltyTypeApiService.getById(id)
      .then((source) => {
        if (!alive) return;
        setItem(source);
        setLoadStatus("success");
      })
      .catch(() => {
        if (alive) setLoadStatus("error");
      });
    return () => { alive = false; };
  }, [id, loadRetry]);

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!item) return;
    if (!item.name.trim() || !item.description.trim()) return setNotice("Completa nombre y descripcion funcional.");
    try {
      const saved = await noveltyTypeApiService.update(item.id, item);
      if (saved) setItem(saved);
      setNotice("Cambios guardados correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch {
      setNotice("No pudimos guardar el tipo de novedad. Revisá si el código ya existe e intentá nuevamente.");
    }
  });

  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  if (loadStatus === "loading") return <Section title="Tipo de novedad"><LoadingState text="Cargando tipo de novedad..." /></Section>;
  if (loadStatus === "error") return <Section title="Tipo de novedad"><ErrorState message="No se pudo cargar el tipo de novedad." onRetry={() => setLoadRetry((value) => value + 1)} /></Section>;
  if (!item) return <Navigate to="/configuracion/tipos-novedades" />;

  const toggle = async () => {
    if (!confirm(`Confirmar ${item.status === "ACTIVO" ? "inactivacion" : "activacion"} de ${item.name}?`)) return;
    const next = { ...item, status: item.status === "ACTIVO" ? "INACTIVO" : "ACTIVO" } as NoveltyType;
    try {
      const saved = await noveltyTypeApiService.update(item.id, next);
      if (saved) setItem(saved);
    } catch {
      setNotice("No pudimos cambiar el estado. Intentá nuevamente.");
    }
  };

  const render = () => {
    if (tab === 0) return <NoveltyTypeIdentificationTab item={item} setItem={setItem} />;
    if (tab === 1) return <NoveltyTypeRulesTab item={item} setItem={setItem} />;
    if (tab === 2) return <NoveltyTypeFinnegansTab item={item} setItem={setItem} />;
    return <NoveltyTypeHistoryTab item={item} />;
  };

  return (
    <>
      <div className="detail-hero catalog-hero">
        <Link to="/configuracion/tipos-novedades" className="back-link">← Volver a tipos</Link>
        <div>
          <div className="avatar">{item.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <p className="eyebrow">{item.code} · {item.kind}</p>
            <h1>{item.name}</h1>
            <p>{item.description}</p>
          </div>
        </div>
        <div className="hero-actions">
          <Badge tone={item.status === "ACTIVO" ? "success" : "neutral"}>{item.status}</Badge>
          <button className="table-icon-action" title={item.status === "ACTIVO" ? "Inactivar" : "Activar"} aria-label={item.status === "ACTIVO" ? "Inactivar" : "Activar"} onClick={toggle}><Power size={14} /><span>{item.status === "ACTIVO" ? "Inactivar" : "Activar"}</span></button>
          <button className="table-icon-action danger-link" title="Ocultar" aria-label="Ocultar" onClick={() => { if (confirm("No se elimina para conservar trazabilidad. Se va a inactivar el tipo.")) toggle(); }}><Trash2 size={14} /><span>Ocultar</span></button>
        </div>
      </div>
      {notice && <div className="toast">{notice}</div>}
      <Tabs tabs={tabItems} active={String(tab)} onChange={(key) => setTab(Number(key))} />
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>{tabs[tab]}</h3>
            <p>{tab === 2 ? "Equivalencias entre la novedad interna y conceptos externos." : tab === 3 ? "Trazabilidad del catalogo." : "Configuracion editable del tipo de novedad."}</p>
          </div>
          {tab < 3 && <Button variant="primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar cambios"}</Button>}
        </div>
        <div className="panel-body">{render()}</div>
      </section>
    </>
  );
}
