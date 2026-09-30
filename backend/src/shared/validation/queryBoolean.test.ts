import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryBoolean } from "./queryBoolean";
import { listPositionOptionsQuerySchema } from "../../modules/positions/positions.schemas";
import { listDocumentCategoriesQuerySchema } from "../../modules/document-categories/documentCategories.schemas";

describe("queryBoolean", () => {
  const schema = z.object({ flag: queryBoolean().optional() });

  it('"false" es false (z.coerce.boolean lo convertía en true)', () => {
    expect(schema.parse({ flag: "false" })).toEqual({ flag: false });
    expect(schema.parse({ flag: "true" })).toEqual({ flag: true });
    expect(schema.parse({})).toEqual({});
  });

  it("cualquier otro valor es un error de validación, no un booleano inventado", () => {
    expect(schema.safeParse({ flag: "si" }).success).toBe(false);
    expect(schema.safeParse({ flag: "0" }).success).toBe(false);
  });

  it("aplica a los filtros de listado reales (ej. categorías documentales ?mandatory=false)", () => {
    expect(listDocumentCategoriesQuerySchema.parse({ mandatory: "false" }).mandatory).toBe(false);
  });
});

describe("GET /positions/options — catálogo completo explícito", () => {
  it("sin take no aplica tope (antes default 300)", () => {
    expect(listPositionOptionsQuerySchema.parse({}).take).toBeUndefined();
    expect(listPositionOptionsQuerySchema.parse({ includeAssignedCount: "false" }).includeAssignedCount).toBe(false);
  });
});
