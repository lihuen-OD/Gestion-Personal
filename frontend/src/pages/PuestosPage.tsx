import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { PuestoFilters } from "../components/puestos/PuestoFilters";
import { PuestoSummaryCards } from "../components/puestos/PuestoSummaryCards";
import { PuestoTable } from "../components/puestos/PuestoTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { useAuth } from "../context/AuthContext";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { positionApiService } from "../services/api/positionApiService";
import type { OrgStructureCatalog } from "../types/orgStructure.types";
import type { Position, PositionFilters, PositionSummary } from "../types/position.types";
import { roleLevel } from "../utils/roles";
import { confirmAction } from "../services/appDialog";

const norm = (value: unknown) => String(value || "").trim().toLowerCase();

/**
 * Filtra por sectorId real y por los ids derivados via la cadena
 * sector -> area -> establishment -> businessUnit (limpieza final de
 * Position, 2026-08-18). Los strings legado ya no existen en el esquema —
 * el texto de busqueda libre usa unicamente los derivados y, para categoria
 * salarial, la relacion real PositionSalaryCategory.
 */
export function matches(position: Position, filters: PositionFilters) {
  const query = norm(filters.search);
  const text = norm(`${position.code} ${position.name} ${position.derivedBusinessUnitName || ""} ${position.derivedEstablishmentName || ""} ${position.derivedAreaName || ""} ${position.derivedSectorName || ""} ${(position.salaryCategoryNames || []).join(" ")}`);
  return (!query || text.includes(query))
    && (!filters.businessUnitId || position.derivedBusinessUnitId === filters.businessUnitId)
    && (!filters.establishmentId || position.derivedEstablishmentId === filters.establishmentId)
    && (!filters.areaId || position.derivedAreaId === filters.areaId)
    && (!filters.sectorId || position.sectorId === filters.sectorId)
    && (!filters.salaryRangeCategory || position.salaryCategoryNames?.includes(filters.salaryRangeCategory))
    && (!filters.status || position.status === filters.status);
}

/**
 * Las opciones de Unidad de negocio/Establecimiento/Area/Sector vienen del
 * catalogo REAL de Estructura Organizacional (no de strings sueltos) para
 * que el filtro muestre siempre el universo real, incluidos nodos sin
 * ningun puesto todavia. La opcion de rango salarial viene de las
 * categorias reales ya vinculadas a los puestos cargados.
 */
export function options(items: Position[], catalog: OrgStructureCatalog | undefined) {
  const activeIdName = (entries: Array<{ id: string; name: string; status: string }>) =>
    entries.filter((entry) => entry.status === "ACTIVO").map((entry) => ({ id: entry.id, name: entry.name })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const uniqueStrings = (values: (string | undefined)[]) => Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "es"));
  return {
    businessUnitId: activeIdName(catalog?.businessUnits || []),
    establishmentId: activeIdName(catalog?.establishments || []),
    areaId: activeIdName(catalog?.areas || []),
    sectorId: activeIdName(catalog?.sectors || []),
    salaryRangeCategory: uniqueStrings(items.flatMap((position) => position.salaryCategoryNames || [])),
  };
}

function summary(items: Position[]): PositionSummary {
  const linkedToEmployees = items.reduce((total, position) => total + (position.assignedCount || 0), 0);
  return {
    total: items.length,
    active: items.filter((position) => position.status === "ACTIVO").length,
    inactive: items.filter((position) => position.status === "INACTIVO").length,
    withoutPeople: items.filter((position) => (position.assignedCount || 0) === 0).length,
    pendingUpdate: 0,
    linkedToEmployees,
  };
}

function getAssignedCount(position: Position) {
  return position.assignedCount || 0;
}

const emptyFilters: PositionFilters = {
  search: "",
  businessUnitId: "",
  establishmentId: "",
  areaId: "",
  sectorId: "",
  salaryRangeCategory: "",
  status: "",
};

export function PuestosPage() {
  const { user } = useAuth();
  const level = roleLevel(user!.role);
  const canEdit = level === 1;
  const [filters, setFilters] = useState<PositionFilters>(emptyFilters);
  const [refresh, setRefresh] = useState(0);
  const [apiItems, setApiItems] = useState<Position[]>([]);
  const [isLoadingApi, setIsLoadingApi] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [catalog, setCatalog] = useState<OrgStructureCatalog | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    orgStructureApiService.getCatalog()
      .then((data) => { if (alive) setCatalog(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setIsLoadingApi(true);
    setLoadError(false);
    positionApiService.getAll()
      .then((items) => {
        if (!alive) return;
        setApiItems(items);
      })
      .catch(() => {
        if (!alive) return;
        setApiItems([]);
        setLoadError(true);
      })
      .finally(() => {
        if (alive) setIsLoadingApi(false);
      });
    return () => { alive = false; };
  }, [refresh]);

  if (level === 3) return <Navigate to="/gestion-horaria" />;

  const positions = useMemo(() => apiItems.filter((position) => matches(position, filters)), [apiItems, filters]);

  const toggle = async (position: Position) => {
    const action = position.status === "ACTIVO" ? "inactivar" : "activar";
    if (!await confirmAction(`¿Querés ${action} el puesto “${position.name}”?`, { title: `${action === "inactivar" ? "Inactivar" : "Activar"} puesto`, confirmLabel: action === "inactivar" ? "Inactivar" : "Activar", tone: action === "inactivar" ? "danger" : "primary" })) return;
    await positionApiService.update({ ...position, status: position.status === "ACTIVO" ? "INACTIVO" : "ACTIVO" });
    setRefresh((value) => value + 1);
  };

  const remove = async (position: Position) => {
    const assigned = getAssignedCount(position);
    const message = assigned ? `El puesto ${position.name} tiene ${assigned} persona(s) asignadas. No se borra para no romper legajos; se va a inactivar/ocultar. Confirmar?` : `Confirmar ocultar/eliminar ${position.name}?`;
    if (!await confirmAction(message, { title: "Ocultar puesto", confirmLabel: "Ocultar", tone: "danger" })) return;
    await positionApiService.removeOrHide(position.id);
    setRefresh((value) => value + 1);
  };

  return (
    <>
      <PageHeader
        eyebrow="PUESTOS"
        title="Puestos"
        description="Administracion de descripciones de puesto y estructura funcional."
        action={canEdit ? <Link className="button primary" to="/puestos/nuevo"><Plus size={17} /> Crear puesto</Link> : undefined}
      />
      {!isLoadingApi && !loadError ? <PuestoSummaryCards summary={summary(apiItems)} /> : null}
      <Section className="position-list-panel" title="Listado de puestos" subtitle={isLoadingApi ? "Cargando puestos..." : `${positions.length} resultados segun filtros aplicados.`}>
        <div className="position-list-body">
          <PuestoFilters filters={filters} options={options(apiItems, catalog)} onChange={setFilters} />
          {isLoadingApi ? <LoadingState text="Cargando puestos..." /> : loadError ? <ErrorState message="No pudimos cargar los puestos." onRetry={() => setRefresh((value) => value + 1)} /> : <PuestoTable positions={positions} assignedCount={(id) => getAssignedCount(positions.find((position) => position.id === id)!)} canEdit={canEdit} onRemove={remove} onToggleStatus={toggle} />}
        </div>
      </Section>
    </>
  );
}
