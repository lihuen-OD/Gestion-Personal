import { useEffect, useState } from "react";
import { orgStructureApiService } from "../../../services/api/orgStructureApiService";
import type { OrgStructureCatalog } from "../../../types/orgStructure.types";

/** Catálogo de estructura (cacheado en services/cache) para filtros de A7. */
export function useOrgStructureCatalog() {
  const [catalog, setCatalog] = useState<OrgStructureCatalog | null>(null);
  useEffect(() => {
    let mounted = true;
    orgStructureApiService.getCatalog().then((data) => { if (mounted) setCatalog(data); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  return catalog;
}
