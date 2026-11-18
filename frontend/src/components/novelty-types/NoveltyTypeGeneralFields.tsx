import type { NoveltyType } from "../../types/noveltyType.types";
import { issueFor, type NoveltyTypeIssue } from "../../utils/noveltyTypeCoverage";
import { activoInactivoLabel } from "../../utils/status";
import { NoveltyColorField, noveltyKindLabels, noveltyKinds, SelectField, TextAreaField, TextField } from "./NoveltyTypeFields";

const noveltyStatusOptionLabels = { ACTIVO: activoInactivoLabel("ACTIVO"), INACTIVO: activoInactivoLabel("INACTIVO") };

export function NoveltyTypeGeneralFields({ item, setItem, issues, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; issues?: NoveltyTypeIssue[]; disabled?: boolean }) {
  return <div className="form-grid novelty-type-general">
    <TextField label="Nombre de la novedad *" value={item.name} disabled={disabled} error={issueFor(issues, "name")} onChange={(name) => setItem({ ...item, name })} />
    <TextField label="Código interno" value={item.code} readOnly placeholder="Se asigna al guardar" onChange={() => undefined} hint="Identificador interno que asigna el sistema. No define cómo se comporta la novedad." />
    <SelectField label="Categoría" value={item.kind} disabled={disabled} options={noveltyKinds} labels={noveltyKindLabels} onChange={(kind) => setItem({ ...item, kind: kind as NoveltyType["kind"] })} />
    <SelectField label="Estado" value={item.status} disabled={disabled} options={["ACTIVO", "INACTIVO"]} labels={noveltyStatusOptionLabels} onChange={(status) => setItem({ ...item, status: status as NoveltyType["status"] })} />
    <div className="form-wide"><NoveltyColorField value={item.uiColor} previewLabel={item.name} disabled={disabled} onChange={(uiColor) => setItem({ ...item, uiColor })} /></div>
    <div className="novelty-type-field-wide"><TextAreaField label="Descripción funcional *" value={item.description} disabled={disabled} error={issueFor(issues, "description")} onChange={(description) => setItem({ ...item, description })} /></div>
  </div>;
}
