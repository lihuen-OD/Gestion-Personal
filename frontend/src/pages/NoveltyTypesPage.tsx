import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { NoveltyTypeFilters } from "../components/novelty-types/NoveltyTypeFilters";
import { NoveltyTypeSummaryCards } from "../components/novelty-types/NoveltyTypeSummaryCards";
import { NoveltyTypeTable } from "../components/novelty-types/NoveltyTypeTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { useAuth } from "../context/AuthContext";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import type { NoveltyType, NoveltyTypeFilters as NoveltyTypeFiltersModel } from "../types/noveltyType.types";
import { roleLevel } from "../utils/roles";

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function matchesFilters(item: NoveltyType, filters: NoveltyTypeFiltersModel) {
  const search = normalize(filters.search);
  const text = normalize(`${item.code} ${item.name} ${item.description} ${item.finnegansLinks.map((link) => `${link.code} ${link.name} ${link.exportConcept || ""}`).join(" ")}`);
  if (search && !text.includes(search)) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.status && item.status !== filters.status) return false;
  if (filters.exportsToFinnegans && String(item.rules.exportsToFinnegans) !== filters.exportsToFinnegans) return false;
  if (filters.requiresApproval && String(item.rules.requiresApproval) !== filters.requiresApproval) return false;
  return true;
}

function getFilterOptions(items: NoveltyType[]) {
  return {
    kinds: Array.from(new Set(items.map((item) => item.kind))).sort(),
    statuses: ["ACTIVO", "INACTIVO"],
  };
}

export function NoveltyTypesPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const canEdit = level === 1;
  const [filters, setFilters] = useState<NoveltyTypeFiltersModel>({ search: "", kind: "", exportsToFinnegans: "", requiresApproval: "", status: "" });
  const [refresh, setRefresh] = useState(0);
  const [apiItems, setApiItems] = useState<NoveltyType[] | null>(null);
  const [isLoadingApi, setIsLoadingApi] = useState(true);
  const [apiWarning, setApiWarning] = useState("");

  useEffect(() => {
    let alive = true;
    setIsLoadingApi(true);
    noveltyTypeApiService.getAll()
      .then((items) => {
        if (!alive) return;
        setApiItems(items);
        setApiWarning("");
      })
      .catch(() => {
        if (!alive) return;
        setApiItems(null);
        setApiWarning("No pudimos sincronizar el catálogo. Se muestran datos disponibles en esta sesión.");
      })
      .finally(() => {
        if (alive) setIsLoadingApi(false);
      });
    return () => { alive = false; };
  }, [refresh]);

  if (level !== 1) return <Navigate to="/configuracion" />;

  const all = apiItems || [];
  const items = useMemo(() => all.filter((item) => matchesFilters(item, filters)), [all, filters]);
  const options = useMemo(() => getFilterOptions(all), [all]);

  const toggle = async (item: NoveltyType) => {
    if (!confirm(`Confirmar ${item.status === "ACTIVO" ? "inactivacion" : "activacion"} de ${item.name}?`)) return;
    const nextStatus = item.status === "ACTIVO" ? "INACTIVO" : "ACTIVO";
    await noveltyTypeApiService.update(item.id, { ...item, status: nextStatus });
    setRefresh((value) => value + 1);
  };

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURACION"
        title="Tipos de novedades"
        description="Catalogo maestro interno con reglas operativas y equivalencias Finnegans."
        action={canEdit ? <Link to="/configuracion/tipos-novedades/nuevo" className="button primary"><Plus size={17} /> Crear tipo</Link> : undefined}
      />
      {!isLoadingApi && !apiWarning ? <NoveltyTypeSummaryCards items={all} /> : null}
      <Section title="Listado de tipos" subtitle={isLoadingApi ? "Cargando catálogo..." : `${items.length} resultados segun filtros aplicados.`}>
        <NoveltyTypeFilters filters={filters} options={options} onChange={setFilters} />
        {isLoadingApi ? <LoadingState text="Cargando tipos de novedades..." /> : apiWarning ? <ErrorState message="No pudimos cargar los tipos de novedades." onRetry={() => setRefresh((value) => value + 1)} /> : <NoveltyTypeTable items={items} canEdit={canEdit} onToggleStatus={toggle} />}
      </Section>
    </>
  );
}
