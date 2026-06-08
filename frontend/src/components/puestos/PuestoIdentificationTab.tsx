import type { Position } from "../../types/position.types";
import { PuestoField, PuestoSelect } from "./PuestoFields";

export function PuestoIdentificationTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  const set = (field: keyof Position, value: string) => setPosition({ ...position, [field]: value });
  return <div className="form-grid">
    <PuestoField label="Codigo del puesto" value={position.code || ""} onChange={(value) => set("code", value)} disabled={disabled} />
    <PuestoField label="Nombre del puesto *" value={position.name} onChange={(value) => set("name", value)} disabled={disabled} />
    <PuestoField label="Area / Departamento *" value={position.areaDepartment} onChange={(value) => set("areaDepartment", value)} disabled={disabled} />
    <PuestoField label="Sector *" value={position.sector} onChange={(value) => set("sector", value)} disabled={disabled} />
    <PuestoField label="Reporta a" value={position.reportsTo || ""} onChange={(value) => set("reportsTo", value)} disabled={disabled} />
    <PuestoField label="Supervisa a" value={position.supervises || ""} onChange={(value) => set("supervises", value)} disabled={disabled} />
    <PuestoField label="Ubicacion" value={position.location || ""} onChange={(value) => set("location", value)} disabled={disabled} />
    <PuestoField label="Fecha de actualizacion *" type="date" value={position.lastUpdatedAt} onChange={(value) => set("lastUpdatedAt", value)} disabled={disabled} />
    <PuestoSelect label="Estado *" value={position.status} onChange={(value) => set("status", value)} options={["ACTIVO", "INACTIVO"]} disabled={disabled} />
    <PuestoField label="Empresa" value={position.companyName || ""} onChange={(value) => set("companyName", value)} disabled={disabled} />
    <PuestoField label="Unidad de negocio" value={position.businessUnitName || ""} onChange={(value) => set("businessUnitName", value)} disabled={disabled} />
    <PuestoField label="Establecimiento" value={position.establishmentName || ""} onChange={(value) => set("establishmentName", value)} disabled={disabled} />
    <PuestoField label="Centro de costo sugerido" value={position.suggestedCostCenterName || ""} onChange={(value) => set("suggestedCostCenterName", value)} disabled={disabled} />
    <PuestoField label="Categoria de recibo sugerida" value={position.suggestedReceiptCategoryName || ""} onChange={(value) => set("suggestedReceiptCategoryName", value)} disabled={disabled} />
    <PuestoField label="Categoria interna sugerida" value={position.suggestedInternalCategoryName || ""} onChange={(value) => set("suggestedInternalCategoryName", value)} disabled={disabled} />
  </div>;
}
