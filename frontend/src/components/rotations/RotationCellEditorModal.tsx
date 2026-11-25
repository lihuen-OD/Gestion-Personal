import { Plus, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { ChoiceGroup } from "../ui/ChoiceGroup";
import { FormActions } from "../ui/FormControls";
import type { ShiftTemplate } from "../../services/api/workforceApiService";
import { blockCrossesMidnight } from "../../utils/shiftRotationGrid";
import { draftTemplateOf, MAX_BLOCKS_PER_DAY, type DraftBlock, type DraftCell } from "../../utils/shiftRotationDraft";
import type { GridCellTarget } from "./RotationCycleGrid";

type DayKind = "SHIFT" | "REST" | "MISSING";

function templateOptionLabel(template: { code: string; name: string; startTime: string; endTime: string }) {
  return `${template.code} · ${template.name} · ${template.startTime}–${template.endTime}${blockCrossesMidnight(template) ? " (+1, termina al día siguiente)" : ""}`;
}

/**
 * Editor de un día de la grilla (R4.8B2). Cambia sólo el borrador: nada se
 * guarda hasta "Guardar versión". Un día de trabajo tiene uno o más bloques
 * (hasta el máximo del contrato) y un descanso no tiene ninguno. Sólo se
 * ofrecen turnos activos del grupo de la rotación; un turno ya cargado que
 * dejó de ser elegible se conserva visible y se pide reemplazarlo.
 */
export function RotationCellEditorModal({ target, cell, templates, groupName, close, onApply }: {
  target: GridCellTarget;
  cell: DraftCell | null;
  /** Turnos elegibles (activos del grupo de la rotación). */
  templates: ShiftTemplate[];
  groupName: string;
  close: () => void;
  onApply: (cell: DraftCell | null) => void;
}) {
  const [kind, setKind] = useState<DayKind>(cell?.kind ?? "MISSING");
  const [blocks, setBlocks] = useState<DraftBlock[]>(() => (cell?.kind === "SHIFT" ? cell.blocks : []));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const baseId = useId();
  const eligible = new Set(templates.map((template) => template.id));
  const noTemplates = !templates.length;

  const chooseKind = (next: DayKind) => {
    setKind(next);
    setErrors({});
    // Al pasar a "Trabaja" sin bloques, se abre el primero para elegir el turno.
    if (next === "SHIFT" && !blocks.length) setBlocks([{ shiftTemplateId: "", template: { code: "", name: "", startTime: "", endTime: "" } }]);
  };

  const setBlockTemplate = (index: number, templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    setBlocks((current) => current.map((block, position) => (position === index ? { shiftTemplateId: templateId, template: template ? draftTemplateOf(template) : block.template } : block)));
    setErrors((current) => ({ ...current, [index]: "" }));
  };

  const addBlock = () => setBlocks((current) => [...current, { shiftTemplateId: "", template: { code: "", name: "", startTime: "", endTime: "" } }]);
  const removeBlock = (index: number) => {
    setBlocks((current) => current.filter((_, position) => position !== index));
    setErrors({});
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (kind === "MISSING") return onApply(null);
    if (kind === "REST") return onApply({ kind: "REST" });
    const nextErrors: Record<number, string> = {};
    blocks.forEach((block, index) => {
      if (!block.shiftTemplateId) nextErrors[index] = `Elegí el turno del bloque ${index + 1}.`;
      else if (!eligible.has(block.shiftTemplateId)) nextErrors[index] = "Este turno ya no está activo en el grupo de la rotación. Elegí otro.";
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !blocks.length) return;
    onApply({ kind: "SHIFT", blocks });
  };

  return (
    <Modal title="Editar día" subtitle={`${target.crewName} · Semana ${target.weekLabel} · ${target.weekdayName}`} close={close} size="wide">
      <form className="form-stack rotation-cell-form" onSubmit={submit} noValidate>
        <ChoiceGroup<DayKind>
          legend="¿Qué hace el equipo este día?"
          columns={3}
          value={kind}
          onChange={chooseKind}
          options={[
            { value: "SHIFT", label: "Trabaja", description: "Uno o más bloques de turno." },
            { value: "REST", label: "Descanso", description: "Día libre del equipo, sin bloques." },
            { value: "MISSING", label: "Sin configurar", description: "Queda pendiente. La versión no se puede guardar con días sin configurar." },
          ]}
        />
        {kind === "SHIFT" ? (
          <fieldset className="rotation-cell-blocks">
            <legend>Bloques del día</legend>
            {noTemplates ? (
              <p className="field-error" role="alert">No hay turnos activos en el grupo «{groupName}». Creá o activá turnos en la pantalla Turnos para poder usarlos en la grilla.</p>
            ) : (
              <p className="field-hint">Sólo se ofrecen turnos activos del grupo «{groupName}». Un turno que termina al día siguiente se marca con +1 y pertenece a este día.</p>
            )}
            <ol className="rotation-cell-block-list">
              {blocks.map((block, index) => {
                const id = `${baseId}-block-${index}`;
                const current = block.shiftTemplateId && !eligible.has(block.shiftTemplateId) ? block : null;
                const error = errors[index];
                return (
                  <li key={index} className="rotation-cell-block-row">
                    <div className="field-stack">
                      <label htmlFor={id}>Bloque {index + 1}</label>
                      <select id={id} value={block.shiftTemplateId} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} data-modal-initial-focus={index === 0 ? true : undefined} onChange={(event) => setBlockTemplate(index, event.target.value)}>
                        <option value="">Elegí un turno</option>
                        {current ? <option value={current.shiftTemplateId}>{templateOptionLabel(current.template)} (no disponible)</option> : null}
                        {templates.map((template) => <option key={template.id} value={template.id}>{templateOptionLabel(template)}</option>)}
                      </select>
                      {error ? <small id={`${id}-error`} className="field-error" role="alert">{error}</small> : null}
                    </div>
                    <button type="button" className="table-icon-action danger-link rotation-cell-remove" title={`Quitar bloque ${index + 1}`} aria-label={`Quitar bloque ${index + 1}`} disabled={blocks.length <= 1} onClick={() => removeBlock(index)}>
                      <Trash2 size={14} /><span>Quitar bloque {index + 1}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <Button type="button" variant="subtle" onClick={addBlock} disabled={blocks.length >= MAX_BLOCKS_PER_DAY || noTemplates}>
              <Plus size={16} /> Agregar bloque
            </Button>
            {blocks.length >= MAX_BLOCKS_PER_DAY ? <p className="field-hint">Un día admite hasta {MAX_BLOCKS_PER_DAY} bloques.</p> : null}
          </fieldset>
        ) : null}
        <p className="field-hint rotation-cell-save-hint">El cambio se aplica al borrador. Se guarda junto con toda la grilla al presionar «Guardar versión».</p>
        <FormActions>
          <Button type="button" onClick={close}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={kind === "SHIFT" && noTemplates}>Aplicar</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
