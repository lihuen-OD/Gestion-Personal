import { createTtlCache } from "../../shared/cache/ttlCache";
import type { documentsService } from "./documents.service";

export const documentsListCache = createTtlCache<Awaited<ReturnType<typeof documentsService.list>>>(20_000);

export function clearDocumentsReadCaches() {
  documentsListCache.clear();
}
