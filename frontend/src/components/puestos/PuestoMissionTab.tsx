import type { Position } from "../../types/position.types";
import { PuestoTextarea } from "./PuestoFields";

export function PuestoMissionTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  return <div className="position-tab-pad"><PuestoTextarea label="Proposito / Mision *" value={position.mission} onChange={(mission) => setPosition({ ...position, mission })} disabled={disabled} /></div>;
}
