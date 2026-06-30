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

const tabs = ["Identificacion", "Reglas operativas", "Finnegans", "Historial"];

export function NoveltyTypeDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [item, setItem] = useState<NoveltyType | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [notice, setNotice] = useState(location.state?.created ? "Tipo de novedad creado correctamente." : "");

  useEffect(() => {
    let alive = true;
    if (!id) return;
    setIsLoading(true);
    noveltyTypeApiService.getById(id)
      .then((source) => {
        if (!alive) return;
        setItem(source);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => { alive = false; };
  }, [id]);

  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  if (isLoading) return <section className="panel"><div className="panel-body"><div className="empty">Cargando tipo de novedad...</div></div></section>;
  if (!item) return <Navigate to="/configuracion/tipos-novedades" />;

  const save = async () => {
    if (!item.name.trim() || !item.description.trim()) return setNotice("Completa nombre y descripcion funcional.");
    try {
      const saved = await noveltyTypeApiService.update(item.id, item);
      if (saved) setItem(saved);
      setNotice("Cambios guardados correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch {
      setNotice("No se pudo guardar en backend. Revisa la conexion o el codigo duplicado.");
    }
  };

  const toggle = async () => {
    if (!confirm(`Confirmar ${item.status === "ACTIVO" ? "inactivacion" : "activacion"} de ${item.name}?`)) return;
    const next = { ...item, status: item.status === "ACTIVO" ? "INACTIVO" : "ACTIVO" } as NoveltyType;
    try {
      const saved = await noveltyTypeApiService.update(item.id, next);
      if (saved) setItem(saved);
    } catch {
      setNotice("No se pudo cambiar el estado en backend.");
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
          <span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span>
          <button className="table-icon-action" title={item.status === "ACTIVO" ? "Inactivar" : "Activar"} aria-label={item.status === "ACTIVO" ? "Inactivar" : "Activar"} onClick={toggle}><Power size={14} /><span>{item.status === "ACTIVO" ? "Inactivar" : "Activar"}</span></button>
          <button className="table-icon-action danger-link" title="Ocultar" aria-label="Ocultar" onClick={() => { if (confirm("No se elimina para conservar trazabilidad. Se va a inactivar el tipo.")) toggle(); }}><Trash2 size={14} /><span>Ocultar</span></button>
        </div>
      </div>
      {notice && <div className="toast">{notice}</div>}
      <div className="tabs">{tabs.map((label, index) => <button key={label} className={tab === index ? "active" : ""} onClick={() => setTab(index)}>{index + 1}. {label}</button>)}</div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>{tabs[tab]}</h3>
            <p>{tab === 2 ? "Equivalencias entre la novedad interna y conceptos externos." : tab === 3 ? "Trazabilidad del catalogo." : "Configuracion editable del tipo de novedad."}</p>
          </div>
          {tab < 3 && <button className="button primary" onClick={save}>Guardar cambios</button>}
        </div>
        <div className="panel-body">{render()}</div>
      </section>
    </>
  );
}
