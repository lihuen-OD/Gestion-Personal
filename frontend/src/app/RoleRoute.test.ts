import { describe, expect, it } from "vitest";
import { canAccessRoleRoute } from "./RoleRoute";

describe("RoleRoute", () => {
  it("bloquea módulos integrales para Nivel 3", () => {
    expect(canAccessRoleRoute("Nivel 3 - Administrativo de Carga Horaria", [1, 2])).toBe(false);
  });

  it("mantiene acceso de RRHH y Supervisión", () => {
    expect(canAccessRoleRoute("Nivel 1 - RRHH", [1, 2])).toBe(true);
    expect(canAccessRoleRoute("Nivel 2 - Supervisión / Gestión", [1, 2])).toBe(true);
  });
});
