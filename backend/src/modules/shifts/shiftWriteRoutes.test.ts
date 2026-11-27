/**
 * R8.3 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §26): inventario de las
 * rutas de escritura de turnos. Una ruta de escritura abierta a Nivel 2/3 sólo
 * es segura si su servicio verifica grupo y legajos (`shiftWriteAccess.ts`) y
 * una prueba de integración lo demuestra (`shiftGroupScope.integration.test.ts`).
 * Este test falla si se abre una ruta nueva sin agregarla acá (y a esa suite),
 * o si una de las rutas de sólo-RRHH (grupos) se abre.
 *
 * Excepción por LEGAJO (no por grupo): las convocatorias a feriado se abren a
 * Nivel 2/3 con el alcance de legajos de employeeAccessWhere, igual que
 * francos (WORKED_TIME_ACCOUNTING_MODEL.md §20). Su servicio lo verifica todo
 * o nada y lo prueba holidayWorkAssignment.integration.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Route = { method: string; path: string; guard: string };

function writeRoutes(file: string, router: string): Route[] {
  const source = readFileSync(join(__dirname, file), "utf8");
  const pattern = new RegExp(`${router}\\.(post|put|patch|delete)\\(\\s*"([^"]+)"\\s*,\\s*(requireAnyRole\\(\\[[^\\]]*\\]\\)|requireAnyRole\\(\\w+\\)|\\w+)\\s*,`, "g");
  return [...source.matchAll(pattern)].map((match) => ({ method: match[1]!.toUpperCase(), path: match[2]!, guard: match[3]!.replace(/\s+/g, "") }));
}

const OPEN_TO_N2_N3 = new Set([
  "POST /assignments",
  "PATCH /assignments/:id",
  "DELETE /assignments/:id",
  "POST /rotations",
  "PATCH /rotations/:id",
  "DELETE /rotations/:id",
  "POST /rotations/:id/activate",
  "POST /rotations/:id/deactivate",
  "POST /rotations/:id/finalize/preview",
  "POST /rotations/:id/finalize",
  "POST /rotations/:id/crews",
  "PATCH /rotations/:id/crews/:crewId",
  "POST /rotations/:id/versions",
  "PATCH /rotations/:id/versions/:versionId",
  "DELETE /rotations/:id/versions/:versionId",
  "POST /rotations/:id/crews/:crewId/members",
  "POST /rotations/:id/members/:memberId/close",
  "POST /rotations/:id/members/:memberId/move",
  "DELETE /rotations/:id/members/:memberId",
  // /api/workforce
  "POST /shift-templates",
  "PATCH /shift-templates/:id",
  "DELETE /shift-templates/:id",
  "POST /shift-templates/:id/replace-schedule/preview",
  "POST /shift-templates/:id/replace-schedule",
  // Alcance por legajo (employeeAccessWhere), nunca por grupo de turnos.
  "PUT /holiday-work/assignments",
]);

const RRHH_ONLY = ["POST /groups", "PATCH /groups/:id", "DELETE /groups/:id"];

describe("R8.3 — inventario de rutas de escritura de turnos", () => {
  const shifts = writeRoutes("shifts.routes.ts", "shiftsRouter");
  const templates = writeRoutes("../workforce-management/workforce.routes.ts", "workforceRouter").filter((route) => route.path.startsWith("/shift-templates"));
  const all = [...shifts, ...templates];
  const key = (route: Route) => `${route.method} ${route.path}`;
  const isOpen = (route: Route) => route.guard === "shiftWriters" || route.guard === "requireAnyRole(all)";

  it("encuentra las rutas (el patrón no quedó desactualizado)", () => {
    expect(shifts.length).toBeGreaterThanOrEqual(23);
    expect(templates).toHaveLength(5);
  });

  it("las rutas abiertas a Nivel 2/3 son exactamente las verificadas por servicio", () => {
    expect(all.filter(isOpen).map(key).sort()).toEqual([...OPEN_TO_N2_N3].sort());
  });

  it("toda otra ruta de escritura sigue siendo sólo de RRHH (grupos, alertas)", () => {
    for (const route of all.filter((candidate) => !isOpen(candidate))) {
      expect(route.guard, key(route)).toMatch(/^requireAnyRole\(\[roles\.rrhh(,roles\.supervision)?\]\)$/);
    }
    for (const entry of RRHH_ONLY) {
      const route = all.find((candidate) => key(candidate) === entry);
      expect(route?.guard, entry).toBe("requireAnyRole([roles.rrhh])");
    }
  });
});
