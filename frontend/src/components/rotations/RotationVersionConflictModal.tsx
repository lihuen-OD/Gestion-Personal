import { useMemo } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormControls";
import type { ShiftRotationCrew, ShiftRotationVersion } from "../../services/api/shiftRotationApiService";
import { rotationCycleLabel } from "../../utils/shiftRotation";
import { buildGridModel, versionRangeText } from "../../utils/shiftRotationGrid";
import { RotationCycleGrid } from "./RotationCycleGrid";

/**
 * Conflicto de edición (409 ROTATION_VERSION_STALE): muestra la versión tal
 * como quedó guardada por otra persona, para comparar antes de decidir. El
 * borrador no se toca hasta que RRHH elige una de las dos opciones.
 */
export function RotationVersionConflictModal({ current, crews, close, onKeepMine, onUseCurrent }: {
  current: ShiftRotationVersion;
  crews: ShiftRotationCrew[];
  close: () => void;
  onKeepMine: () => void;
  onUseCurrent: () => void;
}) {
  const sections = useMemo(() => buildGridModel(current, crews), [current, crews]);
  return (
    <Modal title="Versión modificada por otra persona" subtitle={`Así quedó guardada: vigente ${versionRangeText(current)}, ciclo de ${rotationCycleLabel(current.cycleLengthWeeks)}.`} close={close} size="wide">
      <div className="rotation-conflict-body">
        <p>Compará con tu borrador. Si conservás tus cambios, al guardar van a reemplazar esta versión. Si usás esta versión, se descartan los cambios que hiciste.</p>
        <RotationCycleGrid sections={sections} caption={`Versión guardada ${versionRangeText(current)}`} />
        <FormActions>
          <Button type="button" variant="danger" onClick={onUseCurrent}>Descartar mis cambios y usar esta</Button>
          <Button type="button" variant="primary" onClick={onKeepMine} data-modal-initial-focus>Conservar mis cambios</Button>
        </FormActions>
      </div>
    </Modal>
  );
}
