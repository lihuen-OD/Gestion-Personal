import { useEffect, useState } from "react";
import { hourConceptApiService } from "../../../services/api/hourConceptApiService";
import { roleOptions } from "../../../utils/roles";
import { uniqueOptions } from "./sharedOptions";
import type { HourConcept } from "../../../types/hourConcept.types";

export function userRoleOptions(current = "") {
  return uniqueOptions([current, ...roleOptions]);
}

export function assignableHourConcepts(concepts: HourConcept[]) {
  return concepts.filter((concept) => (
    concept.status === "ACTIVO"
    && concept.systemRole !== "NORMAL_BASE"
    && Boolean(concept.loadMode)
  ));
}

export function useHourOptions() {
  const concepts = useHourConceptOptions();
  return concepts.map((concept) => concept.name);
}

export function useHourConceptOptions() {
  const [options, setOptions] = useState<HourConcept[]>([]);

  useEffect(() => {
    let mounted = true;
    hourConceptApiService
      .getAll({ status: "ACTIVO" })
      .then((concepts) => {
        if (mounted) {
          setOptions(assignableHourConcepts(concepts));
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  return options;
}
