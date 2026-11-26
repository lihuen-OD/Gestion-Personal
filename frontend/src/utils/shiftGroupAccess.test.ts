import { describe, expect, it } from "vitest";
import { canManageGroup, shiftGroupAccessOf } from "./shiftGroupAccess";

describe("R8 — alcance por grupo de turnos en la UI", () => {
  it("Nivel 1 administra todo, aun sin datos de alcance en la sesión", () => {
    const access = shiftGroupAccessOf({ role: "Nivel 1 - RRHH" });
    expect(access).toEqual({ all: true, groupIds: [] });
    expect(canManageGroup(access, "g-cualquiera")).toBe(true);
    expect(canManageGroup(access, null)).toBe(true);
  });

  it("Nivel 2 con uno o varios grupos: sólo esos; nunca «sin grupo»", () => {
    const one = shiftGroupAccessOf({ role: "Nivel 2 - Supervisión / Gestión", shiftGroupAccess: { all: false, groupIds: ["g-pl"] } });
    expect(canManageGroup(one, "g-pl")).toBe(true);
    expect(canManageGroup(one, "g-ta")).toBe(false);
    expect(canManageGroup(one, null)).toBe(false);
    const many = shiftGroupAccessOf({ role: "Nivel 3 - Administrativo de Carga Horaria", shiftGroupAccess: { all: false, groupIds: ["g-pl", "g-ta"] } });
    expect(["g-pl", "g-ta", "g-maq"].map((id) => canManageGroup(many, id))).toEqual([true, true, false]);
  });

  it("sin grupos o sin datos: ninguno; un `all` guardado para Nivel 2/3 se ignora", () => {
    expect(shiftGroupAccessOf({ role: "Nivel 2 - Supervisión / Gestión" })).toEqual({ all: false, groupIds: [] });
    expect(shiftGroupAccessOf({ role: "Nivel 3 - Administrativo de Carga Horaria", shiftGroupAccess: { all: true, groupIds: [] } })).toEqual({ all: false, groupIds: [] });
    expect(shiftGroupAccessOf(undefined)).toEqual({ all: false, groupIds: [] });
  });
});
