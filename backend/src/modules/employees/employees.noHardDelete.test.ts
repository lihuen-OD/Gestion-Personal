import { describe, expect, it } from "vitest";
import { employeesRouter } from "./employees.routes";
import { employeesRepository } from "./employees.repository";
import { employeesService } from "./employees.service";

/**
 * Guarda de regresion para el Bloque 3 (Etapa 1): un legajo nunca debe poder
 * borrarse fisicamente. La baja es siempre un cambio de estado (LaborMovement
 * tipo BAJA + Employee.status = INACTIVO). Las FK que apuntan a Employee se
 * endurecieron a ON DELETE RESTRICT (ver migracion
 * 20260814120000_restrict_employee_cascades) asumiendo que este invariante se
 * mantiene: si alguna vez se agrega una ruta o metodo que borre un Employee,
 * este test debe fallar y forzar una revision consciente.
 */
describe("Employee: no debe existir un mecanismo de borrado fisico", () => {
  it("no expone ninguna ruta DELETE en /employees", () => {
    type RouteLayer = { route?: { path: string; methods: Record<string, boolean> } };
    const deleteRoutes = (employeesRouter.stack as RouteLayer[])
      .filter((layer) => Boolean(layer.route))
      .filter((layer) => layer.route!.methods.delete)
      .map((layer) => layer.route!.path);

    expect(deleteRoutes).toEqual([]);
  });

  it("employeesRepository no expone un metodo delete/remove", () => {
    const repo = employeesRepository as unknown as Record<string, unknown>;
    expect(repo.delete).toBeUndefined();
    expect(repo.remove).toBeUndefined();
  });

  it("employeesService no expone un metodo delete/remove", () => {
    const service = employeesService as unknown as Record<string, unknown>;
    expect(service.delete).toBeUndefined();
    expect(service.remove).toBeUndefined();
  });
});
