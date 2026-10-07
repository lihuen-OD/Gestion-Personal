import { MousePointerClick, Pencil, Plus, Power, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import type { OrgStructureEntityType } from "../../types/orgStructure.types";
import { activoInactivoLabel } from "../../utils/status";
import { OrgNodeIcon } from "./OrgNodeIcon";
import { childSummary, orgChildType, orgNodeTypeLabels, orgNodeTypePlurals, PENDING_RELOAD_LABEL, type OrgTreeKind, type OrgTreeNode } from "./orgStructureTree";

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value || "—"}</dd></div>;
}

function EntityFacts({ node }: { node: OrgTreeNode }) {
  const entity = node.entity;
  if (!entity) return null;
  const facts: ReactNode[] = [<Fact key="code" label="Código" value={node.code} />];
  if ("cuit" in entity) facts.push(<Fact key="legal" label="Razón social" value={entity.legalName} />, <Fact key="cuit" label="CUIT" value={entity.cuit} />);
  if ("province" in entity) facts.push(<Fact key="loc" label="Ubicación" value={[entity.locality, entity.department, entity.province].filter(Boolean).join(", ")} />, <Fact key="addr" label="Domicilio" value={[entity.address, entity.streetNumber].filter(Boolean).join(" ")} />);
  facts.push(<Fact key="cc" label="Centros de costo vinculados" value={node.costCenterCount ? String(node.costCenterCount) : "Ninguno"} />);
  if (entity.notes) facts.push(<Fact key="notes" label="Observaciones" value={entity.notes} />);
  return <dl className="org-detail-facts">{facts}</dl>;
}

const emptyHints: Record<OrgTreeKind, string> = {
  ORGANIZATION: "Elegí una empresa, unidad de negocio, sector o área para ver su detalle y administrarlo.",
  LOCATION: "Elegí una zona o un establecimiento para ver su detalle y administrarlo.",
};

// Panel de detalle del nodo seleccionado: datos clave + acciones del nivel.
// "Inactivar" es la baja normal (reversible); "Eliminar" borra un registro
// creado por error y el backend sólo lo permite sin dependencias. Un registro
// de la estructura anterior no recibe elementos nuevos (el backend lo rechaza):
// sólo se edita su código, nombre o estado hasta la limpieza.
export function StructureNodeDetail({
  kind,
  node,
  onEdit,
  onAddChild,
  onToggleStatus,
  onDelete,
  busy,
}: {
  kind: OrgTreeKind;
  node: OrgTreeNode | undefined;
  onEdit: (node: OrgTreeNode) => void;
  onAddChild: (node: OrgTreeNode, childType: OrgStructureEntityType) => void;
  onToggleStatus: (node: OrgTreeNode) => void;
  onDelete: (node: OrgTreeNode) => void;
  busy: boolean;
}) {
  if (!node) {
    return (
      <aside className="org-detail empty" aria-label="Detalle del elemento">
        <MousePointerClick size={22} aria-hidden="true" />
        <b>Seleccioná un elemento</b>
        <p>{emptyHints[kind]}</p>
      </aside>
    );
  }

  const isGroup = node.type === "GROUP";
  const childType = isGroup || node.pendingReload ? undefined : orgChildType[node.type as OrgStructureEntityType];
  const summary = childSummary(node);
  const active = node.status !== "INACTIVO";

  return (
    <aside className="org-detail" aria-label={`Detalle de ${node.name}`}>
      <div className="org-detail-head">
        <OrgNodeIcon type={node.type} size={18} large />
        <div>
          <small>{isGroup ? "Estructura anterior" : orgNodeTypeLabels[node.type]}</small>
          <h4>{node.name}</h4>
        </div>
        {node.status ? <Badge tone={active ? "success" : "neutral"}>{activoInactivoLabel(node.status)}</Badge> : null}
      </div>

      {node.path.length ? (
        <nav className="org-detail-path" aria-label="Ubicación en la estructura">
          {node.path.map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}
        </nav>
      ) : null}

      {node.pendingReload ? (
        <div className="org-detail-note pending" role="note">
          <b>{PENDING_RELOAD_LABEL}</b>
          <p>Pertenece a la estructura anterior. No puede recibir elementos nuevos ni ubicarse en la estructura nueva; se vuelve a cargar y la limpieza controlada lo elimina. Mientras tanto se puede corregir su código, nombre o estado.</p>
        </div>
      ) : null}

      {isGroup ? <p className="org-detail-note">{node.note}</p> : <EntityFacts node={node} />}

      <div className="org-detail-children">
        <small>{isGroup ? "Contenido" : "Dependencias directas"}</small>
        {summary.length ? (
          <div>{summary.map(({ type, count }) => <span key={type} className="org-tree-pill">{count} {count === 1 ? orgNodeTypeLabels[type].toLowerCase() : orgNodeTypePlurals[type]}</span>)}</div>
        ) : (
          <p>Sin elementos dependientes.</p>
        )}
      </div>

      {!isGroup ? (
        <div className="org-detail-actions">
          <Button type="button" variant="primary" icon={Pencil} onClick={() => onEdit(node)}>Editar</Button>
          {childType ? <Button type="button" icon={Plus} onClick={() => onAddChild(node, childType)}>Agregar {orgNodeTypeLabels[childType].toLowerCase()}</Button> : null}
          <Button type="button" icon={Power} disabled={busy} onClick={() => onToggleStatus(node)}>{active ? "Inactivar" : "Activar"}</Button>
          <Button type="button" className="danger-text" icon={Trash2} disabled={busy} onClick={() => onDelete(node)}>Eliminar</Button>
        </div>
      ) : null}
    </aside>
  );
}
