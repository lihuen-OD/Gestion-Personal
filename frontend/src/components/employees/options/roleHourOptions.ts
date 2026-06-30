import { useEffect, useState } from "react";
import { hourConceptApiService } from "../../../services/api/hourConceptApiService";
import { roleOptions } from "../../../utils/roles";
import { uniqueOptions } from "./sharedOptions";

export function userRoleOptions(current = "") {
  return uniqueOptions([current, ...roleOptions]);
}

export const hourOptions = () => [];

export function useHourOptions() {
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    hourConceptApiService
      .getAll({ status: "ACTIVO" })
      .then((concepts) => {
        if (mounted) setOptions(concepts.filter((concept) => concept.status === "ACTIVO").map((concept) => concept.name));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  return options;
}
