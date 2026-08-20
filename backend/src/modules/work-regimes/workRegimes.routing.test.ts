import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import express from "express";

/**
 * Etapa 8M — mismo bug de ruteo confirmado y corregido en
 * hourConceptRules.routes.ts: GET /employees/:employeeId/work-regimes (y
 * POST/PATCH de asignación) dependían de mergeParams: true en
 * employeeWorkRegimesRouter, porque routes.ts monta apiRouter.use("/employees",
 * employeesRouter) ANTES que apiRouter.use("/employees/:employeeId/work-regimes",
 * employeeWorkRegimesRouter) — y employeesRouter no tiene ninguna ruta que
 * matchee "/:id/work-regimes", así que Express cae al segundo mount. Sin
 * mergeParams, ese router hijo perdía :employeeId por completo.
 *
 * Este test no importa el employeesRouter real (es un módulo grande, ajeno a
 * lo que se está probando) — usa un router "standard-in" mínimo, sin rutas
 * que matcheen, que reproduce exactamente el mismo mecanismo de fallback que
 * el employeesRouter real produce para esta ruta específica.
 */
vi.mock("../../middlewares/auth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1", email: "user@example.com", name: "Usuario de prueba", role: "NIVEL_1_RRHH" };
    next();
  },
}));

vi.mock("./workRegimes.controller", () => ({
  workRegimesController: {
    list: (_req: express.Request, res: express.Response) => res.json({ data: [], meta: {} }),
    getById: (_req: express.Request, res: express.Response) => res.json({ data: null }),
    listEmployees: (_req: express.Request, res: express.Response) => res.json({ data: [], meta: {} }),
    create: (_req: express.Request, res: express.Response) => res.json({ data: null }),
    update: (_req: express.Request, res: express.Response) => res.json({ data: null }),
    updateStatus: (_req: express.Request, res: express.Response) => res.json({ data: null }),
    // Los handlers bajo prueba: devuelven los params reales que Express les entregó.
    getHistory: (req: express.Request, res: express.Response) => res.json({ params: req.params }),
    getCurrent: (req: express.Request, res: express.Response) => res.json({ params: req.params }),
    assign: (req: express.Request, res: express.Response) => res.json({ params: req.params }),
    updateAssignment: (req: express.Request, res: express.Response) => res.json({ params: req.params }),
    closeAssignment: (req: express.Request, res: express.Response) => res.json({ params: req.params }),
  },
}));

describe("Ruteo real: GET /employees/:employeeId/work-regimes (Etapa 8M)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { employeeWorkRegimesRouter } = await import("./workRegimes.routes");

    // Standard-in del employeesRouter real: ninguna de sus rutas matchea
    // "/:id/work-regimes", así que Express cae al siguiente mount — igual
    // que en producción.
    const employeesStandIn = express.Router();
    employeesStandIn.get("/", (_req, res) => res.json({ data: [] }));
    employeesStandIn.get("/:id", (_req, res) => res.json({ data: null }));

    const app = express();
    const apiRouter = express.Router();
    apiRouter.use("/employees", employeesStandIn);
    apiRouter.use("/employees/:employeeId/work-regimes", employeeWorkRegimesRouter);
    app.use("/api", apiRouter);

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

  it("le llega el employeeId real al historial (regresión del bug de mergeParams)", async () => {
    const response = await fetch(`${baseUrl}/api/employees/employee-abc/work-regimes`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ params: { employeeId: "employee-abc" } });
  });

  it("le llega el employeeId real a /current, no undefined", async () => {
    const response = await fetch(`${baseUrl}/api/employees/employee-abc/work-regimes/current`);
    const body = (await response.json()) as { params: { employeeId: string } };

    expect(response.status).toBe(200);
    expect(body.params.employeeId).toBe("employee-abc");
  });
});
