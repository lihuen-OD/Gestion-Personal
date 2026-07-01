import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { PuestoFilters } from "../components/puestos/PuestoFilters";
import { PuestoSummaryCards } from "../components/puestos/PuestoSummaryCards";
import { PuestoTable } from "../components/puestos/PuestoTable";
import { useAuth } from "../context/AuthContext";
import { positionApiService } from "../services/api/positionApiService";
import type { Position, PositionFilters, PositionSummary } from "../types/position.types";
import { roleLevel } from "../utils/roles";

const norm = (value: unknown) => String(value || "").trim().toLowerCase();

function matches(position: Position, filters: PositionFilters) {
  const query = norm(filters.search);
  const text = norm(`${position.code} ${position.name} ${position.businessUnitName} ${position.establishmentName} ${position.areaDepartment} ${position.sector} ${(position.salaryRangeCategories || []).join(" ")}`);
  return (!query || text.includes(query))
    && (!filters.businessUnitName || position.businessUnitName === filters.businessUnitName)
    && (!filters.establishmentName || position.establishmentName === filters.establishmentName)
    && (!filters.areaDepartment || position.areaDepartment === filters.areaDepartment)
    && (!filters.sector || position.sector === filters.sector)
    && (!filters.salaryRangeCategory || position.salaryRangeCategories?.includes(filters.salaryRangeCategory))
    && (!filters.status || position.status === filters.status);
}

function options(items: Position[]) {
  const unique = (values: (string | undefined)[]) => Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "es"));
  return {
    businessUnitName: unique(items.map((position) => position.businessUnitName)),
    establishmentName: unique(items.map((position) => position.establishmentName)),
    areaDepartment: unique(items.map((position) => position.areaDepartment)),
    sector: unique(items.map((position) => position.sector)),
    salaryRangeCategory: unique(items.flatMap((position) => position.salaryRangeCategories || [])),
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
  businessUnitName: "",
  establishmentName: "",
  areaDepartment: "",
  sector: "",
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

  useEffect(() => {
    let alive = true;
    setIsLoadingApi(true);
    positionApiService.getAll()
      .then((items) => {
        if (!alive) return;
        setApiItems(items);
      })
      .catch(() => {
        if (!alive) return;
        setApiItems([]);
      })
      .finally(() => {
        if (alive) setIsLoadingApi(false);
      });
    return () => { alive = false; };
  }, [refresh]);

  if (level === 3) return <Navigate to="/horas" />;

  const positions = useMemo(() => apiItems.filter((position) => matches(position, filters)), [apiItems, filters]);

  const toggle = async (position: Position) => {
    if (!confirm(`Confirmar ${position.status === "ACTIVO" ? "inactivacion" : "activacion"} del puesto ${position.name}?`)) return;
    await positionApiService.update({ ...position, status: position.status === "ACTIVO" ? "INACTIVO" : "ACTIVO" });
    setRefresh((value) => value + 1);
  };

  const remove = async (position: Position) => {
    const assigned = getAssignedCount(position);
    const message = assigned ? `El puesto ${position.name} tiene ${assigned} persona(s) asignadas. No se borra para no romper legajos; se va a inactivar/ocultar. Confirmar?` : `Confirmar ocultar/eliminar ${position.name}?`;
    if (!confirm(message)) return;
    await positionApiService.removeOrHide(position.id);
    setRefresh((value) => value + 1);
  };

  return (
    <>
      <div className="page-header"><div><p className="eyebrow">PUESTOS</p><h1>Puestos</h1><p>Administracion de descripciones de puesto y estructura funcional.</p></div>{canEdit && <Link className="button primary" to="/puestos/nuevo"><Plus size={17} /> Crear puesto</Link>}</div>
      <PuestoSummaryCards summary={summary(apiItems)} />
      <section className="panel position-list-panel"><div className="panel-head"><div><h3>Listado de puestos</h3><p>{isLoadingApi ? "Cargando puestos desde backend..." : `${positions.length} resultados segun filtros aplicados.`}</p></div></div><div className="panel-body position-list-body"><PuestoFilters filters={filters} options={options(apiItems)} onChange={setFilters} /><PuestoTable positions={positions} assignedCount={(id) => getAssignedCount(positions.find((position) => position.id === id)!)} canEdit={canEdit} onRemove={remove} onToggleStatus={toggle} /></div></section>
    </>
  );
}
