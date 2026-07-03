import { createTtlCache } from "../../shared/cache/ttlCache";
import type { auditService } from "./audit.service";

export const auditListCache = createTtlCache<Awaited<ReturnType<typeof auditService.list>>>(15_000);

export function clearAuditListCache() {
  auditListCache.clear();
}
