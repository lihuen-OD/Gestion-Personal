import { Plus, Trash2 } from "lucide-react";
import type { Position, PositionIndicator } from "../../types/position.types";
import { addIndicator } from "./PuestoFields";

export function PuestoIndicatorsTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  const update = (id: string, patch: Partial<PositionIndicator>) => setPosition({ ...position, performanceIndicators: position.performanceIndicators.map((item) => item.id === id ? { ...item, ...patch } : item) });
  return <div className="position-list-editor">
    <div className="form-actions inline-actions">{!disabled && <button type="button" className="button primary" onClick={() => setPosition({ ...position, performanceIndicators: addIndicator(position.performanceIndicators) })}><Plus size={15} /> Agregar indicador</button>}</div>
    {position.performanceIndicators.map((item) => <div className="position-card-row" key={item.id}><input disabled={disabled} placeholder="Indicador" value={item.name} onChange={(event) => update(item.id, { name: event.target.value })} /><input disabled={disabled} placeholder="Descripcion" value={item.description || ""} onChange={(event) => update(item.id, { description: event.target.value })} /><input disabled={disabled} placeholder="Meta o referencia" value={item.target || ""} onChange={(event) => update(item.id, { target: event.target.value })} /><label className="mini-check"><input disabled={disabled} type="checkbox" checked={item.active} onChange={(event) => update(item.id, { active: event.target.checked })} /> Activo</label>{!disabled && <button type="button" className="icon-button" onClick={() => setPosition({ ...position, performanceIndicators: position.performanceIndicators.filter((row) => row.id !== item.id) })}><Trash2 size={16} /></button>}</div>)}
  </div>;
}
