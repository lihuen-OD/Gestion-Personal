import { useEffect, useMemo, useState } from "react";
import { salaryCategoryApiService } from "../../../services/api/salaryCategoryApiService";
import { orgStructureApiService } from "../../../services/api/orgStructureApiService";
import { employeeMockService } from "../../../services/employeeMockService";
import { orgStructureMockService } from "../../../services/orgStructureMockService";
import { salaryRangeMockService } from "../../../services/salaryRangeMockService";
import type { Employee } from "../../../types";
import { uniqueOptions } from "./sharedOptions";

export function useLaborSelectOptions(employee?: Employee) {
  const [salaryCategories, setSalaryCategories] = useState<string[]>(() => salaryRangeMockService.getOrderedCategories());
  const [structure, setStructure] = useState(() => orgStructureMockService.getOptions());

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([salaryCategoryApiService.getGroups(), orgStructureApiService.getCatalog()]).then((results) => {
      if (!mounted) return;
      const [salaryResult, structureResult] = results;
      if (salaryResult.status === "fulfilled" && salaryResult.value.length) {
        salaryRangeMockService.setApiGroups(salaryResult.value);
      }
      setSalaryCategories(salaryRangeMockService.getOrderedCategories());

      if (structureResult.status === "fulfilled") {
        const catalog = structureResult.value;
        setStructure({
          companies: catalog.companies.filter((item) => item.status === "ACTIVO").map((item) => item.name),
          businessUnits: catalog.businessUnits.filter((item) => item.status === "ACTIVO").map((item) => item.name),
          establishments: catalog.establishments.filter((item) => item.status === "ACTIVO").map((item) => item.name),
          areas: catalog.areas.filter((item) => item.status === "ACTIVO").map((item) => item.name),
          sectors: catalog.sectors.filter((item) => item.status === "ACTIVO").map((item) => item.name),
          costCenters: catalog.costCenters.filter((item) => item.status === "ACTIVO").map((item) => item.name),
        });
      } else {
        setStructure(orgStructureMockService.getOptions());
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return useMemo(() => {
    const receiptBase = salaryCategories.map((category) => category.replace(/\s+[A-I]$/, ""));
    return {
      businessUnit: uniqueOptions([employee?.businessUnit || "", ...structure.businessUnits]),
      establishment: uniqueOptions([employee?.establishment || "", ...structure.establishments]),
      sector: uniqueOptions([employee?.sector || "", ...structure.sectors]),
      receiptCategory: uniqueOptions([
        employee?.receiptCategory || "",
        ...employeeMockService.getAll().map((item) => item.receiptCategory),
        ...receiptBase,
      ]),
      internalCategory: uniqueOptions([
        employee?.internalCategory || "",
        ...salaryCategories,
        ...employeeMockService.getAll().map((item) => item.internalCategory),
      ]),
    };
  }, [
    employee?.businessUnit,
    employee?.establishment,
    employee?.sector,
    employee?.receiptCategory,
    employee?.internalCategory,
    salaryCategories,
    structure,
  ]);
}
