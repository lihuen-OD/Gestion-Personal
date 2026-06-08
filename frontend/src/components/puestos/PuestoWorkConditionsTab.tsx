import type { Position, WorkModality } from "../../types/position.types";
import { modalityOptions, PuestoField, PuestoSelect, PuestoTextarea } from "./PuestoFields";

export function PuestoWorkConditionsTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  const set = (patch: Partial<Position["workConditions"]>) => setPosition({ ...position, workConditions: { ...position.workConditions, ...patch } });
  return <div className="form-grid">
    <PuestoSelect label="Modalidad" value={position.workConditions.modality} onChange={(value) => set({ modality: value as WorkModality })} options={modalityOptions} disabled={disabled} />
    <PuestoField label="Carga horaria" value={position.workConditions.workload} onChange={(value) => set({ workload: value })} disabled={disabled} />
    <PuestoField label="Lugar de trabajo" value={position.workConditions.workplace} onChange={(value) => set({ workplace: value })} disabled={disabled} />
    <PuestoField label="Tipo de relacion" value={position.workConditions.relationType} onChange={(value) => set({ relationType: value })} disabled={disabled} />
    <PuestoTextarea label="Observaciones" value={position.workConditions.observations || ""} onChange={(value) => set({ observations: value })} disabled={disabled} />
  </div>;
}
