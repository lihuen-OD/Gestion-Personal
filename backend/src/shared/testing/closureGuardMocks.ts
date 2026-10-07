import { vi } from "vitest";

/**
 * D-5 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §18.1): lo mínimo que
 * `closurePeriodGuard` necesita de un cliente de transacción mockeado — el
 * advisory lock (`$executeRaw`) y la lectura de cierres. Por defecto ningún
 * período está protegido; un test que quiera uno lo configura con
 * `monthlyTimeClosure.findMany.mockResolvedValue([...])`.
 */
export function closureGuardMocks(protectedClosures: Array<{ employeeId: string; period: string; status: string }> = []) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    monthlyTimeClosure: { findMany: vi.fn().mockResolvedValue(protectedClosures) },
  };
}
