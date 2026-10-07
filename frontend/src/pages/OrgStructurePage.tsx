import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { DataTable } from "../components/ui/DataTable";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { StructureTreeView } from "../components/org-structure/StructureTreeView";
import { StructureNodeDetail } from "../components/org-structure/StructureNodeDetail";
import { OrgStructureEditor, editorValidationError } from "../components/org-structure/OrgStructureEditor";
import { OrgStructureTable } from "../components/org-structure/OrgStructureTable";
import { buildLocationTree, buildOrganizationTree, findNode, orgNodeTypeLabels, type OrgTreeKind, type OrgTreeNode } from "../components/org-structure/orgStructureTree";
import { blankEntity, catalogListKey, deletedMessages, itemsOf, newButtonLabels, orgSections, orgTypeTabLabels, savedMessages, sectionOf, type OrgSectionKey } from "../components/org-structure/orgStructureEntities";
import { confirmAction } from "../services/appDialog";
import { ApiError, getUserErrorMessage } from "../services/api/apiClient";
import { useAuth } from "../context/AuthContext";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { subscribeCacheEvent } from "../services/cache";
import type { Role } from "../types";
import type { OrgArea, OrgBusinessUnit, OrgCompany, OrgCostCenter, OrgEstablishment, OrgSector, OrgStructureCatalog, OrgStructureEntity, OrgStructureEntityType, OrgZone } from "../types/orgStructure.types";
import { useAsyncAction } from "../utils/useAsyncAction";

type View = "tree" | "table";
type Editing = { type: OrgStructureEntityType; item: OrgStructureEntity; isNew: boolean };

const views: Array<{ key: View; label: string }> = [
  { key: "tree", label: "Vista árbol" },
  { key: "table", label: "Vista tabla" },
];

const emptyCatalog: OrgStructureCatalog = { companies: [], businessUnits: [], sectors: [], areas: [], zones: [], establishments: [], costCenters: [] };

// Tras un DELETE exitoso el registro se quita del catálogo en memoria antes de
// que llegue el refetch. Es seguro porque el backend sólo borra registros sin
// dependencias (nada en el catálogo lo referencia).
function withoutEntity(catalog: OrgStructureCatalog, type: OrgStructureEntityType, id: string): OrgStructureCatalog {
  const key = catalogListKey[type];
  return { ...catalog, [key]: (catalog[key] as OrgStructureEntity[]).filter((item) => item.id !== id) };
}

const roleLevel = (role: Role) => role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3;

// Los errores 400/409/422 de escritura (padre inválido, registro anterior,
// nodo en uso, dependencias) los muestra el aviso global de la app con el
// motivo del backend: acá no se duplican.
const shownGlobally = (error: unknown) => error instanceof ApiError && [400, 409, 422].includes(error.status);

async function persist(type: OrgStructureEntityType, item: OrgStructureEntity, isNew: boolean) {
  const api = orgStructureApiService;
  if (type === "COMPANY") return isNew ? api.createCompany(item as OrgCompany) : api.updateCompany(item as OrgCompany);
  if (type === "BUSINESS_UNIT") return isNew ? api.createBusinessUnit(item as OrgBusinessUnit) : api.updateBusinessUnit(item as OrgBusinessUnit);
  if (type === "SECTOR") return isNew ? api.createSector(item as OrgSector) : api.updateSector(item as OrgSector);
  if (type === "AREA") return isNew ? api.createArea(item as OrgArea) : api.updateArea(item as OrgArea);
  if (type === "ZONE") return isNew ? api.createZone(item as OrgZone) : api.updateZone(item as OrgZone);
  if (type === "ESTABLISHMENT") return isNew ? api.createEstablishment(item as OrgEstablishment) : api.updateEstablishment(item as OrgEstablishment);
  return isNew ? api.createCostCenter(item as OrgCostCenter) : api.updateCostCenter(item as OrgCostCenter);
}

