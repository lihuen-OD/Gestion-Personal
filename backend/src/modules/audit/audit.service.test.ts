import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { auditRepository } from "./audit.repository";
import { auditService } from "./audit.service";

vi.mock("./audit.repository", () => ({ auditRepository: { create: vi.fn().mockResolvedValue({ id: "audit-1" }), findMany: vi.fn() } }));
vi.mock("./audit.cache", () => ({ clearAuditListCache: vi.fn() }));
vi.mock("../dashboard/dashboard.cache", () => ({ clearDashboardMetricsCache: vi.fn() }));

const create = auditRepository.create as unknown as Mock;
const employeeUuid = "016dc01c-655d-4474-8319-67f1b8108c93";

beforeEach(() => {
  vi.clearAllMocks();
});

// Última red: aunque un llamador nuevo arme mal el texto, la descripción que
// llega a Dashboard/Auditoría/Historial nunca persiste un UUID de Employee.
describe("auditService.register — descripción visible sin ids técnicos", () => {
  it("una descripción con el UUID de un Employee se persiste enmascarada y se reporta en logs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await auditService.register({
      action: "CREATE",
      entity: "HourConceptBreakdown",
      entityId: "breakdown-1",
      description: `Se guardó el desglose manual Colectivo para el legajo ${employeeUuid}.`,
      after: { employeeId: employeeUuid },
    });

    const persisted = create.mock.calls[0]![0];
    expect(persisted.description).not.toContain(employeeUuid);
    expect(persisted.description).toBe("Se guardó el desglose manual Colectivo para el legajo —.");
    // El id técnico sigue disponible como metadata interna del evento.
    expect(persisted.after).toEqual({ employeeId: employeeUuid });
    expect(consoleError).toHaveBeenCalledWith("AUDIT_DESCRIPTION_TECHNICAL_ID", { action: "CREATE", entity: "HourConceptBreakdown" });
    consoleError.mockRestore();
  });

  it("una descripción con identidad humana se persiste tal cual", async () => {
    const description = "Se guardó el desglose manual Colectivo del 03/10/2026 para Pérez, Juan · Legajo 30.";
    await auditService.register({ action: "CREATE", entity: "HourConceptBreakdown", description });
    expect(create.mock.calls[0]![0].description).toBe(description);
  });
});
