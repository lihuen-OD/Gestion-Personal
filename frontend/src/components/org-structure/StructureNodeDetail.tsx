import { MousePointerClick, Pencil, Plus, Power } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import type { OrgStructureEntityType } from "../../types/orgStructure.types";
import { activoInactivoLabel } from "../../utils/status";
import { OrgNodeIcon } from "./OrgNodeIcon";
import { childSummary, orgChildType, orgNodeTypeLabels, type OrgTreeNode } from "./orgStructureTree";

const pluralLabels: Record<OrgTreeNode["type"], string> = {
  COMPANY: "empresas",
  BUSINESS_UNIT: "unidades de negocio",
  ESTABLISHMENT: "establecimientos",
  AREA: "áreas",
  SECTOR: "sectores",
  COST_CENTER: "centros de costo",
  UNASSIGNED: "grupos",
};

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value || "—"}</dd></div>;
}

function EntityFacts({ node }: { node: OrgTreeNode }) {
  const entity = node.entity;
  if (!entity) return null;
  const facts: ReactNode[] = [<Fact key="code" label="Código" value={node.code} />];
  if ("cuit" in entity) facts.push(<Fact key="legal" label="Razón social" value={entity.legalName} />, <Fact key="cuit" label="CUIT" value={entity.cuit} />);
  if ("province" in entity) facts.push(<Fact key="loc" label="Ubicación" value={[entity.locality, entity.department, entity.province].filter(Boolean).join(", ")} />, <Fact key="addr" label="Domicilio" value={[entity.address, entity.streetNumber].filter(Boolean).join(" ")} />);
  if ("finnegansCode" in entity) facts.push(<Fact key="fin" label="Código Finnegans" value={entity.finnegansCode} />);
  if (entity.notes) facts.push(<Fact key="notes" label="Observaciones" value={entity.notes} />);
  return <dl className="org-detail-facts">{facts}</dl>;
}

// Panel de detalle del nodo seleccionado: datos clave + acciones del nivel.
// Las acciones reutilizan el editor existente del módulo; no hay baja física
// (la API de estructura no expone DELETE) — "Inactivar" cambia el estado.
export function StructureNodeDetail({
  node,
  onEdit,
  onAddChild,
  onToggleStatus,
  busy,
}: {
  node: OrgTreeNode | undefined;
  onEdit: (node: OrgTreeNode) => void;
  onAddChild: (node: OrgTreeNode, childType: OrgStructureEntityType) => void;
  onToggleStatus: (node: OrgTreeNode) => void;
  busy: boolean;
}) {
  if (!node) {
    return (
      <aside className="org-detail empty" aria-label="Detalle del elemento">
        <MousePointerClick size={22} aria-hidden="true" />
        <b>Seleccioná un elemento</b>
        <p>Elegí una empresa, unidad, establecimiento, área, sector o centro de costo para ver su detalle y administrarlo.</p>
      </aside>
    );
  }

  const childType = node.type === "UNASSIGNED" ? undefined : orgChildType[node.type];
  const summary = childSummary(node);
  const active = node.status !== "INACTIVO";

  return (
    <aside className="org-detail" aria-label={`Detalle de ${node.name}`}>
      <div className="org-detail-head">
        <OrgNodeIcon type={node.type} size={18} large />
        <div>
          <small>{orgNodeTypeLabels[node.type]}</small>
          <h4>{node.name}</h4>
        </div>
        {node.status ? <Badge tone={active ? "success" : "neutral"}>{activoInactivoLabel(node.status)}</Badge> : null}
      </div>

      {node.path.length ? (
        <nav className="org-detail-path" aria-label="Ubicación en la estructura">
          {node.path.map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}
        </nav>
      ) : null}

      {node.type === "UNASSIGNED" ? (
        <p className="org-detail-note">Registros sin una relación padre válida. Seleccioná cada uno y editalo para ubicarlo en la estructura.</p>
      ) : (
        <EntityFacts node={node} />
      )}

      {node.placements > 1 ? <p className="org-detail-note">Este centro de costo está asociado a {node.placements} ubicaciones y aparece en cada una de ellas.</p> : null}

      <div className="org-detail-children">
        <small>Dependencias directas</small>
        {summary.length ? (
          <div>{summary.map(({ type, count }) => <span key={type} className="org-tree-pill">{count} {count === 1 ? orgNodeTypeLabels[type].toLowerCase() : pluralLabels[type]}</span>)}</div>
        ) : (
          <p>Sin elementos dependientes.</p>
        )}
      </div>

      {node.type !== "UNASSIGNED" ? (
        <div className="org-detail-actions">
          <Button type="button" variant="primary" icon={Pencil} onClick={() => onEdit(node)}>Editar</Button>
          {childType ? <Button type="button" icon={Plus} onClick={() => onAddChild(node, childType)}>Agregar {orgNodeTypeLabels[childType].toLowerCase()}</Button> : null}
          <Button type="button" className={active ? "danger-text" : ""} icon={Power} disabled={busy} onClick={() => onToggleStatus(node)}>{active ? "Inactivar" : "Activar"}</Button>
        </div>
      ) : null}
    </aside>
  );
}
