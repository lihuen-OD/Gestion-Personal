import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { NoveltyTypeFilters } from "../components/novelty-types/NoveltyTypeFilters";
import { NoveltyTypeSummaryCards } from "../components/novelty-types/NoveltyTypeSummaryCards";
import { NoveltyTypeTable } from "../components/novelty-types/NoveltyTypeTable";
import { useAuth } from "../context/AuthContext";
import { noveltyTypeMockService } from "../services/noveltyTypeMockService";
import type { NoveltyType } from "../types/noveltyType.types";

function roleLevel(role: string) { return role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3; }

export function NoveltyTypesPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const canEdit = level === 1;
  const [filters, setFilters] = useState(noveltyTypeMockService.getEmptyFilters());
  const [refresh, setRefresh] = useState(0);
  if (level !== 1) return <Navigate to="/configuracion" />;
  void refresh;
  const items = noveltyTypeMockService.getFiltered(filters);
  const toggle = (item: NoveltyType) => {
    if (!confirm(`Confirmar ${item.status === "ACTIVO" ? "inactivación" : "activación"} de ${item.name}?`)) return;
    noveltyTypeMockService.changeStatus(item.id, item.status === "ACTIVO" ? "INACTIVO" : "ACTIVO", user!);
    setRefresh((value) => value + 1);
  };
  return <>
    <div className="page-header"><div><p className="eyebrow">CONFIGURACIÓN</p><h1>Tipos de novedades</h1><p>Catálogo maestro interno con reglas operativas y equivalencias Finnegans.</p></div>{canEdit && <Link className="button primary" to="/configuracion/tipos-novedades/nuevo"><Plus size={17} /> Crear tipo</Link>}</div>
    <NoveltyTypeSummaryCards items={noveltyTypeMockService.getAll()} />
    <section className="panel"><div className="panel-head"><div><h3>Listado de tipos</h3><p>{items.length} resultados según filtros aplicados.</p></div></div><div className="panel-body"><NoveltyTypeFilters filters={filters} options={noveltyTypeMockService.getFilterOptions()} onChange={setFilters} /><NoveltyTypeTable items={items} canEdit={canEdit} onToggleStatus={toggle} /></div></section>
  </>;
}
