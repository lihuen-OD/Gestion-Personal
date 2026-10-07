import { useEffect, useState } from "react";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";
import type { OrgStructureCatalog } from "../../types/orgStructure.types";
import type { Position, PositionOrgScope, PositionOrgScopeLevel } from "../../types/position.types";
import { PuestoField, PuestoSelect } from "./PuestoFields";
import { activoInactivoLabel } from "../../utils/status";
import { orgScopeLineage } from "../org-structure/orgScopePath";

const statusOptionLabels: Record<string, string> = { ACTIVO: activoInactivoLabel("ACTIVO"), INACTIVO: activoInactivoLabel("INACTIVO") };

const levelLabels: Record<PositionOrgScopeLevel, string> = { COMPANY: "Empresa", BUSINESS_UNIT: "Unidad de negocio", SECTOR: "Sector", AREA: "Área" };

export function scopeRedundancyMessage(catalog: OrgStructureCatalog, scopes: PositionOrgScope[], candidate: PositionOrgScope) {
  const candidatePath = orgScopeLineage(catalog, candidate);
  for (const current of scopes) {
    if (current.level === candidate.level && current.nodeId === candidate.nodeId) return `“${candidate.name}” ya está seleccionado.`;
    const currentPath = orgScopeLineage(catalog, current);
    const currentCoversCandidate = current.nodeId === (current.level === "COMPANY" ? candidatePath.companyId : current.level === "BUSINESS_UNIT" ? candidatePath.businessUnitId : current.level === "SECTOR" ? candidatePath.sectorId : candidatePath.areaId);
    if (currentCoversCandidate) return `No selecciones “${candidate.name}”: ya está incluido por “${current.name}”.`;
    const candidateCoversCurrent = candidate.nodeId === (candidate.level === "COMPANY" ? currentPath.companyId : candidate.level === "BUSINESS_UNIT" ? currentPath.businessUnitId : candidate.level === "SECTOR" ? currentPath.sectorId : currentPath.areaId);
    if (candidateCoversCurrent) return `No selecciones “${candidate.name}”: haría redundante “${current.name}”, que ya está incluido.`;
  }
  return "";
}

export function PuestoIdentificationTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  const [catalog, setCatalog] = useState<OrgStructureCatalog | undefined>(undefined);
  const [level, setLevel] = useState<PositionOrgScopeLevel>("COMPANY");
  const [nodeId, setNodeId] = useState("");
  const [scopeError, setScopeError] = useState("");

  useEffect(() => {
    let mounted = true;
    orgStructureApiService.getCatalog()
      .then((data) => { if (mounted) setCatalog(data); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const set = (field: keyof Position, value: string) => setPosition({ ...position, [field]: value });
  const entries = level === "COMPANY" ? catalog?.companies : level === "BUSINESS_UNIT" ? catalog?.businessUnits : level === "SECTOR" ? catalog?.sectors.filter((item) => item.businessUnitId) : catalog?.areas.filter((item) => item.sectorId);
  const options = (entries || []).filter((item) => item.status === "ACTIVO").sort((a, b) => a.name.localeCompare(b.name, "es"));
  const addScope = () => {
    if (!catalog || !nodeId) return setScopeError("Seleccioná un nodo organizacional.");
    const node = options.find((item) => item.id === nodeId);
    if (!node) return setScopeError("El nodo seleccionado ya no está disponible.");
    const candidate: PositionOrgScope = { level, nodeId, code: node.code, name: node.name, status: node.status };
    const redundancy = scopeRedundancyMessage(catalog, position.orgScopes || [], candidate);
    if (redundancy) return setScopeError(redundancy);
    setPosition({ ...position, orgScopes: [...(position.orgScopes || []), candidate], pendingScopeReload: false });
    setNodeId(""); setScopeError("");
  };

  return <div className="form-grid">
    <PuestoField label="Nombre del puesto *" value={position.name} onChange={(value) => set("name", value)} disabled={disabled} />
    <PuestoField label="Codigo del puesto" value={position.code || "Se genera automaticamente al guardar"} onChange={() => undefined} disabled />
    <PuestoField label="Fecha de actualizacion *" type="date" value={position.lastUpdatedAt} onChange={(value) => set("lastUpdatedAt", value)} disabled={disabled} />
    <PuestoSelect label="Estado *" value={position.status} onChange={(value) => set("status", value)} options={["ACTIVO", "INACTIVO"]} labels={statusOptionLabels} disabled={disabled} />
    <div className="form-wide position-scope-editor">
      <div className="position-scope-heading"><div><strong>Alcance organizacional *</strong><small>Cada nodo incluye todos sus descendientes. Podés combinar alcances independientes.</small></div></div>
      {position.pendingScopeReload && <div className="position-scope-warning">Pendiente de recarga: este puesto conserva su sector anterior y todavía no tiene alcance organizacional. No se convertirá automáticamente.</div>}
      <div className="position-scope-shared">Este alcance será compartido por todos los legajos que tengan asignado este puesto. Editarlo afecta la definición común del puesto, no crea variantes.</div>
      {!disabled && <div className="position-scope-picker">
        <label>Nivel<select value={level} onChange={(event) => { setLevel(event.target.value as PositionOrgScopeLevel); setNodeId(""); setScopeError(""); }}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Nodo<select value={nodeId} onChange={(event) => { setNodeId(event.target.value); setScopeError(""); }}><option value="">Seleccionar</option>{options.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <button className="button button-subtle" type="button" onClick={addScope}>Agregar alcance</button>
      </div>}
      {scopeError && <p className="error position-scope-error">{scopeError}</p>}
      <div className="position-scope-list">{(position.orgScopes || []).length ? (position.orgScopes || []).map((scope) => <div className="position-scope-item" key={`${scope.level}:${scope.nodeId}`}><span><small>{levelLabels[scope.level]}</small><b>{scope.code ? `${scope.code} · ` : ""}{scope.name}</b></span>{!disabled && <button type="button" aria-label={`Quitar ${scope.name}`} onClick={() => setPosition({ ...position, orgScopes: position.orgScopes?.filter((item) => item.level !== scope.level || item.nodeId !== scope.nodeId) })}>Quitar</button>}</div>) : <p className="position-muted">Sin alcances cargados.</p>}</div>
    </div>
  </div>;
}
