import { beforeEach, describe, expect, it, vi } from "vitest";
import { roles } from "../../shared/security/roles";
import { auditService } from "../audit/audit.service";
import { automaticHourConceptBreakdownsRepository as repository } from "./automaticHourConceptBreakdowns.repository";
import { automaticHourConceptBreakdownsService as service } from "./automaticHourConceptBreakdowns.service";

vi.mock("./automaticHourConceptBreakdowns.repository", () => ({ automaticHourConceptBreakdownsRepository: {
  findEmployee: vi.fn(), findClosure: vi.fn(), findEligibleConcepts: vi.fn(), findProcessedShifts: vi.fn(), replaceAutomatic: vi.fn(),
} }));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn() } }));

const user = { id: "rrhh-1", role: roles.rrhh } as Express.AuthUser;
const repo = vi.mocked(repository);

beforeEach(() => {
  vi.clearAllMocks();
  repo.findEmployee.mockResolvedValue({ id: "employee-1" });
  repo.findClosure.mockResolvedValue(null);
  repo.findEligibleConcepts.mockResolvedValue([]);
  repo.findProcessedShifts.mockResolvedValue([]);
  repo.replaceAutomatic.mockResolvedValue({ deleted: 0, created: 0 });
});

describe("automaticHourConceptBreakdownsService", () => {
  it("recálcula aun sin reglas para eliminar automáticos obsoletos, preservando MANUAL por contrato del repositorio", async () => {
    repo.replaceAutomatic.mockResolvedValue({ deleted: 2, created: 0 });
    const result = await service.recalculate("employee-1", "2026-08", user, { userId: user.id });
    expect(repo.replaceAutomatic).toHaveBeenCalledWith("employee-1", "2026-08", [], user.id);
    expect(result).toMatchObject({ generated: 0, removed: 2 });
    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE", entity: "HourConceptBreakdown" }));
  });

  it.each(["ENVIADO", "APROBADO", "CORRECCION_PENDIENTE"])('bloquea cierre %s', async (status) => {
    repo.findClosure.mockResolvedValue({ status } as never);
    await expect(service.recalculate("employee-1", "2026-08", user)).rejects.toMatchObject({ statusCode: 409, code: "PERIOD_CLOSED" });
    expect(repo.replaceAutomatic).not.toHaveBeenCalled();
  });

  it("respeta el scope de acceso al no revelar empleados fuera de alcance", async () => {
    repo.findEmployee.mockResolvedValue(null);
    await expect(service.recalculate("employee-1", "2026-08", user)).rejects.toMatchObject({ statusCode: 404, code: "EMPLOYEE_NOT_FOUND" });
  });

  it("usa sólo turnos procesados completos y reglas elegibles entregadas por el repositorio", async () => {
    repo.findEligibleConcepts.mockResolvedValue([{ hourConcept: { id: "sereno", loadMode: "AUTOMATIC", rules: [{ id: "rule-1", hourConceptId: "sereno", startTime: "22:00", endTime: "06:00", crossesMidnight: true }] } }] as never);
    repo.findProcessedShifts.mockResolvedValue([{ id: "shift-1", startAt: new Date("2026-08-10T22:00:00-03:00"), endAt: new Date("2026-08-11T04:00:00-03:00") }] as never);
    repo.replaceAutomatic.mockImplementation(async (_employeeId, _period, rows) => ({ deleted: 1, created: rows.length }));
    const result = await service.recalculate("employee-1", "2026-08", user);
    expect(result).toMatchObject({ processedShifts: 1, eligibleConcepts: 1, generated: 2 });
    expect(repo.replaceAutomatic).toHaveBeenCalledWith("employee-1", "2026-08", expect.arrayContaining([
      expect.objectContaining({ hourConceptId: "sereno", workShiftId: "shift-1" }),
    ]), undefined);
  });
});
