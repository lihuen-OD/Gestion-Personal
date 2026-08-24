import { Plus, Trash2 } from "lucide-react";
import type { Position, PositionRelation } from "../../types/position.types";
import { Button } from "../ui/Button";
import { addRelation } from "./PuestoFields";

function RelationBlock({ title, rows, disabled, onChange }: { title: string; rows: PositionRelation[]; disabled: boolean; onChange: (rows: PositionRelation[]) => void }) {
  const update = (id: string, patch: Partial<PositionRelation>) => onChange(rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  return <div className="position-subpanel"><div className="panel-head compact"><div><h3>{title}</h3><p>Nombre y descripcion opcional.</p></div>{!disabled && <Button type="button" variant="subtle" onClick={() => onChange(addRelation(rows))}><Plus size={15} /> Agregar</Button>}</div>
    <div className="position-relation-list">{rows.map((row) => <div className="position-relation-row" key={row.id}><input disabled={disabled} placeholder="Nombre" value={row.name} onChange={(event) => update(row.id, { name: event.target.value })} /><input disabled={disabled} placeholder="Descripcion opcional" value={row.description || ""} onChange={(event) => update(row.id, { description: event.target.value })} />{!disabled && <button type="button" className="icon-button" onClick={() => onChange(rows.filter((item) => item.id !== row.id))}><Trash2 size={16} /></button>}</div>)}</div>
  </div>;
}

export function PuestoRelationsTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  return <div className="split-panels">
    <RelationBlock title="Relaciones internas" rows={position.internalRelations} disabled={disabled} onChange={(internalRelations) => setPosition({ ...position, internalRelations })} />
    <RelationBlock title="Relaciones externas" rows={position.externalRelations} disabled={disabled} onChange={(externalRelations) => setPosition({ ...position, externalRelations })} />
  </div>;
}
