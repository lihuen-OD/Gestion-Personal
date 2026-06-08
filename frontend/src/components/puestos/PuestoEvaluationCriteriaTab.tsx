import { Plus, Trash2 } from "lucide-react";
import type { Position, PositionEvaluationCriterion } from "../../types/position.types";
import { addCriterion } from "./PuestoFields";

export function PuestoEvaluationCriteriaTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  const update = (id: string, patch: Partial<PositionEvaluationCriterion>) => setPosition({ ...position, evaluationCriteria: position.evaluationCriteria.map((item) => item.id === id ? { ...item, ...patch } : item) });
  return <div className="position-list-editor">
    <div className="form-actions inline-actions">{!disabled && <button type="button" className="button primary" onClick={() => setPosition({ ...position, evaluationCriteria: addCriterion(position.evaluationCriteria) })}><Plus size={15} /> Agregar criterio</button>}</div>
    {position.evaluationCriteria.map((item) => <div className="position-criterion-row" key={item.id}><input disabled={disabled} placeholder="Criterio" value={item.name} onChange={(event) => update(item.id, { name: event.target.value })} /><input disabled={disabled} placeholder="Peso" type="number" value={item.weight ?? ""} onChange={(event) => update(item.id, { weight: event.target.value ? Number(event.target.value) : undefined })} /><textarea disabled={disabled} placeholder="Descripcion" value={item.description} onChange={(event) => update(item.id, { description: event.target.value })} /><textarea disabled={disabled} placeholder="Regla opcional" value={item.rule || ""} onChange={(event) => update(item.id, { rule: event.target.value })} /><label className="mini-check"><input disabled={disabled} type="checkbox" checked={item.active} onChange={(event) => update(item.id, { active: event.target.checked })} /> Activo</label>{!disabled && <button type="button" className="icon-button" onClick={() => setPosition({ ...position, evaluationCriteria: position.evaluationCriteria.filter((row) => row.id !== item.id) })}><Trash2 size={16} /></button>}</div>)}
  </div>;
}
