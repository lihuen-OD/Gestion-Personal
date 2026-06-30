import { useEffect, useMemo, useState } from "react";
import { orgStructureApiService } from "../../../services/api/orgStructureApiService";
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
  return uniqueOptions([current].filter(Boolean));
}

export function useStructureSelectOptions(current: StructureOptionCurrent = {}) {
  const [options, setOptions] = useState<{ companies: string[]; businessUnits: string[]; establishments: string[]; areas: string[]; sectors: string[]; costCenters: string[] }>({ companies: [], businessUnits: [], establishments: [], areas: [], sectors: [], costCenters: [] });

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
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  return useMemo(() => ({
    company: uniqueOptions([current.company || "", ...options.companies]),
    businessUnit: uniqueOptions([current.businessUnit || "", ...options.businessUnits]),
    establishment: uniqueOptions([current.establishment || "", ...options.establishments]),
    costCenter: uniqueOptions([current.costCenter || "", ...options.costCenters]),
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
