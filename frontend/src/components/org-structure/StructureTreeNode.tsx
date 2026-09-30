import { ChevronRight } from "lucide-react";
import { memo, type CSSProperties } from "react";
import { Badge } from "../ui/Badge";
import { activoInactivoLabel } from "../../utils/status";
import { OrgNodeIcon } from "./OrgNodeIcon";
import { normalizeSearch, orgNodeTypeLabels, type OrgTreeNode, type VisibleTreeRow } from "./orgStructureTree";

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  // NFD + quitar diacríticos conserva la longitud de un texto NFC: los índices
  // de la versión normalizada sirven para cortar el texto original.
  const index = normalizeSearch(text).indexOf(query);
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
}

type Props = {
  row: VisibleTreeRow;
  expanded: boolean;
  selected: boolean;
  focusable: boolean;
  query: string;
  onToggle: (key: string) => void;
  onSelect: (node: OrgTreeNode) => void;
  onFocusKey: (key: string) => void;
  registerRef: (key: string, element: HTMLLIElement | null) => void;
};

// Fila del árbol (patrón ARIA "tree" plano: la jerarquía la dan aria-level /
// aria-setsize / aria-posinset). Memoizada: abrir o seleccionar un nodo sólo
// re-renderiza las filas cuyo estado cambió.
export const StructureTreeNode = memo(function StructureTreeNode({ row, expanded, selected, focusable, query, onToggle, onSelect, onFocusKey, registerRef }: Props) {
  const { node, level } = row;
  const hasChildren = node.children.length > 0;
  const inactive = node.status === "INACTIVO";
  const typeLabel = orgNodeTypeLabels[node.type];

  return (
    <li
      ref={(element) => registerRef(node.key, element)}
      role="treeitem"
      aria-level={level}
      aria-setsize={row.setSize}
      aria-posinset={row.position}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      aria-label={`${typeLabel} ${node.name}${node.code ? `, código ${node.code}` : ""}${node.status ? `, ${activoInactivoLabel(node.status)}` : ""}`}
      tabIndex={focusable ? 0 : -1}
      className={`org-tree-item${selected ? " selected" : ""}${inactive ? " inactive" : ""}`}
      style={{ "--depth": level - 1 } as CSSProperties}
      onClick={() => onSelect(node)}
      // Cualquier forma de foco (click en el indicador, Tab, programático) mueve el cursor del teclado a esta fila.
      onFocus={() => onFocusKey(node.key)}
    >
      <span
        className={`org-tree-toggle${expanded ? " open" : ""}${hasChildren ? "" : " leaf"}`}
        aria-hidden="true"
        onClick={(event) => {
          if (!hasChildren) return;
          event.stopPropagation();
          onToggle(node.key);
        }}
      >
        {hasChildren ? <ChevronRight size={14} /> : <i />}
      </span>
      <OrgNodeIcon type={node.type} />
      <span className="org-tree-text">
        <b><Highlight text={node.name} query={query} /></b>
        <small>
          {typeLabel}
          {node.code ? <> · <Highlight text={node.code} query={query} /></> : null}
        </small>
      </span>
      <span className="org-tree-meta">
        {node.placements > 1 ? <span className="org-tree-pill shared" title={`Asociado a ${node.placements} ubicaciones de la estructura`}>{node.placements} ubicaciones</span> : null}
        {hasChildren ? <span className="org-tree-pill" title={`${node.children.length} elementos dependientes`}>{node.children.length}</span> : null}
        {node.status ? <Badge tone={inactive ? "neutral" : "success"}>{activoInactivoLabel(node.status)}</Badge> : null}
      </span>
    </li>
  );
});
