import { Plus, Trash2 } from "lucide-react";
import type { Position, PositionCompetency } from "../../types/position.types";
import { addCompetency } from "./PuestoFields";

export function PuestoCompetenciesTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  const update = (id: string, patch: Partial<PositionCompetency>) => setPosition({ ...position, competencies: position.competencies.map((item) => item.id === id ? { ...item, ...patch } : item) });
  return <div className="position-list-editor">
    <div className="form-actions inline-actions">{!disabled && <button type="button" className="button primary" onClick={() => setPosition({ ...position, competencies: addCompetency(position.competencies) })}><Plus size={15} /> Agregar competencia</button>}</div>
    {position.competencies.map((item) => <div className="position-card-row" key={item.id}><input disabled={disabled} placeholder="Competencia" value={item.name} onChange={(event) => update(item.id, { name: event.target.value })} /><input disabled={disabled} placeholder="Descripcion opcional" value={item.description || ""} onChange={(event) => update(item.id, { description: event.target.value })} /><label className="mini-check"><input disabled={disabled} type="checkbox" checked={item.active} onChange={(event) => update(item.id, { active: event.target.checked })} /> Activa</label>{!disabled && <button type="button" className="icon-button" onClick={() => setPosition({ ...position, competencies: position.competencies.filter((row) => row.id !== item.id) })}><Trash2 size={16} /></button>}</div>)}
  </div>;
}
