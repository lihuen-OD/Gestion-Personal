import { useEffect, useMemo, useState } from "react";
import { orgStructureApiService } from "../../../services/api/orgStructureApiService";
import { employeeMockService } from "../../../services/employeeMockService";
import { orgStructureMockService } from "../../../services/orgStructureMockService";
import { uniqueOptions } from "./sharedOptions";

type StructureOptionField =
  | "company"
  | "businessUnit"
  | "establishment"
  | "area"
  | "sector"
  | "costCenter";

type StructureOptionCurrent = Partial<Record<StructureOptionField, string>>;

export function structureSelectOptions(field: StructureOptionField, current = "") {
  const structure = orgStructureMockService.getOptions();
  if (field === "company") return uniqueOptions([current, ...structure.companies]);
  if (field === "businessUnit") return uniqueOptions([current, ...structure.businessUnits]);
  if (field === "establishment") return uniqueOptions([current, ...structure.establishments]);
  if (field === "sector") return uniqueOptions([current, ...structure.sectors]);
  if (field === "costCenter") {
    return uniqueOptions([
      current,
      ...structure.costCenters,
      ...employeeMockService.getAll().map((employee) => employee.costCenter),
    ]);
  }
  return uniqueOptions([current, ...structure.areas]);
}

export function useStructureSelectOptions(current: StructureOptionCurrent = {}) {
  const [options, setOptions] = useState(() => orgStructureMockService.getOptions());

  useEffect(() => {
    let mounted = true;
    orgStructureApiService
      .getCatalog()
      .then((catalog) => {
        if (!mounted) return;
        setOptions({
          companies: catalog.companies.filter((item) => item.status === "ACTIVO").map((item) => item.name),
          businessUnits: catalog.businessUnits.filter((item) => item.status === "ACTIVO").map((item) => item.name),
          establishments: catalog.establishments.filter((item) => item.status === "ACTIVO").map((item) => item.name),
          areas: catalog.areas.filter((item) => item.status === "ACTIVO").map((item) => item.name),
          sectors: catalog.sectors.filter((item) => item.status === "ACTIVO").map((item) => item.name),
          costCenters: catalog.costCenters.filter((item) => item.status === "ACTIVO").map((item) => item.name),
        });
      })
      .catch(() => {
        if (mounted) setOptions(orgStructureMockService.getOptions());
      });
    return () => {
      mounted = false;
    };
  }, []);

  return useMemo(() => ({
    company: uniqueOptions([current.company || "", ...options.companies]),
    businessUnit: uniqueOptions([current.businessUnit || "", ...options.businessUnits]),
    establishment: uniqueOptions([current.establishment || "", ...options.establishments]),
    costCenter: uniqueOptions([
      current.costCenter || "",
      ...options.costCenters,
      ...employeeMockService.getAll().map((employee) => employee.costCenter),
    ]),
    area: uniqueOptions([current.area || "", ...options.areas]),
    sector: uniqueOptions([current.sector || "", ...options.sectors]),
  }), [
    current.area,
    current.businessUnit,
    current.company,
    current.costCenter,
    current.establishment,
    current.sector,
    options,
  ]);
}
