import { useEffect, useMemo, useState } from "react";
import { salaryCategoryApiService } from "../../../services/api/salaryCategoryApiService";
import { salaryRangeMockService } from "../../../services/salaryRangeMockService";
import type { Employee } from "../../../types";
import { uniqueOptions } from "./sharedOptions";

// A6 (ORG_LOCATION_REORGANIZATION.md §3.3): las opciones de unidad de
// negocio, establecimiento y sector del modelo anterior se retiraron — el
// alcance sale del puesto y las ubicaciones se asignan con vigencia.
export function useLaborSelectOptions(employee?: Employee) {
  const [salaryCategories, setSalaryCategories] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    salaryCategoryApiService.getGroups()
      .then((groups) => {
        if (!mounted) return;
        if (groups.length) salaryRangeMockService.setApiGroups(groups);
        setSalaryCategories(salaryRangeMockService.getOrderedCategories());
      })
      .catch(() => {
        if (mounted) setSalaryCategories(salaryRangeMockService.getOrderedCategories());
      });
    return () => {
      mounted = false;
    };
  }, []);

  return useMemo(() => {
    const receiptBase = salaryCategories.map((category) => category.replace(/\s+[A-I]$/, ""));
    return {
      receiptCategory: uniqueOptions([employee?.receiptCategory || "", ...receiptBase]),
      internalCategory: uniqueOptions([employee?.internalCategory || "", ...salaryCategories]),
    };
  }, [employee?.receiptCategory, employee?.internalCategory, salaryCategories]);
}
