import type { NoveltyType } from "../../types/noveltyType.types";
import { noveltyKinds, SelectField, TextAreaField, TextField } from "./NoveltyTypeFields";

export function NoveltyTypeIdentificationTab({ item, setItem, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; disabled?: boolean }) {
  return <div className="form-grid">
    <TextField label="Código interno" value={item.code} disabled onChange={() => undefined} />
    <TextField label="Nombre de la novedad *" value={item.name} disabled={disabled} onChange={(name) => setItem({ ...item, name })} />
    <SelectField label="Tipo" value={item.kind} disabled={disabled} options={noveltyKinds} onChange={(kind) => setItem({ ...item, kind: kind as NoveltyType["kind"] })} />
    <SelectField label="Estado" value={item.status} disabled={disabled} options={["ACTIVO", "INACTIVO"]} onChange={(status) => setItem({ ...item, status: status as NoveltyType["status"] })} />
    <div className="form-wide"><TextAreaField label="Descripción funcional" value={item.description} disabled={disabled} onChange={(description) => setItem({ ...item, description })} /></div>
    <div className="form-wide"><TextAreaField label="Observaciones internas" value={item.notes || ""} disabled={disabled} onChange={(notes) => setItem({ ...item, notes })} /></div>
  </div>;
}
