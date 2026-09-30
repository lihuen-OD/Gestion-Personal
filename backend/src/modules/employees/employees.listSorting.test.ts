import { describe, expect, it, vi } from "vitest";
import { roles } from "../../shared/security/roles";
import { createInMemoryPrismaTable } from "../../shared/testing/inMemoryPrismaTable";
import { listEmployeesQuerySchema } from "./employees.schemas";
import { employeesService } from "./employees.service";

// Pipeline server-side de Legajos: WHERE → ORDER BY → COUNT → OFFSET/LIMIT
// sobre el dataset completo. Prisma se reemplaza por un fake en memoria que
// ejecuta where/orderBy/skip/take como Postgres (ver
// shared/testing/inMemoryPrismaTable.ts), así el test prueba la consulta real
// que arma el repositorio, no un sort simulado de la página del frontend.

const { table } = vi.hoisted(() => ({ table: { current: null as null | { findMany: (args: never) => Promise<unknown>; count: (args: never) => Promise<number> } } }));

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: {
      findMany: (args: never) => table.current!.findMany(args),
      count: (args: never) => table.current!.count(args),
    },
  },
}));

const rrhh = { id: "u1", email: "rrhh@test", name: "RRHH", role: roles.rrhh } as Express.AuthUser;

// 60 legajos → 3 páginas de 25. "Zeta, Aaron" (INACTIVO) es el último en el
// orden default status/apellido/nombre ⇒ página 3, pero tiene el legajo más bajo.
function employee(index: number, overrides: Record<string, unknown> = {}) {
  const n = String(index).padStart(3, "0");
  return { id: `id-${n}`, legajo: `L${String(index + 100)}`, cuil: `20-${n}-1`, dni: n, legajoFinnegans: null, firstName: `Nombre${n}`, lastName: `Apellido${n}`, status: index % 4 === 0 ? "INACTIVO" : "ACTIVO", sectorId: null, costCenterId: null, ...overrides };
}
const dataset = [...Array.from({ length: 59 }, (_, index) => employee(index + 1)), { ...employee(60), legajo: "L001", firstName: "Aaron", lastName: "Zeta", status: "INACTIVO" }];

async function list(params: Record<string, string>) {
  table.current = createInMemoryPrismaTable(dataset);
  return employeesService.list(listEmployeesQuerySchema.parse({ take: "25", ...params }), rrhh);
}

const legajos = (result: Awaited<ReturnType<typeof list>>) => result.items.map((item) => item.legajo);

describe("Legajos — sorting/filtros/búsqueda server-side antes de paginar", () => {
  it("un registro que por orden default está en la página 3 pasa a la página 1 al ordenar", async () => {
    const defaultPage3 = await list({ page: "3" });
    expect(defaultPage3.items.some((item) => item.lastName === "Zeta")).toBe(true);
    const defaultPage1 = await list({ page: "1" });
    expect(defaultPage1.items.some((item) => item.lastName === "Zeta")).toBe(false);

    const sortedPage1 = await list({ page: "1", sortBy: "legajo", sortOrder: "asc" });
    expect(sortedPage1.items[0]).toMatchObject({ lastName: "Zeta", legajo: "L001" });
    expect(sortedPage1.meta).toEqual({ total: 60, page: 1, pageSize: 25, hasMore: true });
  });

  it("DESC ordena todo el dataset: el menor queda último de la última página", async () => {
    const page1 = await list({ page: "1", sortBy: "legajo", sortOrder: "desc" });
    expect(page1.items[0]?.legajo).toBe("L159");
    const page3 = await list({ page: "3", sortBy: "legajo", sortOrder: "desc" });
    expect(page3.items.at(-1)?.legajo).toBe("L001");
    expect(page3.meta.hasMore).toBe(false);
  });

  it("cambiar de página conserva el orden: las 3 páginas concatenadas son el dataset completo ordenado, sin repetidos", async () => {
    const pages = [await list({ page: "1", sortBy: "lastName", sortOrder: "desc" }), await list({ page: "2", sortBy: "lastName", sortOrder: "desc" }), await list({ page: "3", sortBy: "lastName", sortOrder: "desc" })];
    const lastNames = pages.flatMap((page) => page.items.map((item) => item.lastName));
    expect(lastNames).toHaveLength(60);
    expect(new Set(lastNames).size).toBe(60);
    expect(lastNames).toEqual([...lastNames].sort().reverse());
    expect(lastNames[0]).toBe("Zeta");
  });

  it("filtro + sort + paginación combinados: total refleja el dataset filtrado completo", async () => {
    const page1 = await list({ page: "1", status: "INACTIVO", sortBy: "legajo", sortOrder: "desc" });
    expect(page1.meta.total).toBe(dataset.filter((item) => item.status === "INACTIVO").length);
    expect(page1.items.every((item) => item.status === "INACTIVO")).toBe(true);
    expect(legajos(page1)).toEqual([...legajos(page1)].sort().reverse());
  });

  it("búsqueda + sort: busca en todo el dataset y ordena el resultado", async () => {
    const result = await list({ page: "1", search: "apellido05", sortBy: "legajo", sortOrder: "desc" });
    expect(result.meta.total).toBe(10); // Apellido050..Apellido059
    expect(legajos(result)).toEqual(["L159", "L158", "L157", "L156", "L155", "L154", "L153", "L152", "L151", "L150"]);
  });

  it("sortBy fuera de la whitelist es rechazado por el schema (400 VALIDATION_ERROR vía validateQuery)", () => {
    expect(listEmployeesQuerySchema.safeParse({ sortBy: "passwordHash" }).success).toBe(false);
    expect(listEmployeesQuerySchema.safeParse({ sortBy: "costCenter" }).success).toBe(false);
    expect(listEmployeesQuerySchema.safeParse({ sortBy: "lastName", sortOrder: "up" }).success).toBe(false);
  });
});
