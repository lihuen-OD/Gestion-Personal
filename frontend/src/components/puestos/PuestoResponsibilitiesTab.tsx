import { Plus, Trash2 } from "lucide-react";
import type { Position } from "../../types/position.types";
import { addResponsibility } from "./PuestoFields";

export function PuestoResponsibilitiesTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  const update = (id: string, value: string) => setPosition({ ...position, responsibilities: position.responsibilities.map((item) => item.id === id ? { ...item, description: value } : item) });
  const remove = (id: string) => setPosition({ ...position, responsibilities: position.responsibilities.filter((item) => item.id !== id).map((item, index) => ({ ...item, order: index + 1 })) });
  return <div className="position-list-editor">
    <div className="form-actions inline-actions">{!disabled && <button type="button" className="button primary" onClick={() => setPosition({ ...position, responsibilities: addResponsibility(position.responsibilities) })}><Plus size={15} /> Agregar responsabilidad</button>}</div>
    {position.responsibilities.map((item, index) => <div className="position-list-row" key={item.id}><span>{index + 1}</span><textarea disabled={disabled} value={item.description} onChange={(event) => update(item.id, event.target.value)} />{!disabled && <button type="button" className="icon-button" onClick={() => remove(item.id)}><Trash2 size={16} /></button>}</div>)}
    {!position.responsibilities.length && <div className="empty"><span>Todavia no hay responsabilidades cargadas.</span></div>}
  </div>;
}
