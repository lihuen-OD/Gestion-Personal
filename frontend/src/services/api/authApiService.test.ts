import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { authApiService } from "./authApiService";

vi.mock("./apiClient", () => ({ apiRequest: vi.fn() }));

describe("authApiService.logout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("llama al endpoint autenticado de logout", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true });

    await authApiService.logout();

    expect(apiRequest).toHaveBeenCalledWith("/auth/logout", { method: "POST" });
  });
});
