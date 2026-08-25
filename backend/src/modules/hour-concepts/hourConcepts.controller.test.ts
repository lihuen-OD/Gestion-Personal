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
  },
}));

vi.mock("../employees/employees.controller", () => ({
  clearEmployeeReadCaches: vi.fn(),
}));

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
});
