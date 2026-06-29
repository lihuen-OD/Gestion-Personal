import { Building2, ChevronRight, ClipboardList, Clock3, FileText, FolderOpen, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";

export function SettingsPage() {
  const cards = [
    { name: "Empresas y estructura", icon: <Building2 />, path: "/configuracion/empresas-estructura" },
    { name: "Tipos de novedades", icon: <ClipboardList />, path: "/configuracion/tipos-novedades" },
    { name: "Horas especiales", icon: <Clock3 />, path: "/configuracion/conceptos-horarios" },
    { name: "Exportación Finnegans", icon: <FileText />, path: "/configuracion/liquidacion" },
    { name: "Categorías documentales", icon: <FolderOpen />, path: "/configuracion/categorias-documentales" },
    { name: "Parámetros de auditoría", icon: <ShieldCheck />, path: "/configuracion/parametros-auditoria" },
  ];
  return <><PageHeader eyebrow="CONFIGURACIÓN GENERAL" title="Parámetros del sistema" description="Administración de catálogos, reglas operativas y salidas del sistema." /><div className="settings-grid">{cards.map((card) => <div className="setting-card" key={card.name}><span>{card.icon}</span><h3>{card.name}</h3><p>{card.name === "Exportación Finnegans" ? "Preparar novedades exportables, sin calcular sueldos." : "Configurar catálogos, estados y reglas disponibles para la operación."}</p>{card.path ? <Link className="table-link" to={card.path}>Administrar <ChevronRight size={15} /></Link> : <button className="table-link">Administrar <ChevronRight size={15} /></button>}</div>)}</div></>;
}
