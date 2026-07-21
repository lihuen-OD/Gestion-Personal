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
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";

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
      setError("No pudimos guardar el tipo de novedad. Revisá si el código ya existe e intentá nuevamente.");
    }
  });

  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;

  return (
    <form onSubmit={save}>
      <PageHeader eyebrow="TIPOS DE NOVEDADES" title="Crear tipo de novedad" description="Defini la novedad interna, sus reglas y la vinculacion con Finnegans." />
      <Section title="1. Identificacion interna" subtitle="Datos visibles para RRHH, supervision y carga horaria."><NoveltyTypeIdentificationTab item={item} setItem={setItem} /></Section>
      <Section title="2. Reglas operativas" subtitle="Controlan que campos se habilitan y que impactos genera la novedad."><NoveltyTypeRulesTab item={item} setItem={setItem} /></Section>
      <Section title="3. Vinculacion Finnegans" subtitle="Equivalencias externas para exportacion e integracion futura."><NoveltyTypeFinnegansTab item={item} setItem={setItem} /></Section>
      {error && <p className="error create-error">{error}</p>}
      <div className="form-actions create-actions">
        <Link to="/configuracion/tipos-novedades" className="button subtle">Cancelar</Link>
        <Button variant="primary" disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar tipo"}</Button>
      </div>
    </form>
  );
}
