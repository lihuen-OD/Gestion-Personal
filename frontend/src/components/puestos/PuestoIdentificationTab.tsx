import type { Position } from "../../types/position.types";
import { useStructureSelectOptions } from "../employees/options/structureOptions";
import { PuestoField, PuestoSelect } from "./PuestoFields";

export function PuestoIdentificationTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  const set = (field: keyof Position, value: string) => setPosition({ ...position, [field]: value });
  const options = useStructureSelectOptions({
    businessUnit: position.businessUnitName || "",
    establishment: position.establishmentName || "",
    area: position.areaDepartment,
    sector: position.sector,
  });
  return <div className="form-grid">
    <PuestoField label="Nombre del puesto *" value={position.name} onChange={(value) => set("name", value)} disabled={disabled} />
    <PuestoSelect label="Unidad de negocio" value={position.businessUnitName || ""} onChange={(value) => set("businessUnitName", value)} options={["", ...options.businessUnit]} disabled={disabled} />
    <PuestoSelect label="Establecimiento" value={position.establishmentName || ""} onChange={(value) => set("establishmentName", value)} options={["", ...options.establishment]} disabled={disabled} />
    <PuestoSelect label="Area / Departamento *" value={position.areaDepartment} onChange={(value) => set("areaDepartment", value)} options={["", ...options.area]} disabled={disabled} />
    <PuestoSelect label="Sector *" value={position.sector} onChange={(value) => set("sector", value)} options={["", ...options.sector]} disabled={disabled} />
    <PuestoField label="Codigo del puesto" value={position.code || "Se genera automaticamente al guardar"} onChange={() => undefined} disabled />
    <PuestoField label="Fecha de actualizacion *" type="date" value={position.lastUpdatedAt} onChange={(value) => set("lastUpdatedAt", value)} disabled={disabled} />
    <PuestoSelect label="Estado *" value={position.status} onChange={(value) => set("status", value)} options={["ACTIVO", "INACTIVO"]} disabled={disabled} />
  </div>;
}
