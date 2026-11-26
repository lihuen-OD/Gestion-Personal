import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import {
  ALL_SHIFT_GROUPS,
  canAccessShiftGroup,
  requestShiftGroupScope,
  resolveShiftGroupScope,
  shiftGroupScopeCacheKey,
  shiftGroupScopeWhere,
  shiftGroupWhereForScope,
  shiftRotationWhereForScope,
  shiftTemplateWhereForScope,
} from "./shiftGroupAccess";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("../../shared/prisma/client", () => ({ prisma: { shiftGroup: { findMany } } }));

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

const rrhh = { id: "u-rrhh", role: "NIVEL_1_RRHH" } as const;
const stefi = { id: "u-stefi", role: "NIVEL_2_SUPERVISION" } as const;
const joaquin = { id: "u-joaquin", role: "NIVEL_3_CARGA_HORARIA" } as const;
const unknown = { id: "u-x", role: "OTRO" } as never;

describe("shiftGroupScopeWhere (regla única de R8)", () => {
  it("Nivel 1: sin restricción", () => {
    expect(shiftGroupScopeWhere(rrhh)).toEqual({});
  });

  it("Nivel 2: sólo sus filas propias", () => {
    expect(shiftGroupScopeWhere(stefi)).toEqual({ userScopes: { some: { userId: "u-stefi" } } });
  });

  it("Nivel 3: no usa filas propias; hereda de Nivel 2 ACTIVOS que lo supervisan", () => {
    expect(shiftGroupScopeWhere(joaquin)).toEqual({
      userScopes: { some: { user: { role: "NIVEL_2_SUPERVISION", status: "ACTIVO", supervisionsAsSupervisor: { some: { supervisedUserId: "u-joaquin" } } } } },
    });
  });

  it("rol desconocido: ningún grupo", () => {
    expect(shiftGroupScopeWhere(unknown)).toEqual({ id: "__NO_ACCESS__" });
  });
});

describe("resolveShiftGroupScope", () => {
  it("Nivel 1: acceso total sin consultar la base", async () => {
    await expect(resolveShiftGroupScope(rrhh)).resolves.toBe(ALL_SHIFT_GROUPS);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("Nivel 2 con un grupo", async () => {
    findMany.mockResolvedValue([{ id: "g-planta" }]);
    const scope = await resolveShiftGroupScope(stefi);
    expect(scope).toEqual({ all: false, groupIds: new Set(["g-planta"]) });
    expect(findMany).toHaveBeenCalledWith({ where: shiftGroupScopeWhere(stefi), select: { id: true } });
  });

  it("Nivel 2 con varios grupos", async () => {
    findMany.mockResolvedValue([{ id: "g-taller" }, { id: "g-maquinaria" }]);
    await expect(resolveShiftGroupScope({ id: "u-eugenia", role: "NIVEL_2_SUPERVISION" })).resolves.toEqual({ all: false, groupIds: new Set(["g-taller", "g-maquinaria"]) });
  });

  it("Nivel 3 heredando de dos Nivel 2: la unión que devuelve la query", async () => {
    findMany.mockResolvedValue([{ id: "g-planta" }, { id: "g-taller" }, { id: "g-maquinaria" }]);
    const scope = await resolveShiftGroupScope(joaquin);
    expect(findMany).toHaveBeenCalledWith({ where: shiftGroupScopeWhere(joaquin), select: { id: true } });
    expect(scope).toEqual({ all: false, groupIds: new Set(["g-planta", "g-taller", "g-maquinaria"]) });
  });

  it("sin filas: ningún grupo, nunca acceso global", async () => {
    const scope = await resolveShiftGroupScope(stefi);
    expect(scope).toEqual({ all: false, groupIds: new Set() });
    expect(canAccessShiftGroup(scope, "g-planta")).toBe(false);
  });

  it("rol desconocido: ningún grupo sin consultar la base", async () => {
    await expect(resolveShiftGroupScope(unknown)).resolves.toEqual({ all: false, groupIds: new Set() });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("requestShiftGroupScope", () => {
  it("resuelve una sola vez por request y vuelve a resolver en la siguiente (sin caché global)", async () => {
    findMany.mockResolvedValueOnce([{ id: "g-planta" }]).mockResolvedValueOnce([]);
    const first = { user: stefi } as unknown as Request;
    await requestShiftGroupScope(first);
    await expect(requestShiftGroupScope(first)).resolves.toEqual({ all: false, groupIds: new Set(["g-planta"]) });
    expect(findMany).toHaveBeenCalledTimes(1);

    // Revocación: la request siguiente ya no ve el grupo.
    await expect(requestShiftGroupScope({ user: stefi } as unknown as Request)).resolves.toEqual({ all: false, groupIds: new Set() });
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("sin usuario autenticado: ningún grupo", async () => {
    await expect(requestShiftGroupScope({} as Request)).resolves.toEqual({ all: false, groupIds: new Set() });
  });
});

describe("filtros y huella", () => {
  const partial = { all: false as const, groupIds: new Set(["g-b", "g-a"]) };

  it("Nivel 1 no agrega filtros", () => {
    expect(shiftGroupWhereForScope(ALL_SHIFT_GROUPS)).toEqual({});
    expect(shiftTemplateWhereForScope(ALL_SHIFT_GROUPS)).toEqual({});
    expect(shiftRotationWhereForScope(ALL_SHIFT_GROUPS)).toEqual({});
  });

  it("alcance parcial filtra por id de grupo; una plantilla sin grupo queda afuera", () => {
    expect(shiftGroupWhereForScope(partial)).toEqual({ id: { in: ["g-b", "g-a"] } });
    expect(shiftTemplateWhereForScope(partial)).toEqual({ shiftGroupId: { in: ["g-b", "g-a"] } });
    expect(shiftRotationWhereForScope(partial)).toEqual({ shiftGroupId: { in: ["g-b", "g-a"] } });
    expect(canAccessShiftGroup(partial, null)).toBe(false);
    expect(canAccessShiftGroup(ALL_SHIFT_GROUPS, null)).toBe(true);
  });

  it("alcance vacío no matchea nada", () => {
    expect(shiftTemplateWhereForScope({ all: false, groupIds: new Set() })).toEqual({ shiftGroupId: { in: [] } });
  });

  it("la huella es estable al orden y distingue alcances", () => {
    expect(shiftGroupScopeCacheKey(partial)).toBe("groups:g-a,g-b");
    expect(shiftGroupScopeCacheKey({ all: false, groupIds: new Set(["g-a", "g-b"]) })).toBe("groups:g-a,g-b");
    expect(shiftGroupScopeCacheKey({ all: false, groupIds: new Set(["g-a"]) })).not.toBe(shiftGroupScopeCacheKey(partial));
    expect(shiftGroupScopeCacheKey({ all: false, groupIds: new Set() })).toBe("groups:");
    expect(shiftGroupScopeCacheKey(ALL_SHIFT_GROUPS)).toBe("groups:all");
  });
});
