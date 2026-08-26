import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { workforceApiService, type DoubleHourRuleInput } from "./workforceApiService";

vi.mock("./apiClient", () => ({ apiRequest: vi.fn() }));

describe("workforceApiService.createDoubleHourRule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("envía el multiplicador elegido sin reemplazarlo por el default", async () => {
    const input: DoubleHourRuleInput = {
      name: "Hora especial",
      recurrenceType: "FECHA",
      fromDate: "2026-08-25",
      toDate: null,
      weekdays: [],
      multiplier: 1.5,
      priority: 0,
      employeeIds: ["employee-1"],
      reason: "Evento especial",
    };
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "rule-1" } });

    await workforceApiService.createDoubleHourRule(input);

    expect(apiRequest).toHaveBeenCalledWith("/workforce/double-hour-rules", { method: "POST", body: input });
    expect(vi.mocked(apiRequest).mock.calls[0]?.[1]?.body).toMatchObject({ multiplier: 1.5 });
  });
});
