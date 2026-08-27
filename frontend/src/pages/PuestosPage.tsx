import { AlertTriangle, Archive, CheckCircle2, Link2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { PuestoFilters } from "../components/puestos/PuestoFilters";
import { PuestoTable } from "../components/puestos/PuestoTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { StatCard } from "../components/ui/StatCard";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { Pagination } from "../components/ui/Pagination";
import { useAuth } from "../context/AuthContext";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { positionApiService } from "../services/api/positionApiService";
import type { OrgStructureCatalog } from "../types/orgStructure.types";
import type { Position, PositionFilters, PositionSummary } from "../types/position.types";
import { roleLevel } from "../utils/roles";
import { confirmAction } from "../services/appDialog";
import { useDebouncedValue } from "../utils/useDebouncedValue";

const pageSize = 25;

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
  const debouncedSearch = useDebouncedValue(filters.search);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [catalog, setCatalog] = useState<OrgStructureCatalog | undefined>(undefined);

  // Etapa 9E: tabla paginada de verdad (antes traía hasta 300 puestos y
  // filtraba/paginaba 100% en el cliente contra ese fetch-all).
  const [items, setItems] = useState<Position[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize, hasMore: false });
  const [listStatus, setListStatus] = useState<"loading" | "success" | "error">("loading");

  // Las tarjetas resumen y las opciones de "Rango salarial" del filtro
  // necesitan el universo completo de puestos (no sólo la página visible) —
  // se mantiene un fetch aparte con getAll() (sin filtrar, hasta 300, sin
  // cambios respecto de antes) sólo para eso, nunca para pintar la tabla.
  const [statsItems, setStatsItems] = useState<Position[]>([]);
  const [statsLoaded, setStatsLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    orgStructureApiService.getCatalog()
      .then((data) => { if (alive) setCatalog(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    positionApiService.getAll()
      .then((data) => { if (alive) { setStatsItems(data); setStatsLoaded(true); } })
      .catch(() => { if (alive) setStatsLoaded(true); });
    return () => { alive = false; };
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    // Sólo mostrar el loading grande cuando todavía no hay puestos en
    // pantalla — cambiar de filtro/página, o refrescar tras una mutación, no
    // debe blanquear la tabla ya poblada (mismo patrón de la Etapa 9B/9C).
    if (!items.length) setListStatus("loading");
    positionApiService.list({
      page,
      take: pageSize,
      search: debouncedSearch,
      status: filters.status,
      sectorId: filters.sectorId,
      areaId: filters.areaId,
      establishmentId: filters.establishmentId,
      businessUnitId: filters.businessUnitId,
      salaryRangeCategory: filters.salaryRangeCategory,
    })
      .then((result) => {
        if (!alive) return;
        setItems(result.items);
        setMeta(result.meta);
        setListStatus("success");
      })
      .catch(() => {
        if (!alive) return;
        setItems([]);
        setMeta({ total: 0, page, pageSize, hasMore: false });
        setListStatus("error");
      });
    return () => { alive = false; };
  }, [page, debouncedSearch, filters.status, filters.sectorId, filters.areaId, filters.establishmentId, filters.businessUnitId, filters.salaryRangeCategory, refresh]);

  if (level === 3) return <Navigate to="/gestion-horaria" />;

  const positionSummary = summary(statsItems);

  const changeFilters = (next: PositionFilters) => {
    setFilters(next);
    setPage(1);
  };

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
        action={canEdit ? <Button variant="primary" to="/puestos/nuevo"><Plus size={17} /> Crear puesto</Button> : undefined}
      />
      {statsLoaded ? (
        <div className="stat-grid puestos-summary">
          <StatCard label="Total de puestos" value={positionSummary.total} detail="Descripciones creadas" icon={Archive} />
          <StatCard label="Puestos activos" value={positionSummary.active} detail="Disponibles para vincular" tone="green" icon={CheckCircle2} />
          <StatCard label="Puestos inactivos" value={positionSummary.inactive} detail="Conservan historial" tone="red" icon={Archive} />
          <StatCard label="Sin personas asignadas" value={positionSummary.withoutPeople} detail="Calculado desde legajos" tone="orange" icon={AlertTriangle} />
          <StatCard label="Actualizacion pendiente" value={positionSummary.pendingUpdate} detail="Mas de 12 meses" tone="purple" icon={AlertTriangle} />
          <StatCard label="Vinculados a legajos" value={positionSummary.linkedToEmployees} detail="Con personas activas" tone="green" icon={Link2} />
        </div>
      ) : null}
      <Section className="position-list-panel" title="Listado de puestos" subtitle={listStatus === "loading" ? "Cargando puestos..." : `${meta.total} resultado(s) segun filtros aplicados.`}>
        <div className="position-list-body">
          <PuestoFilters filters={filters} options={options(statsItems, catalog)} onChange={changeFilters} />
          {listStatus === "loading" ? <LoadingState text="Cargando puestos..." /> : listStatus === "error" ? <ErrorState message="No pudimos cargar los puestos." onRetry={() => setRefresh((value) => value + 1)} /> : (
            <>
              <PuestoTable positions={items} assignedCount={(id) => getAssignedCount(items.find((position) => position.id === id)!)} canEdit={canEdit} onRemove={remove} onToggleStatus={toggle} />
              {items.length > 0 ? <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="puestos" /> : null}
            </>
          )}
        </div>
      </Section>
    </>
  );
}
