import type { NoveltyType } from "../../types/noveltyType.types";
import { NoveltyColorField, noveltyKindLabels, noveltyKinds, SelectField, TextAreaField, TextField } from "./NoveltyTypeFields";
import { activoInactivoLabel } from "../../utils/status";

const noveltyStatusOptionLabels = { ACTIVO: activoInactivoLabel("ACTIVO"), INACTIVO: activoInactivoLabel("INACTIVO") };

export function NoveltyTypeIdentificationTab({ item, setItem, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; disabled?: boolean }) {
  return <div className="form-grid">
    <TextField label="Código interno" value={item.code} disabled onChange={() => undefined} />
    <TextField label="Nombre de la novedad *" value={item.name} disabled={disabled} onChange={(name) => setItem({ ...item, name })} />
    <SelectField label="Categoría" value={item.kind} disabled={disabled} options={noveltyKinds} labels={noveltyKindLabels} onChange={(kind) => setItem({ ...item, kind: kind as NoveltyType["kind"] })} />
    <SelectField label="Estado" value={item.status} disabled={disabled} options={["ACTIVO", "INACTIVO"]} labels={noveltyStatusOptionLabels} onChange={(status) => setItem({ ...item, status: status as NoveltyType["status"] })} />
    <NoveltyColorField value={item.uiColor} disabled={disabled} onChange={(uiColor) => setItem({ ...item, uiColor })} />
    <div className="form-wide"><TextAreaField label="Descripción funcional" value={item.description} disabled={disabled} onChange={(description) => setItem({ ...item, description })} /></div>
    <div className="form-wide"><TextAreaField label="Observaciones internas" value={item.notes || ""} disabled={disabled} onChange={(notes) => setItem({ ...item, notes })} /></div>
  </div>;
}
