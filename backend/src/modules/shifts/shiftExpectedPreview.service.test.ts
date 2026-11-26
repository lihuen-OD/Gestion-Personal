import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEmployeeWorkdayContext, type EmployeeWorkdayContext } from "./expectedWorkday";
import { shiftExpectedPreviewRepository } from "./shiftExpectedPreview.repository";
import { shiftExpectedPreviewService } from "./shiftExpectedPreview.service";
import type { ExpectedShiftPreviewQuery } from "./shiftExpectedPreview.schemas";
import type { LoadedRotationTemplate } from "./rotationPlan.loader";
import { ALL_SHIFT_GROUPS } from "./shiftGroupAccess";

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));
vi.mock("./shiftExpectedPreview.repository", () => ({
  shiftExpectedPreviewRepository: { findRotation: vi.fn(), findEmployees: vi.fn(), findMemberships: vi.fn() },
}));
vi.mock("./expectedWorkday", async () => {
  const actual = await vi.importActual<typeof import("./expectedWorkday")>("./expectedWorkday");
  return { ...actual, loadEmployeeWorkdayContext: vi.fn() };
});

const ROTATION = "11111111-1111-4111-8111-111111111111";
const CREW = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const EMPLOYEE = "44444444-4444-4444-8444-444444444444";
const MEMBERSHIP = "55555555-5555-4555-8555-555555555555";
const date = (key: string) => new Date(`${key}T00:00:00.000Z`);

const template = (id: string, code: string, startTime: string, endTime: string): LoadedRotationTemplate => ({
  id,
  code,
  startTime,
  endTime,
  crossesMidnight: endTime <= startTime,
  status: "ACTIVO",
  entryToleranceBeforeMinutes: 60,
  entryToleranceAfterMinutes: 10,
  exitToleranceBeforeMinutes: 10,
  exitToleranceAfterMinutes: 20,
  minimumMinutesForCompliance: null,
  maximumInformativeMinutes: null,
  missingOutAlertAfterMinutes: null,
  absoluteOpenShiftLimitMinutes: 1200,
});

function employeeContext(): EmployeeWorkdayContext {
  const night = template("66666666-6666-4666-8666-666666666666", "NOCHE", "19:00", "07:00");
  const morning = template("77777777-7777-4777-8777-777777777777", "MADRUGADA", "03:00", "11:00");
  return {
    employeeId: EMPLOYEE,
    assignments: [],
    dayOffDates: new Set(),
    convocations: new Map(),
    regimes: [],
    holidays: new Map(),
    rotation: {
      memberships: [{ employeeId: EMPLOYEE, rotationId: ROTATION, crewId: CREW, effectiveFrom: "2026-11-01", effectiveTo: null }],
      rotations: [{
        id: ROTATION,
        code: "PLANTA",
        status: "INACTIVO",
        crews: [{ id: CREW, code: "A", status: "ACTIVO" }],
        versions: [{
          id: VERSION,
          rotationId: ROTATION,
          cycleLengthWeeks: 1,
          anchorWeekStart: "2026-11-02",
          effectiveFrom: "2026-11-02",
          effectiveTo: null,
          days: [
            { id: "day-friday", crewId: CREW, cycleWeekIndex: 0, weekday: 5, kind: "SHIFT", blocks: [{ blockIndex: 0, template: night }] },
            { id: "day-saturday", crewId: CREW, cycleWeekIndex: 0, weekday: 6, kind: "SHIFT", blocks: [{ blockIndex: 0, template: morning }] },
          ],
        }],
      }],
    },
  };
}

const query: ExpectedShiftPreviewQuery = { rotationId: ROTATION, from: "2026-11-06", to: "2026-11-07", page: 1, take: 25 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(shiftExpectedPreviewRepository.findRotation).mockResolvedValue({
    id: ROTATION,
    code: "PLANTA",
    name: "Planta",
    status: "INACTIVO",
    shiftGroup: { id: "group", code: "PLANTA", name: "Planta" },
    crews: [{ id: CREW, code: "A", name: "Equipo A", status: "ACTIVO" }],
    versions: [{ id: VERSION, effectiveFrom: date("2026-11-02"), effectiveTo: null, cycleLengthWeeks: 1, anchorWeekStart: date("2026-11-02") }],
  } as never);
  vi.mocked(shiftExpectedPreviewRepository.findEmployees).mockResolvedValue({
    items: [{ id: EMPLOYEE, legajo: "19", firstName: "José", lastName: "Planta", status: "ACTIVO" }],
    total: 1,
  } as never);
  vi.mocked(shiftExpectedPreviewRepository.findMemberships).mockResolvedValue([{ id: MEMBERSHIP, employeeId: EMPLOYEE, crewId: CREW, effectiveFrom: date("2026-11-01"), effectiveTo: null }] as never);
});

describe("shiftExpectedPreviewService.preview", () => {
  it("simula una rotación INACTIVA sólo en memoria y conserva el nocturno en su fecha operativa", async () => {
    const context = employeeContext();
    vi.mocked(loadEmployeeWorkdayContext).mockResolvedValue(new Map([[EMPLOYEE, context]]));

    const result = await shiftExpectedPreviewService.preview(query, { id: "rrhh", role: "RRHH" } as never, ALL_SHIFT_GROUPS);

    expect(result.context).toMatchObject({ persistedStatus: "INACTIVO", readOnly: true, previewMode: "HYPOTHETICAL_INACTIVE", affectsRealObligations: false });
    expect(result.data[0]!.days).toHaveLength(2);
    const friday = result.data[0]!.days[0]!;
    const saturday = result.data[0]!.days[1]!;
    expect(friday.planning.blocks[0]).toMatchObject({
      operationalDate: "2026-11-06",
      scheduledStartAt: "2026-11-06T22:00:00.000Z",
      scheduledEndAt: "2026-11-07T10:00:00.000Z",
      template: { code: "NOCHE" },
    });
    expect(saturday.planning.blocks).toHaveLength(1);
    expect(saturday.planning.blocks[0]).toMatchObject({ operationalDate: "2026-11-07", template: { code: "MADRUGADA" } });
    expect(saturday.warnings).toContainEqual(expect.objectContaining({ code: "TRANSITION_OVERLAP", relatedDate: "2026-11-06" }));
    expect(context.rotation!.rotations[0]!.status).toBe("INACTIVO");
    expect(loadEmployeeWorkdayContext).toHaveBeenCalledWith([EMPLOYEE], date("2026-11-05"), date("2026-11-08"), expect.anything());
  });
});
