import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { emptyNoveltyType } from "../components/novelty-types/NoveltyTypeFields";
import { NoveltyTypeFinnegansTab } from "../components/novelty-types/NoveltyTypeFinnegansTab";
import { NoveltyTypeIdentificationTab } from "../components/novelty-types/NoveltyTypeIdentificationTab";
import { NoveltyTypeRulesTab } from "../components/novelty-types/NoveltyTypeRulesTab";
import { useAuth } from "../context/AuthContext";
import { noveltyTypeMockService } from "../services/noveltyTypeMockService";
import type { NoveltyType } from "../types/noveltyType.types";

function roleLevel(role: string) { return role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3; }

export function NoveltyTypeCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [item, setItem] = useState<NoveltyType>({ ...emptyNoveltyType(), id: crypto.randomUUID(), code: noveltyTypeMockService.getNextCode() });
  const [error, setError] = useState("");
  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!item.name.trim() || !item.description.trim()) return setError("Completá nombre y descripción funcional.");
    const invalidLink = item.finnegansLinks.some((link) => link.code.trim() && (!link.name.trim() || !link.settlementConcept.trim()));
    if (invalidLink) return setError("Si cargás un código Finnegans, completá nombre y concepto liquidable.");
    const created = noveltyTypeMockService.create(item, user!);
    navigate(`/configuracion/tipos-novedades/${created.id}`, { state: { created: true } });
  };
  return <form onSubmit={save}>
    <div className="page-header"><div><p className="eyebrow">TIPOS DE NOVEDADES</p><h1>Crear tipo de novedad</h1><p>Definí la novedad interna, sus reglas y la vinculación con Finnegans.</p></div></div>
    <section className="panel"><div className="panel-head"><div><h3>1. Identificación interna</h3><p>Datos visibles para RRHH, supervisión y carga horaria.</p></div></div><NoveltyTypeIdentificationTab item={item} setItem={setItem} /></section>
    <section className="panel"><div className="panel-head"><div><h3>2. Reglas operativas</h3><p>Controlan qué campos se habilitan y qué impactos genera la novedad.</p></div></div><NoveltyTypeRulesTab item={item} setItem={setItem} /></section>
    <section className="panel"><div className="panel-head"><div><h3>3. Vinculación Finnegans</h3><p>Equivalencias externas para liquidación e integración futura.</p></div></div><NoveltyTypeFinnegansTab item={item} setItem={setItem} /></section>
    {error && <p className="error create-error">{error}</p>}
    <div className="form-actions create-actions"><Link to="/configuracion/tipos-novedades" className="button subtle">Cancelar</Link><button className="button primary">Guardar tipo</button></div>
  </form>;
}
