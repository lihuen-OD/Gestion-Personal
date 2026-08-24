import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { shiftAssignmentApiService } from "./shiftAssignmentApiService";

vi.mock("./apiClient", () => ({ apiRequest: vi.fn() }));

describe("shiftAssignmentApiService.getSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("consulta el resumen agregado sin descargar asignaciones", async () => {
    const data = [{ shiftTemplateId: "template-1", total: 5, enabled: 3, disabled: 2, other: 0 }];
    vi.mocked(apiRequest).mockResolvedValue({ data });

    await expect(shiftAssignmentApiService.getSummary()).resolves.toEqual(data);
    expect(apiRequest).toHaveBeenCalledWith("/shifts/assignments/summary", { apiCache: false });
  });
});
