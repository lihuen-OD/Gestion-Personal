import { CalendarClock, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { FilterPanel } from "../components/ui/FilterPanel";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { EmptyState } from "../components/ui/EmptyState";
import { Tabs, tabPanelProps } from "../components/ui/Tabs";
import type { ShiftAssignmentCounts } from "../components/shifts/ShiftTable";
import { ShiftGroupSections } from "../components/shifts/ShiftGroupSections";
import { NO_GROUPS_TEXT, ShiftGroupsPanel } from "../components/shifts/ShiftGroupsPanel";
import { ShiftRotationsPanel } from "../components/rotations/ShiftRotationsPanel";
import { useAuth } from "../context/AuthContext";
import { workforceApiService, type ShiftTemplate } from "../services/api/workforceApiService";
import { shiftAssignmentApiService } from "../services/api/shiftAssignmentApiService";
import { shiftGroupApiService, type ShiftGroup, type ShiftGroupSummary } from "../services/api/shiftGroupApiService";
import { buildShiftGroupSections, matchesShiftGroupFilter, sortShiftGroups, UNGROUPED_FILTER, UNGROUPED_LABEL } from "../utils/shiftGroups";
import { confirmAction } from "../services/appDialog";
import { roleLevel } from "../utils/roles";
import { useShiftGroupAccess } from "../utils/shiftGroupAccess";

type ShiftsView = "turnos" | "grupos" | "rotaciones";
const VIEWS: Array<{ key: ShiftsView; label: string }> = [
  { key: "turnos", label: "Turnos por grupo" },
  { key: "grupos", label: "Grupos" },
  { key: "rotaciones", label: "Rotaciones" },
];
/** R8: la administración de grupos es sólo de RRHH; Nivel 2/3 no ven la pestaña. */
const SCOPED_VIEWS = VIEWS.filter((view) => view.key !== "grupos");
const TABS_ID = "shifts-view";

/** La pestaña vive en la URL (`?vista=`) para volver a ella desde un detalle. */
function viewFromParam(value: string | null, allowGroups = true): ShiftsView {
  if (value === "grupos") return allowGroups ? "grupos" : "turnos";
  return value === "rotaciones" ? value : "turnos";
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function ShiftsPage() {
  const { user } = useAuth();
  // R8: RRHH administra todo; Nivel 2/3 sólo sus grupos (el backend ya filtra
  // catálogos y listados, y vuelve a autorizar cada escritura).
  const isRrhh = roleLevel(user!.role) === 1;
  const { hasGroups, canManageGroup } = useShiftGroupAccess();
  const [templates, setTemplates] = useState<ShiftTemplate[] | null>(null);
  const [counts, setCounts] = useState<Record<string, ShiftAssignmentCounts>>({});
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = viewFromParam(searchParams.get("vista"), isRrhh);
  const setTab = (next: ShiftsView) => setSearchParams(next === "turnos" ? {} : { vista: next }, { replace: true });
  // R3.2: catálogo de grupos aparte — si falla, los turnos se siguen viendo
  // agrupados con el grupo que cada uno ya trae (nunca se oculta el error).
  const [groups, setGroups] = useState<ShiftGroup[] | null>(null);
  const [groupsStatus, setGroupsStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    let alive = true;
    // Etapa 9C: sólo mostrar el loading grande cuando todavía no hay turnos
    // en pantalla — activar/inactivar un turno dispara este mismo efecto
    // (vía `refresh`) y no debe blanquear la tabla ya poblada ni los filtros
    // (que viven en estado aparte, sin tocar) mientras llega la respuesta
    // nueva (mismo patrón ya aplicado en la Etapa 9B a Novedades/Documentos/
    // Auditoría/Horas Especiales/Cierres).
    if (!templates) setLoadStatus("loading");
    Promise.all([workforceApiService.shiftTemplates(), shiftAssignmentApiService.getSummary()])
      .then(([shiftTemplates, summaries]) => {
        if (!alive) return;
        const nextCounts: Record<string, ShiftAssignmentCounts> = {};
        for (const summary of summaries) {
          nextCounts[summary.shiftTemplateId] = { enabled: summary.enabled, disabled: summary.disabled };
        }
        setTemplates(shiftTemplates);
        setCounts(nextCounts);
        setLoadStatus("success");
      })
      .catch(() => {
        if (alive) setLoadStatus("error");
      });
    if (!groups) setGroupsStatus("loading");
    shiftGroupApiService
      .list()
      .then((items) => {
        if (!alive) return;
        setGroups(items);
        setGroupsStatus("success");
      })
      .catch(() => {
        if (alive) setGroupsStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [refresh]);

  const items = useMemo(() => {
    const all = templates || [];
    const term = normalize(search);
    return all.filter((item) => {
      if (status && item.status !== status) return false;
      if (!matchesShiftGroupFilter(item, groupFilter)) return false;
      if (!term) return true;
      const text = normalize(`${item.code} ${item.name} ${item.categoryName || ""} ${item.shiftGroup?.name || ""}`);
      return text.includes(term);
    });
  }, [templates, search, status, groupFilter]);

  const filtersActive = Boolean(search.trim() || status || groupFilter);
  // R8.7: crear exige un grupo ACTIVO propio (un grupo inactivo no admite altas).
  const canCreate = isRrhh || (groupsStatus === "success" && (groups ?? []).some((group) => group.status === "ACTIVO"));
  const sections = useMemo(
    () => buildShiftGroupSections(items, groupsStatus === "success" ? groups : null, { includeEmptyGroups: !filtersActive && groupsStatus === "success" }),
    [items, groups, groupsStatus, filtersActive],
  );
  // Opciones del filtro: el catálogo, o (si no cargó) los grupos que traen los turnos.
  const filterGroups = useMemo<ShiftGroupSummary[]>(() => {
    if (groupsStatus === "success" && groups) return sortShiftGroups(groups);
    const fromTemplates = new Map<string, ShiftGroupSummary>();
    for (const template of templates || []) if (template.shiftGroup) fromTemplates.set(template.shiftGroup.id, template.shiftGroup);
    return sortShiftGroups([...fromTemplates.values()]);
  }, [groups, groupsStatus, templates]);

  const toggle = async (item: ShiftTemplate) => {
    const activating = item.status !== "ACTIVO";
    if (!(await confirmAction(`¿Querés ${activating ? "activar" : "inactivar"} el turno "${item.name}"?`, { title: `${activating ? "Activar" : "Inactivar"} turno`, confirmLabel: activating ? "Activar" : "Inactivar", tone: activating ? "primary" : "danger" }))) return;
    await workforceApiService.updateShiftTemplate(item.id, { status: activating ? "ACTIVO" : "INACTIVO" });
    setRefresh((value) => value + 1);
  };

  return (
    <>
      <PageHeader
        eyebrow={isRrhh ? "CONFIGURACIÓN" : "GESTIÓN HORARIA"}
        title="Turnos"
        description="Horarios de referencia por turno, tolerancias, reglas de control y empleados asociados."
        action={hasGroups && canCreate ? <Button to="/configuracion/turnos/nuevo" variant="primary"><Plus size={17} /> Crear turno</Button> : undefined}
      />
      {!hasGroups ? (
        <Section title="Turnos de tus grupos">
          <EmptyState icon={CalendarClock} title="Sin grupos de turnos asignados" text="Todavía no tenés grupos de turnos para administrar. Pedile a RRHH que te asigne los grupos que te corresponden (si sos responsable de carga, se heredan de tu supervisor Nivel 2)." />
        </Section>
      ) : <>
      <Tabs
        className="shift-page-tabs"
        ariaLabel="Secciones de turnos"
        idBase={TABS_ID}
        tabs={isRrhh ? VIEWS : SCOPED_VIEWS}
        active={tab}
        onChange={(key) => setTab(viewFromParam(key))}
      />
      <div {...tabPanelProps(TABS_ID, tab)}>
        {tab === "turnos" ? (
          <Section title="Listado de turnos" subtitle={loadStatus === "loading" ? "Cargando turnos..." : `${items.length} turno(s) según filtros aplicados.`}>
            <FilterPanel title="Filtros" search={{ value: search, onChange: setSearch, placeholder: "Código, nombre o categoría" }}>
              <label>Estado<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option><option value="ACTIVO">Activo</option><option value="INACTIVO">Inactivo</option></select></label>
              <label>Grupo<select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}><option value="">Todos</option>{filterGroups.map((group) => <option key={group.id} value={group.id}>{group.status === "ACTIVO" ? group.name : `${group.name} (inactivo)`}</option>)}{isRrhh ? <option value={UNGROUPED_FILTER}>{UNGROUPED_LABEL}</option> : null}</select></label>
            </FilterPanel>
            {loadStatus === "success" && groupsStatus === "error" ? (
              <div className="info-note warning shift-groups-note" role="status">
                <b>No pudimos cargar la lista de grupos.</b>
                <p>Los turnos se muestran con el grupo que ya tienen asignado; los grupos sin turnos no aparecen.</p>
                <Button variant="subtle" onClick={() => setRefresh((value) => value + 1)}>Reintentar</Button>
              </div>
            ) : null}
            {loadStatus === "success" && groupsStatus === "success" && !groups?.length ? (
              <div className="info-note shift-groups-note" role="status">
                <p>{NO_GROUPS_TEXT}</p>
                {isRrhh ? <Button variant="subtle" onClick={() => setTab("grupos")}>Administrar grupos</Button> : null}
              </div>
            ) : null}
            {loadStatus === "loading" ? (
              <LoadingState text="Cargando turnos..." />
            ) : loadStatus === "error" ? (
              <ErrorState message="No pudimos cargar los turnos." onRetry={() => setRefresh((value) => value + 1)} />
            ) : sections.length ? (
              <ShiftGroupSections sections={sections} counts={counts} canEditGroup={canManageGroup} onToggleStatus={toggle} />
            ) : (
              <EmptyState text={filtersActive ? "Ningún turno coincide con los filtros aplicados." : "Todavía no hay turnos configurados."} />
            )}
          </Section>
        ) : tab === "grupos" ? (
          <ShiftGroupsPanel groups={groups} status={groupsStatus} canEdit={isRrhh} onChanged={() => setRefresh((value) => value + 1)} onRetry={() => setRefresh((value) => value + 1)} />
        ) : (
          <ShiftRotationsPanel canEdit={hasGroups && canCreate} groups={groups} groupsStatus={groupsStatus} />
        )}
      </div>
      </>}
    </>
  );
}
