import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { emptyNoveltyType } from "../components/novelty-types/NoveltyTypeFields";
import { NoveltyTypeFinnegansTab } from "../components/novelty-types/NoveltyTypeFinnegansTab";
import { NoveltyTypeIdentificationTab } from "../components/novelty-types/NoveltyTypeIdentificationTab";
import { NoveltyTypeRulesTab } from "../components/novelty-types/NoveltyTypeRulesTab";
import { useAuth } from "../context/AuthContext";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import type { NoveltyType } from "../types/noveltyType.types";
import { roleLevel } from "../utils/roles";
import { useAsyncAction } from "../utils/useAsyncAction";

export function NoveltyTypeCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [item, setItem] = useState<NoveltyType>({ ...emptyNoveltyType(), id: crypto.randomUUID(), code: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    noveltyTypeApiService.getAll()
      .then((items) => {
        if (!alive) return;
        setItem((current) => ({ ...current, code: noveltyTypeApiService.getNextCode(items) }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const { isRunning: isSaving, run: save } = useAsyncAction(async (event: FormEvent) => {
    event.preventDefault();
    if (!item.name.trim() || !item.description.trim()) return setError("Completa nombre y descripcion funcional.");
    const invalidLink = item.finnegansLinks.some((link) => link.code.trim() && (!link.name.trim() || !link.exportConcept.trim()));
    if (invalidLink) return setError("Si cargas un codigo Finnegans, completa nombre y concepto exportable.");

    try {
      const created = await noveltyTypeApiService.create(item);
      navigate(`/configuracion/tipos-novedades/${created.id}`, { state: { created: true, usesApi: true } });
    } catch {
      setError("No se pudo guardar en backend. Revisa la conexion o el codigo duplicado.");
    }
  });

  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;

  return (
    <form onSubmit={save}>
      <div className="page-header">
        <div>
          <p className="eyebrow">TIPOS DE NOVEDADES</p>
          <h1>Crear tipo de novedad</h1>
          <p>Defini la novedad interna, sus reglas y la vinculacion con Finnegans.</p>
        </div>
      </div>
      <section className="panel"><div className="panel-head"><div><h3>1. Identificacion interna</h3><p>Datos visibles para RRHH, supervision y carga horaria.</p></div></div><NoveltyTypeIdentificationTab item={item} setItem={setItem} /></section>
      <section className="panel"><div className="panel-head"><div><h3>2. Reglas operativas</h3><p>Controlan que campos se habilitan y que impactos genera la novedad.</p></div></div><NoveltyTypeRulesTab item={item} setItem={setItem} /></section>
      <section className="panel"><div className="panel-head"><div><h3>3. Vinculacion Finnegans</h3><p>Equivalencias externas para exportacion e integracion futura.</p></div></div><NoveltyTypeFinnegansTab item={item} setItem={setItem} /></section>
      {error && <p className="error create-error">{error}</p>}
      <div className="form-actions create-actions"><Link to="/configuracion/tipos-novedades" className="button subtle">Cancelar</Link><button className="button primary" disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar tipo"}</button></div>
    </form>
  );
}
