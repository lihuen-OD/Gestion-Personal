import { createTtlCache } from "../../shared/cache/ttlCache";
import type { noveltiesService } from "./novelties.service";

export const noveltiesListCache = createTtlCache<Awaited<ReturnType<typeof noveltiesService.list>>>(15_000);

export function clearNoveltiesReadCaches() {
  noveltiesListCache.clear();
}
