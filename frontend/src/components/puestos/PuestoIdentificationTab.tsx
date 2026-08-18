import { useEffect, useState } from "react";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";
import type { OrgStructureCatalog } from "../../types/orgStructure.types";
import type { Position } from "../../types/position.types";
import { PuestoDerivedField, PuestoField, PuestoIdSelect, PuestoSelect } from "./PuestoFields";

/**
 * Cadena derivada sector -> area -> establishment -> businessUnit -> company,
 * calculada en vivo contra el catalogo real de Estructura Organizacional.
 * Desde el saneamiento de Puestos (2026-08-18), sectorId es la unica fuente
 * oficial de ubicacion; el resto se muestra de solo lectura.
 */
function deriveChain(catalog: OrgStructureCatalog | undefined, sectorId: string | undefined) {
  if (!catalog || !sectorId) return { area: "", establishment: "", businessUnit: "", company: "" };
  const sector = catalog.sectors.find((item) => item.id === sectorId);
  const area = sector?.areaId ? catalog.areas.find((item) => item.id === sector.areaId) : undefined;
  const establishment = area?.establishmentId ? catalog.establishments.find((item) => item.id === area.establishmentId) : undefined;
  const businessUnit = establishment?.businessUnitId ? catalog.businessUnits.find((item) => item.id === establishment.businessUnitId) : undefined;
  const company = establishment?.companyId ? catalog.companies.find((item) => item.id === establishment.companyId) : undefined;
  return {
    area: area?.name || "",
    establishment: establishment?.name || "",
    businessUnit: businessUnit?.name || "",
    company: company?.name || "",
  };
}

export function PuestoIdentificationTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  const [catalog, setCatalog] = useState<OrgStructureCatalog | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    orgStructureApiService.getCatalog()
      .then((data) => { if (mounted) setCatalog(data); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const set = (field: keyof Position, value: string) => setPosition({ ...position, [field]: value });
  const sectorOptions = (catalog?.sectors || []).filter((item) => item.status === "ACTIVO").map((item) => ({ id: item.id, name: item.name }));
  const chain = deriveChain(catalog, position.sectorId);

  return <div className="form-grid">
    <PuestoField label="Nombre del puesto *" value={position.name} onChange={(value) => set("name", value)} disabled={disabled} />
    <PuestoIdSelect label="Sector *" value={position.sectorId} onChange={(sectorId) => setPosition({ ...position, sectorId })} options={sectorOptions} disabled={disabled} />
    <PuestoDerivedField label="Area / Departamento" value={chain.area} />
    <PuestoDerivedField label="Establecimiento" value={chain.establishment} />
    <PuestoDerivedField label="Unidad de negocio" value={chain.businessUnit} />
    <PuestoDerivedField label="Empresa" value={chain.company} />
    <PuestoField label="Codigo del puesto" value={position.code || "Se genera automaticamente al guardar"} onChange={() => undefined} disabled />
    <PuestoField label="Fecha de actualizacion *" type="date" value={position.lastUpdatedAt} onChange={(value) => set("lastUpdatedAt", value)} disabled={disabled} />
    <PuestoSelect label="Estado *" value={position.status} onChange={(value) => set("status", value)} options={["ACTIVO", "INACTIVO"]} disabled={disabled} />
  </div>;
}
