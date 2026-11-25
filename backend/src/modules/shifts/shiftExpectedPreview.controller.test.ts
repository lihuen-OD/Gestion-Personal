import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftExpectedPreviewController } from "./shiftExpectedPreview.controller";
import { shiftExpectedPreviewService } from "./shiftExpectedPreview.service";

vi.mock("./shiftExpectedPreview.service", () => ({ shiftExpectedPreviewService: { preview: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe("shiftExpectedPreviewController", () => {
  it("pasa query y usuario al servicio y conserva data/context/meta", async () => {
    const payload = { data: [], context: { readOnly: true }, meta: { total: 0, page: 1, pageSize: 25, hasMore: false } };
    vi.mocked(shiftExpectedPreviewService.preview).mockResolvedValue(payload as never);
    const query = { rotationId: "rotation", from: "2026-11-01", to: "2026-11-02", page: 1, take: 25 };
    const user = { id: "user", role: "RRHH" };
    const req = { query, user } as never;
    const res = { json: vi.fn() } as never;

    await shiftExpectedPreviewController.preview(req, res);

    expect(shiftExpectedPreviewService.preview).toHaveBeenCalledWith(query, user);
    expect((res as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith(payload);
  });
});
