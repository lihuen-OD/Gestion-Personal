import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import type { Mock } from "vitest";
import type { Server } from "http";
import express from "express";

/**
 * Etapa 6L.1 — regresión real de ruteo/controller, no de service mockeado.
 *
 * El bug reportado (asignar un empleado desde Conceptos Horarios no se
 * reflejaba en el Legajo) tenía dos causas: un select incompleto en
 * employeeOverviewSelect (cubierto por employees.repository.test.ts) y esta
 * segunda causa — hourConceptsController.enableEmployees/disableEmployee no
 * invalidaban employeeDetailCache, dejando hasta 30s de datos viejos en
 * /employees/:id/overview-details tras una asignación hecha desde este
 * módulo. Un test de service mockeado no detecta esto porque el cache vive
 * en el controller, no en el service/repository — hace falta montar el
 * router real para probar que el handler realmente llama a
 * clearEmployeeReadCaches.
 */
vi.mock("../../middlewares/auth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1", email: "user@example.com", name: "Usuario de prueba", role: "NIVEL_1_RRHH" };
    next();
  },
}));

vi.mock("./hourConcepts.service", () => ({
  hourConceptsService: {
    enableEmployees: vi.fn().mockResolvedValue({ hourConceptId: "11111111-1111-1111-1111-111111111111", employeeIds: ["22222222-2222-2222-2222-222222222222"] }),
    disableEmployee: vi.fn().mockResolvedValue({ hourConceptId: "11111111-1111-1111-1111-111111111111", employeeId: "22222222-2222-2222-2222-222222222222" }),
    update: vi.fn().mockResolvedValue({ id: "11111111-1111-1111-1111-111111111111", workTreatment: "WITHIN_BASE" }),
    remove: vi.fn().mockResolvedValue({ concept: { id: "11111111-1111-1111-1111-111111111111" }, deletedBreakdowns: 1 }),
    nextCode: vi.fn().mockResolvedValue({ code: "HOR-006" }),
  },
}));

vi.mock("../employees/employees.controller", () => ({
  clearEmployeeTimeGridCache: vi.fn(),
  clearEmployeeReadCaches: vi.fn(),
}));

// Lecturas derivadas que dependen del concepto (WORKED_TIME_ACCOUNTING_MODEL.md §12).
vi.mock("../employees/employees.repository", () => ({ invalidateTimeGridCatalogCache: vi.fn() }));
vi.mock("../time-entries/timeEntries.cache", () => ({ clearTimeEntriesReadCaches: vi.fn() }));
vi.mock("../dashboard/dashboard.cache", () => ({ clearDashboardMetricsCache: vi.fn() }));
vi.mock("../workforce-management/workforce.cache", () => ({ clearMonthlyClosuresReadCaches: vi.fn() }));
vi.mock("../novelties/novelties.cache", () => ({ clearNoveltiesReadCaches: vi.fn() }));

describe("hourConceptsController — invalidación de cache del Legajo (Etapa 6L.1)", () => {
  let server: Server;
  let baseUrl: string;
  let clearEmployeeReadCaches: Mock;

  beforeAll(async () => {
    const { hourConceptsRouter } = await import("./hourConcepts.routes");
    const employeesControllerModule = await import("../employees/employees.controller");
    clearEmployeeReadCaches = employeesControllerModule.clearEmployeeReadCaches as unknown as Mock;

    const app = express();
    app.use(express.json());
    const apiRouter = express.Router();
    apiRouter.use("/hour-concepts", hourConceptsRouter);
    app.use("/api", apiRouter);
    app.use((error: { statusCode?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error.statusCode ?? 500).json({ error: error.message ?? "unknown" });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server?.close();
  });

  it("POST /hour-concepts/:id/employees invalida el cache de lectura del Legajo tras habilitar", async () => {
    clearEmployeeReadCaches.mockClear();
    const response = await fetch(`${baseUrl}/api/hour-concepts/11111111-1111-1111-1111-111111111111/employees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeIds: ["22222222-2222-2222-2222-222222222222"] }),
    });
    expect(response.status).toBe(201);
    expect(clearEmployeeReadCaches).toHaveBeenCalledTimes(1);
  });

  it("DELETE /hour-concepts/:id/employees/:employeeId invalida el cache de lectura del Legajo tras deshabilitar", async () => {
    clearEmployeeReadCaches.mockClear();
    const response = await fetch(`${baseUrl}/api/hour-concepts/11111111-1111-1111-1111-111111111111/employees/22222222-2222-2222-2222-222222222222`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(clearEmployeeReadCaches).toHaveBeenCalledTimes(1);
  });

  it("GET /hour-concepts/next-code no se interpreta como un :id y devuelve el código de backend", async () => {
    const response = await fetch(`${baseUrl}/api/hour-concepts/next-code`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { code: "HOR-006" } });
  });

  describe("editar o eliminar un concepto refleja los números al instante (sin depender de TTL)", () => {
    async function dependentClears() {
      const [repository, timeEntries, dashboard, workforce, novelties] = await Promise.all([
        import("../employees/employees.repository"),
        import("../time-entries/timeEntries.cache"),
        import("../dashboard/dashboard.cache"),
        import("../workforce-management/workforce.cache"),
        import("../novelties/novelties.cache"),
      ]);
      return [
        clearEmployeeReadCaches,
        repository.invalidateTimeGridCatalogCache,
        timeEntries.clearTimeEntriesReadCaches,
        dashboard.clearDashboardMetricsCache,
        workforce.clearMonthlyClosuresReadCaches,
        novelties.clearNoveltiesReadCaches,
      ] as unknown as Mock[];
    }

    it("PATCH /hour-concepts/:id (p. ej. corregir workTreatment) limpia grilla, Carga de horas, dashboard, cierres y legajo", async () => {
      const clears = await dependentClears();
      clears.forEach((clear) => clear.mockClear());
      const response = await fetch(`${baseUrl}/api/hour-concepts/11111111-1111-1111-1111-111111111111`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workTreatment: "WITHIN_BASE" }),
      });
      expect(response.status).toBe(200);
      clears.forEach((clear) => expect(clear).toHaveBeenCalledTimes(1));
    });

    it("DELETE /hour-concepts/:id limpia las mismas lecturas y ya no acepta ni necesita ?force", async () => {
      const clears = await dependentClears();
      clears.forEach((clear) => clear.mockClear());
      const { hourConceptsService } = await import("./hourConcepts.service");
      const response = await fetch(`${baseUrl}/api/hour-concepts/11111111-1111-1111-1111-111111111111`, { method: "DELETE" });
      expect(response.status).toBe(200);
      expect(hourConceptsService.remove).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111", expect.anything());
      clears.forEach((clear) => expect(clear).toHaveBeenCalledTimes(1));
    });
  });
});
