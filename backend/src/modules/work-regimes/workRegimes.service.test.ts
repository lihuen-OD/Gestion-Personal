import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { resolveActiveWorkRegime } from "./workRegimes.service";
import { findActiveEmployeeWorkRegime } from "./workRegimes.repository";

vi.mock("./workRegimes.repository", () => ({
  findActiveEmployeeWorkRegime: vi.fn(),
}));

const mockedFind = findActiveEmployeeWorkRegime as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveActiveWorkRegime", () => {
  it("devuelve null (fallback a comportamiento actual) si el empleado no tiene regimen vigente", async () => {
    mockedFind.mockResolvedValue(null);

    const result = await resolveActiveWorkRegime("employee-1", new Date("2026-08-18T15:00:00.000Z"));

    expect(result).toBeNull();
  });

  it("devuelve kind y alertOnOutOfShift del regimen vigente encontrado", async () => {
    mockedFind.mockResolvedValue({
      id: "assignment-1",
      workRegime: { kind: "SIN_TURNO", alertOnOutOfShift: false },
    });

    const result = await resolveActiveWorkRegime("employee-1", new Date("2026-08-18T15:00:00.000Z"));

    expect(result).toEqual({ kind: "SIN_TURNO", alertOnOutOfShift: false });
  });

  it("resuelve la fecha calendario Argentina del instante, no la fecha UTC (23:15 ART no es el dia siguiente)", async () => {
    mockedFind.mockResolvedValue(null);
    // 2026-08-18 23:15 ART = 2026-08-19 02:15 UTC.
    const instant = new Date("2026-08-19T02:15:00.000Z");

    await resolveActiveWorkRegime("employee-1", instant);

    const referenceDateUsed = mockedFind.mock.calls.at(0)?.[1] as Date;
    expect(referenceDateUsed.toISOString().slice(0, 10)).toBe("2026-08-18");
  });
});