export function OrgStructurePage() {
  const { user } = useAuth();
  const [section, setSection] = useState<OrgSectionKey>("ORGANIZATION");
  const [view, setView] = useState<View>("tree");
  const [tabByType, setTabByType] = useState<Record<OrgSectionKey, OrgStructureEntityType>>({ ORGANIZATION: "COMPANY", LOCATION: "ZONE", COST_CENTERS: "COST_CENTER" });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [apiCatalog, setApiCatalog] = useState<OrgStructureCatalog | null>(null);
  const [isLoadingApi, setIsLoadingApi] = useState(true);
  const [apiWarning, setApiWarning] = useState("");
  const [selectedKey, setSelectedKey] = useState<Record<OrgTreeKind, string | null>>({ ORGANIZATION: null, LOCATION: null });

  useEffect(() => subscribeCacheEvent("updated", (event) => {
    if (event.family === "org-structure") setRefresh((value) => value + 1);
  }), []);

  useEffect(() => {
    let alive = true;
    setIsLoadingApi(true);
    orgStructureApiService.getCatalog()
      .then((value) => {
        if (!alive) return;
        setApiCatalog(value);
        setApiWarning("");
      })
      .catch(() => {
        if (!alive) return;
        setApiCatalog(null);
        setApiWarning("No pudimos cargar la estructura. Reintentá en unos minutos; mientras tanto no se pueden guardar cambios.");
      })
      .finally(() => {
        if (alive) setIsLoadingApi(false);
      });
    return () => { alive = false; };
  }, [refresh]);

  const catalog = useMemo(() => apiCatalog ?? emptyCatalog, [apiCatalog]);
  const trees = useMemo(() => ({ ORGANIZATION: buildOrganizationTree(catalog), LOCATION: buildLocationTree(catalog) }), [catalog]);
  const treeKind: OrgTreeKind | null = section === "COST_CENTERS" ? null : section;
  const selectedNode = useMemo(() => (treeKind ? findNode(trees[treeKind], selectedKey[treeKind]) : undefined), [trees, treeKind, selectedKey]);
  const pendingReload = catalog.sectors.filter((item) => item.pendingReload).length + catalog.areas.filter((item) => item.pendingReload).length + catalog.establishments.filter((item) => item.pendingReload).length;
  const counts = [
    { label: "Empresas", value: catalog.companies.length, detail: `${catalog.businessUnits.length} unidades de negocio` },
    { label: "Sectores y áreas", value: catalog.sectors.filter((item) => !item.pendingReload).length + catalog.areas.filter((item) => !item.pendingReload).length, detail: "Estructura nueva" },
    { label: "Zonas", value: catalog.zones.length, detail: `${catalog.establishments.filter((item) => !item.pendingReload).length} establecimientos nuevos` },
    { label: "Pendientes de recarga", value: pendingReload, detail: "Estructura anterior" },
  ];

  const flashNotice = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 2200);
  };

  const editorRef = useRef<HTMLDivElement>(null);
  const openEditor = useCallback((type: OrgStructureEntityType, item: OrgStructureEntity, isNew: boolean) => {
    setSection(sectionOf(type));
    setTabByType((current) => ({ ...current, [sectionOf(type)]: type }));
    setEditing({ type, item, isNew });
    requestAnimationFrame(() => editorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  }, []);

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!editing) return;
    const invalid = editorValidationError(editing.type, editing.item);
    if (invalid) return setNotice(invalid);
    if (!apiCatalog) return setNotice("No se puede guardar sin la estructura cargada.");
    try {
      await persist(editing.type, editing.item, editing.isNew);
      setRefresh((value) => value + 1);
      setEditing(null);
      flashNotice(savedMessages[editing.type]);
    } catch (error) {
      if (!shownGlobally(error)) setNotice(getUserErrorMessage(error, "No se pudo guardar. Intentá nuevamente."));
    }
  });

  const { isRunning: isTogglingStatus, run: toggleNodeStatus } = useAsyncAction(async (node: OrgTreeNode) => {
    if (!node.entity || node.type === "GROUP") return;
    const activating = node.status === "INACTIVO";
    const typeLabel = orgNodeTypeLabels[node.type].toLowerCase();
    const confirmed = await confirmAction(`¿Querés ${activating ? "activar" : "inactivar"} ${typeLabel} “${node.name}”? Los elementos dependientes no se modifican.`, { title: `${activating ? "Activar" : "Inactivar"} ${typeLabel}`, confirmLabel: activating ? "Activar" : "Inactivar", tone: activating ? "primary" : "danger" });
    if (!confirmed) return;
    try {
      await persist(node.type, { ...node.entity, status: activating ? "ACTIVO" : "INACTIVO" } as OrgStructureEntity, false);
      setRefresh((value) => value + 1);
      flashNotice(`${node.name} quedó ${activating ? "activo" : "inactivo"}.`);
    } catch (error) {
      if (!shownGlobally(error)) setNotice(getUserErrorMessage(error, "No se pudo cambiar el estado. Intentá nuevamente."));
    }
  });

  // Eliminar (árbol y tabla comparten este flujo): confirmación explícita y
  // borrado definitivo sólo si el backend no encuentra dependencias.
  const { isRunning: isDeleting, run: removeEntity } = useAsyncAction(async (type: OrgStructureEntityType, item: OrgStructureEntity) => {
    const confirmed = await confirmAction("Esta acción elimina el registro de forma permanente y no se puede deshacer. Si sólo ya no debe utilizarse, inactivalo.", {
      title: `¿Eliminar definitivamente “${item.name}”?`,
      confirmLabel: "Eliminar definitivamente",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await orgStructureApiService.deleteEntity(type, item.id);
      setApiCatalog((current) => (current ? withoutEntity(current, type, item.id) : current));
      setSelectedKey((current) => ({ ORGANIZATION: findNode(trees.ORGANIZATION, current.ORGANIZATION)?.id === item.id ? null : current.ORGANIZATION, LOCATION: findNode(trees.LOCATION, current.LOCATION)?.id === item.id ? null : current.LOCATION }));
      setEditing((current) => (current?.item.id === item.id ? null : current));
      setRefresh((value) => value + 1);
      flashNotice(deletedMessages[type]);
    } catch (error) {
      if (!shownGlobally(error)) setNotice(getUserErrorMessage(error, "No se pudo eliminar el registro. Intentá nuevamente."));
    }
  });

  const editNode = useCallback((node: OrgTreeNode) => {
    if (node.entity && node.type !== "GROUP") openEditor(node.type, node.entity, false);
  }, [openEditor]);
  const deleteNode = useCallback((node: OrgTreeNode) => {
    if (node.entity && node.type !== "GROUP") void removeEntity(node.type, node.entity);
  }, [removeEntity]);
  const addChild = (node: OrgTreeNode, childType: OrgStructureEntityType) => openEditor(childType, blankEntity(childType, catalog, node.id), true);
  const selectNode = useCallback((node: OrgTreeNode) => setSelectedKey((current) => (treeKind ? { ...current, [treeKind]: node.key } : current)), [treeKind]);

  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;

  const sectionConfig = orgSections.find((item) => item.key === section)!;
  const tab = tabByType[section];
  const rootType: OrgStructureEntityType = section === "ORGANIZATION" ? "COMPANY" : section === "LOCATION" ? "ZONE" : "COST_CENTER";
  const effectiveView: View = section === "COST_CENTERS" ? "table" : view;
  const activeRows = itemsOf(catalog, tab);
  const newType = effectiveView === "tree" ? rootType : tab;

  return <>
    <PageHeader
      eyebrow="CONFIGURACION"
      title="Empresas y estructura"
      description="Organización y ubicaciones se administran por separado. Alimentan puestos, legajos, filtros, organigrama y reportes."
      action={<Button variant="primary" icon={Plus} onClick={() => openEditor(newType, blankEntity(newType, catalog), true)}>{newButtonLabels[newType]}</Button>}
    />
    {notice && <div className="toast">{notice}</div>}
    {apiWarning && <div className="info-note compact"><b>Sin conexión con la estructura</b><p>{apiWarning}</p></div>}
    {pendingReload > 0 && <div className="info-note compact"><b>Estructura en transición</b><p>{pendingReload} registros de la estructura anterior figuran como <b>pendientes de recarga</b>. No reciben elementos nuevos ni se reubican: cargá la estructura nueva y la limpieza controlada los eliminará más adelante.</p></div>}
    <div className="stat-grid org-structure-summary">{counts.map((item) => <StatCard key={item.label} label={item.label} value={item.value} detail={item.detail} />)}</div>

    <Tabs className="org-section-switch" tabs={orgSections.map((item) => ({ key: item.key, label: item.label }))} active={section} onChange={(key) => { setSection(key as OrgSectionKey); setEditing(null); }} />

    {treeKind && effectiveView === "tree" ? (
      <Section
        title={sectionConfig.label}
        subtitle={isLoadingApi ? "Cargando estructura..." : sectionConfig.subtitle}
        action={<Tabs className="view-switch" tabs={views} active={view} onChange={(key) => setView(key as View)} />}
      >
        {isLoadingApi && !apiCatalog ? <LoadingState variant="table" rows={6} columns={3} /> : (
          <div className="org-tree-layout">
            <StructureTreeView
              key={treeKind}
              nodes={trees[treeKind]}
              selectedKey={selectedKey[treeKind]}
              onSelect={selectNode}
              label={treeKind === "ORGANIZATION" ? "Organización" : "Ubicaciones"}
              emptyText={treeKind === "ORGANIZATION" ? "Todavía no hay empresas cargadas." : "Todavía no hay zonas cargadas. Creá una zona para empezar a cargar establecimientos."}
            />
            <StructureNodeDetail kind={treeKind} node={selectedNode} onEdit={editNode} onAddChild={addChild} onToggleStatus={toggleNodeStatus} onDelete={deleteNode} busy={isTogglingStatus || isDeleting} />
          </div>
        )}
      </Section>
    ) : (
      <>
        {sectionConfig.types.length > 1 && <Tabs tabs={sectionConfig.types.map((type) => ({ key: type, label: orgTypeTabLabels[type] }))} active={tab} onChange={(key) => { setTabByType((current) => ({ ...current, [section]: key as OrgStructureEntityType })); setEditing(null); }} />}
        <Section
          title={orgTypeTabLabels[tab]}
          subtitle={isLoadingApi ? "Cargando estructura..." : sectionConfig.subtitle}
          action={treeKind ? <Tabs className="view-switch" tabs={views} active={view} onChange={(key) => setView(key as View)} /> : undefined}
        >
          <DataTable status={isLoadingApi ? "loading" : activeRows.length === 0 ? "empty" : "ready"} minWidth={940} emptyText="No hay registros cargados para esta categoría.">
            <OrgStructureTable key={tab} type={tab} catalog={catalog} items={activeRows} onEdit={(item) => openEditor(tab, item, false)} onDelete={(item) => void removeEntity(tab, item)} />
          </DataTable>
        </Section>
      </>
    )}

    {editing && (
      <div ref={editorRef} className="org-editor-anchor">
        <Section
          title={editing.isNew ? `Nuevo registro · ${orgNodeTypeLabels[editing.type]}` : `Editar ${orgNodeTypeLabels[editing.type].toLowerCase()}`}
          subtitle="Los cambios quedan disponibles para los módulos conectados."
          action={<div className="table-actions"><Button type="button" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar"}</Button></div>}
        >
          <OrgStructureEditor type={editing.type} item={editing.item} catalog={catalog} isNew={editing.isNew} onChange={(item) => setEditing((current) => (current ? { ...current, item } : current))} />
        </Section>
      </div>
    )}
  </>;
}
