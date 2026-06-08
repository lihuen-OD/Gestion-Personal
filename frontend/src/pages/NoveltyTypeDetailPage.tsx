import { Power, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { NoveltyTypeFinnegansTab } from "../components/novelty-types/NoveltyTypeFinnegansTab";
import { NoveltyTypeHistoryTab } from "../components/novelty-types/NoveltyTypeHistoryTab";
import { NoveltyTypeIdentificationTab } from "../components/novelty-types/NoveltyTypeIdentificationTab";
import { NoveltyTypeRulesTab } from "../components/novelty-types/NoveltyTypeRulesTab";
import { useAuth } from "../context/AuthContext";
import { noveltyTypeMockService } from "../services/noveltyTypeMockService";
import type { NoveltyType } from "../types/noveltyType.types";

const tabs = ["Identificación", "Reglas operativas", "Finnegans", "Historial"];
function roleLevel(role: string) { return role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3; }

export function NoveltyTypeDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const source = noveltyTypeMockService.getById(id!);
  const [item, setItem] = useState<NoveltyType | undefined>(source);
  const [tab, setTab] = useState(0);
  const [notice, setNotice] = useState(location.state?.created ? "Tipo de novedad creado correctamente." : "");
  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  if (!item) return <Navigate to="/configuracion/tipos-novedades" />;
  const save = () => {
    if (!item.name.trim() || !item.description.trim()) return setNotice("Completá nombre y descripción funcional.");
    const saved = noveltyTypeMockService.update(item.id, item, user!, `Edición de ${tabs[tab]}`, `Se actualizó la solapa ${tabs[tab]}.`);
    if (saved) setItem(saved);
    setNotice("Cambios guardados correctamente.");
    setTimeout(() => setNotice(""), 2200);
  };
  const toggle = () => {
    if (!confirm(`Confirmar ${item.status === "ACTIVO" ? "inactivación" : "activación"} de ${item.name}?`)) return;
    const saved = noveltyTypeMockService.changeStatus(item.id, item.status === "ACTIVO" ? "INACTIVO" : "ACTIVO", user!);
    if (saved) setItem(saved);
  };
  const render = () => {
    if (tab === 0) return <NoveltyTypeIdentificationTab item={item} setItem={setItem} />;
    if (tab === 1) return <NoveltyTypeRulesTab item={item} setItem={setItem} />;
    if (tab === 2) return <NoveltyTypeFinnegansTab item={item} setItem={setItem} />;
    return <NoveltyTypeHistoryTab item={item} />;
  };
  return <>
    <div className="detail-hero catalog-hero"><Link to="/configuracion/tipos-novedades" className="back-link">← Volver a tipos</Link><div><div className="avatar">{item.name.slice(0, 2).toUpperCase()}</div><div><p className="eyebrow">{item.code} · {item.kind}</p><h1>{item.name}</h1><p>{item.description}</p></div></div><div className="hero-actions"><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span><button className="button subtle" onClick={toggle}><Power size={15} /> {item.status === "ACTIVO" ? "Inactivar" : "Activar"}</button><button className="button subtle danger-link" onClick={() => { if (confirm("No se elimina para conservar trazabilidad. Se va a inactivar el tipo.")) toggle(); }}><Trash2 size={15} /> Ocultar</button></div></div>
    {notice && <div className="toast">{notice}</div>}
    <div className="tabs">{tabs.map((label, index) => <button key={label} className={tab === index ? "active" : ""} onClick={() => setTab(index)}>{index + 1}. {label}</button>)}</div>
    <section className="panel"><div className="panel-head"><div><h3>{tabs[tab]}</h3><p>{tab === 2 ? "Equivalencias entre la novedad interna y conceptos externos." : tab === 3 ? "Trazabilidad del catálogo." : "Configuración editable del tipo de novedad."}</p></div>{tab < 3 && <button className="button primary" onClick={save}>Guardar cambios</button>}</div><div className="panel-body">{render()}</div></section>
  </>;
}
