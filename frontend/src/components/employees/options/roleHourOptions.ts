import { useEffect, useState } from "react";
import { hourConceptApiService } from "../../../services/api/hourConceptApiService";
import { hourConceptMockService } from "../../../services/hourConceptMockService";
import { userMockService } from "../../../services/userMockService";
import { roleOptions } from "../../../utils/roles";
import { uniqueOptions } from "./sharedOptions";

export function userRoleOptions(current = "") {
  return uniqueOptions([current, ...roleOptions, ...userMockService.getAll().map((user) => user.role)]);
}

export const hourOptions = () => hourConceptMockService.getActive().map((concept) => concept.name);

export function useHourOptions() {
  const [options, setOptions] = useState<string[]>(() => hourOptions());

  useEffect(() => {
    let mounted = true;
    hourConceptApiService
      .getAll({ status: "ACTIVO" })
      .then((concepts) => {
        if (mounted) setOptions(concepts.filter((concept) => concept.status === "ACTIVO").map((concept) => concept.name));
      })
      .catch(() => {
        if (mounted) setOptions(hourOptions());
      });
    return () => {
      mounted = false;
    };
  }, []);

  return options;
}
