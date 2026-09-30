import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveOrderBy, sortQueryShape } from "./listSort";

const schema = z.object({ ...sortQueryShape(["name", "createdAt"] as const) });
type OrderBy = Record<string, "asc" | "desc">;
const map: Record<"name" | "createdAt", (order: "asc" | "desc") => OrderBy[]> = {
  name: (order) => [{ name: order }],
  createdAt: (order) => [{ createdAt: order }],
};

describe("listSort", () => {
  it("rechaza un sortBy fuera de la whitelist", () => {
    expect(schema.safeParse({ sortBy: "passwordHash" }).success).toBe(false);
    expect(schema.safeParse({ sortBy: "name", sortOrder: "sideways" }).success).toBe(false);
  });

  it("sortBy y sortOrder opcionales; sin sortOrder resuelve asc", () => {
    expect(schema.parse({})).toEqual({});
    expect(resolveOrderBy({ sortBy: "name" }, map, [], { id: "asc" })).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(schema.parse({ sortBy: "name", sortOrder: "desc" })).toEqual({ sortBy: "name", sortOrder: "desc" });
  });

  it("sin sortBy usa el orden default + desempate estable", () => {
    expect(resolveOrderBy({ sortOrder: "asc" }, map, [{ status: "asc" }], { id: "asc" })).toEqual([{ status: "asc" }, { id: "asc" }]);
  });

  it("con sortBy usa sólo el mapa del endpoint + desempate", () => {
    expect(resolveOrderBy({ sortBy: "name", sortOrder: "desc" }, map, [{ status: "asc" }], { id: "asc" })).toEqual([{ name: "desc" }, { id: "asc" }]);
  });
});
