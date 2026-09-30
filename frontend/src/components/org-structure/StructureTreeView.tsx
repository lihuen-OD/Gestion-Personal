import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { SearchInput } from "../ui/SearchInput";
import { StructureTreeNode } from "./StructureTreeNode";
import { collectParentKeys, filterOrgTree, flattenVisible, normalizeSearch, type OrgTreeNode } from "./orgStructureTree";

// Niveles abiertos al cargar: Empresa y Unidad de negocio (se ven los
// establecimientos de cada unidad sin abrir nada a mano).
const INITIAL_OPEN_LEVELS = 2;

function initialExpanded(nodes: OrgTreeNode[], levels: number, depth = 1): string[] {
  if (depth > levels) return [];
  return nodes.flatMap((node) => (node.children.length ? [node.key, ...initialExpanded(node.children, levels, depth + 1)] : []));
}

export function StructureTreeView({ nodes, selectedKey, onSelect, label = "Estructura organizacional" }: { nodes: OrgTreeNode[]; selectedKey: string | null; onSelect: (node: OrgTreeNode) => void; label?: string }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded(nodes, INITIAL_OPEN_LEVELS)));
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const initialized = useRef(nodes.length > 0);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  // El catálogo llega async: la apertura inicial se aplica una sola vez, cuando hay nodos.
  useEffect(() => {
    if (initialized.current || !nodes.length) return;
    initialized.current = true;
    setExpanded(new Set(initialExpanded(nodes, INITIAL_OPEN_LEVELS)));
  }, [nodes]);

  const normalizedQuery = normalizeSearch(query);
  const filtered = useMemo(() => filterOrgTree(nodes, query), [nodes, query]);

  // Buscar abre los ancestros de cada coincidencia (sin cerrar lo que el usuario ya abrió).
  useEffect(() => {
    if (!filtered.expandKeys.length) return;
    setExpanded((current) => new Set([...current, ...filtered.expandKeys]));
  }, [filtered.expandKeys]);

  const rows = useMemo(() => flattenVisible(filtered.nodes, expanded), [filtered.nodes, expanded]);
  const activeKey = rows.some((row) => row.node.key === focusedKey) ? focusedKey : rows.some((row) => row.node.key === selectedKey) ? selectedKey : rows[0]?.node.key ?? null;

  const toggle = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const select = useCallback((node: OrgTreeNode) => {
    setFocusedKey(node.key);
    onSelect(node);
  }, [onSelect]);
  const registerRef = useCallback((key: string, element: HTMLLIElement | null) => {
    if (element) itemRefs.current.set(key, element);
    else itemRefs.current.delete(key);
  }, []);

  const focusRow = (key: string | undefined) => {
    if (!key) return;
    setFocusedKey(key);
    itemRefs.current.get(key)?.focus();
  };

  // Navegación de teclado del patrón ARIA tree: flechas, Home/End, Enter/Espacio.
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = rows.findIndex((row) => row.node.key === activeKey);
    const row = rows[index];
    if (!row) return;
    const isOpen = expanded.has(row.node.key);
    const hasChildren = row.node.children.length > 0;
    switch (event.key) {
      case "ArrowDown": focusRow(rows[index + 1]?.node.key); break;
      case "ArrowUp": focusRow(rows[index - 1]?.node.key); break;
      case "Home": focusRow(rows[0]?.node.key); break;
      case "End": focusRow(rows[rows.length - 1]?.node.key); break;
      case "ArrowRight":
        if (hasChildren && !isOpen) toggle(row.node.key);
        else if (hasChildren) focusRow(rows[index + 1]?.node.key);
        break;
      case "ArrowLeft":
        if (hasChildren && isOpen) toggle(row.node.key);
        else focusRow(row.parentKey ?? undefined);
        break;
      case "Enter":
      case " ":
        select(row.node);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const totalNodes = useMemo(() => {
    const count = (items: OrgTreeNode[]): number => items.reduce((sum, item) => sum + 1 + count(item.children), 0);
    return count(nodes);
  }, [nodes]);

  return (
    <div className="org-tree">
      <div className="org-tree-toolbar">
        <SearchInput placeholder="Buscar por nombre o código" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar en la estructura" />
        <div className="org-tree-toolbar-actions">
          <Button type="button" icon={ChevronsUpDown} onClick={() => setExpanded(new Set(collectParentKeys(filtered.nodes)))}>Expandir todo</Button>
          <Button type="button" icon={ChevronsDownUp} onClick={() => setExpanded(new Set())}>Contraer todo</Button>
        </div>
      </div>
      <p className="org-tree-caption" aria-live="polite">
        {normalizedQuery ? `${filtered.matches} coincidencia${filtered.matches === 1 ? "" : "s"} para “${query.trim()}”` : `${totalNodes} elementos en la estructura`}
      </p>
      {rows.length ? (
        <ul className="org-tree-list" role="tree" aria-label={label} onKeyDown={onKeyDown}>
          {rows.map((row) => (
            <StructureTreeNode
              key={row.node.key}
              row={row}
              expanded={expanded.has(row.node.key)}
              selected={row.node.key === selectedKey}
              focusable={row.node.key === activeKey}
              query={normalizedQuery}
              onToggle={toggle}
              onSelect={select}
              onFocusKey={setFocusedKey}
              registerRef={registerRef}
            />
          ))}
        </ul>
      ) : (
        <EmptyState text={normalizedQuery ? `No hay elementos que coincidan con “${query.trim()}”.` : "Todavía no hay estructura organizacional cargada."} />
      )}
    </div>
  );
}
