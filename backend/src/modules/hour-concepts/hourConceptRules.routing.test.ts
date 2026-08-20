import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import express from "express";

/**
 * Etapa 8M — regresión real de ruteo, no de service/repository mockeado.
 *
 * GET /hour-concepts/:hourConceptId/rules devolvía 400 MISSING_ROUTE_PARAM
 * siempre (aunque el concepto sí tuviera reglas), porque routes.ts monta
 * apiRouter.use("/hour-concepts", hourConceptsRouter) ANTES que
 * apiRouter.use("/hour-concepts/:hourConceptId/rules", hourConceptRulesByConceptRouter).
 * Como hourConceptsRouter no tiene ninguna ruta que matchee "/:id/rules",
 * Express cae al segundo mount — pero sin mergeParams: true en
 * hourConceptRulesByConceptRouter, ese router hijo pierde :hourConceptId por
 * completo (confirmado corriendo el mount real de Express). Este test monta
 * los dos routers reales, en el mismo orden que routes.ts, contra un server
 * HTTP real (sin supertest, con fetch nativo) para que esta regresión no
 * pueda volver a pasar inadvertida — un test con repository mockeado no la
 * hubiera detectado, porque nunca pasa por Express de verdad.
 */
vi.mock("../../middlewares/auth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1", email: "user@example.com", name: "Usuario de prueba", role: "NIVEL_1_RRHH" };
    next();
  },
}));

vi.mock("./hourConcepts.controller", () => ({
  hourConceptsController: {
    list: (_req: express.Request, res: express.Response) => res.json({ data: [], meta: {} }),
    create: (_req: express.Request, res: express.Response) => res.json({ data: null }),
    update: (_req: express.Request, res: express.Response) => res.json({ data: null }),
    listEmployees: (_req: express.Request, res: express.Response) => res.json({ data: [], meta: {} }),
  },
}));

vi.mock("./hourConceptRules.controller", () => ({
  hourConceptRulesController: {
    list: (_req: express.Request, res: express.Response) => res.json({ data: [], meta: {} }),
    getById: (_req: express.Request, res: express.Response) => res.json({ data: null }),
    create: (_req: express.Request, res: express.Response) => res.json({ data: null }),
    update: (_req: express.Request, res: express.Response) => res.json({ data: null }),
    updateStatus: (_req: express.Request, res: express.Response) => res.json({ data: null }),
    // El handler bajo prueba: devuelve los params reales que Express le entregó.
    getByConcept: (req: express.Request, res: express.Response) => res.json({ params: req.params }),
  },
}));

describe("Ruteo real: GET /hour-concepts/:hourConceptId/rules (Etapa 8M)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { hourConceptsRouter } = await import("./hourConcepts.routes");
    const { hourConceptRulesByConceptRouter } = await import("./hourConceptRules.routes");

    const app = express();
    const apiRouter = express.Router();
    // Mismo orden exacto que backend/src/routes.ts: el catch-all sin
    // parámetro se monta antes que el mount con :hourConceptId.
    apiRouter.use("/hour-concepts", hourConceptsRouter);
    apiRouter.use("/hour-concepts/:hourConceptId/rules", hourConceptRulesByConceptRouter);
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

  it("le llega el hourConceptId real al controller, no undefined (regresión del bug de mergeParams)", async () => {
    const response = await fetch(`${baseUrl}/api/hour-concepts/concept-abc/rules`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ params: { hourConceptId: "concept-abc" } });
  });

  it("no cae en el catch-all de hourConceptsRouter (que no tiene ruta para /:id/rules) ni devuelve 400 MISSING_ROUTE_PARAM", async () => {
    const response = await fetch(`${baseUrl}/api/hour-concepts/otro-concepto/rules`);
    expect(response.status).not.toBe(400);
    expect(response.status).toBe(200);
  });
});
