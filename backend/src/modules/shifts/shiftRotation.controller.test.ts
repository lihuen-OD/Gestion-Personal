import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftRotationController } from "./shiftRotation.controller";
import { shiftRotationService } from "./shiftRotation.service";
import { shiftRotationMembershipService } from "./shiftRotationMembership.service";
import { shiftRotationVersionService } from "./shiftRotationVersion.service";
import { clearNoveltyCoverageReadCaches } from "../novelties/noveltyCoverageReadCaches";
import { clearShiftTemplatesReadCache } from "../workforce-management/workforce.cache";
import { clearShiftAssignmentSummaryCache } from "./shiftAssignment.cache";

vi.mock("../../shared/audit/requestAuditContext", () => ({ requestAuditContext: vi.fn(() => ({ userId: "user-1" })) }));
vi.mock("./shiftRotation.service", () => ({ shiftRotationService: { remove: vi.fn(), finalize: vi.fn() } }));
vi.mock("./shiftRotationMembership.service", () => ({ shiftRotationMembershipService: { add: vi.fn() } }));
vi.mock("./shiftRotationVersion.service", () => ({ shiftRotationVersionService: { create: vi.fn() } }));
vi.mock("../novelties/noveltyCoverageReadCaches", () => ({ clearNoveltyCoverageReadCaches: vi.fn() }));
vi.mock("../workforce-management/workforce.cache", () => ({ clearShiftTemplatesReadCache: vi.fn() }));
vi.mock("./shiftAssignment.cache", () => ({ clearShiftAssignmentSummaryCache: vi.fn() }));

const req = (params: Record<string, string>, body: unknown = {}) => ({ params, body }) as never;
function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as never;
}

beforeEach(() => vi.clearAllMocks());

describe("invalidación de lecturas derivadas de rotaciones", () => {
  it("una versión nueva limpia cobertura y el catálogo de plantillas", async () => {
    vi.mocked(shiftRotationVersionService.create).mockResolvedValue({ id: "version-1" } as never);
    const res = response();
    await shiftRotationController.createVersion(req({ id: "rotation-1" }, { days: [] }), res);
    expect(clearNoveltyCoverageReadCaches).toHaveBeenCalledOnce();
    expect(clearShiftTemplatesReadCache).toHaveBeenCalledOnce();
    expect((res as any).status).toHaveBeenCalledWith(201);
  });

  it("un alta de membresía limpia cobertura y el resumen fijo por la Opción C", async () => {
    vi.mocked(shiftRotationMembershipService.add).mockResolvedValue({ created: 1 } as never);
    const res = response();
    await shiftRotationController.addMembers(req({ id: "rotation-1", crewId: "crew-1" }, { employeeIds: [] }), res);
    expect(clearNoveltyCoverageReadCaches).toHaveBeenCalledOnce();
    expect(clearShiftAssignmentSummaryCache).toHaveBeenCalledOnce();
  });

  it("finalizar limpia cobertura y usos futuros de plantillas; borrar limpia usos", async () => {
    vi.mocked(shiftRotationService.finalize).mockResolvedValue({} as never);
    vi.mocked(shiftRotationService.remove).mockResolvedValue({ id: "rotation-1" } as never);
    await shiftRotationController.finalize(req({ id: "rotation-1" }, {}), response());
    expect(clearNoveltyCoverageReadCaches).toHaveBeenCalledOnce();
    expect(clearShiftTemplatesReadCache).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    await shiftRotationController.remove(req({ id: "rotation-1" }), response());
    expect(clearShiftTemplatesReadCache).toHaveBeenCalledOnce();
    expect(clearNoveltyCoverageReadCaches).not.toHaveBeenCalled();
  });
});
