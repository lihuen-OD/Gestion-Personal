import { describe, expect, it } from "vitest";
import { employeeDayOffsByDateQuerySchema, listEmployeeDayOffsQuerySchema, saveEmployeeDayOffsSchema } from "./employeeDayOff.schemas";

const EMPLOYEE = "11111111-1111-4111-8111-111111111111";

describe("employeeDayOff.schemas", () => {
  it("guardado: fecha calendario estricta, UUID por persona, estado ACTIVO/CANCELADO, notas recortadas", () => {
    const parsed = saveEmployeeDayOffsSchema.parse({ date: "2026-11-05", employees: [{ employeeId: EMPLOYEE, status: "ACTIVO", notes: "  pedido  " }] });
    expect(parsed).toEqual({ date: "2026-11-05", employees: [{ employeeId: EMPLOYEE, status: "ACTIVO", notes: "pedido" }] });
  });

  it.each([
    ["fecha imposible", { date: "2026-02-30", employees: [{ employeeId: EMPLOYEE, status: "ACTIVO" }] }],
    ["instante en vez de fecha", { date: "2026-11-05T10:00:00Z", employees: [{ employeeId: EMPLOYEE, status: "ACTIVO" }] }],
    ["employeeId que no es UUID", { date: "2026-11-05", employees: [{ employeeId: "1", status: "ACTIVO" }] }],
    ["estado inventado (no hay tipos de franco)", { date: "2026-11-05", employees: [{ employeeId: EMPLOYEE, status: "DESCANSO" }] }],
    ["lote vacío", { date: "2026-11-05", employees: [] }],
  ])("rechaza %s", (_label, body) => {
    expect(saveEmployeeDayOffsSchema.safeParse(body).success).toBe(false);
  });

  it("lote de hasta 500 personas", () => {
    const employees = Array.from({ length: 501 }, () => ({ employeeId: EMPLOYEE, status: "ACTIVO" }));
    expect(saveEmployeeDayOffsSchema.safeParse({ date: "2026-11-05", employees }).success).toBe(false);
  });

  it("listado por período y consulta por fecha con paginación acotada", () => {
    expect(listEmployeeDayOffsQuerySchema.parse({ period: "2026-11" })).toEqual({ period: "2026-11", page: 1, take: 200 });
    expect(listEmployeeDayOffsQuerySchema.safeParse({ period: "2026-13" }).success).toBe(false);
    expect(employeeDayOffsByDateQuerySchema.parse({ date: "2026-11-05", search: " ana " })).toEqual({ date: "2026-11-05", search: "ana", page: 1, take: 50 });
    expect(employeeDayOffsByDateQuerySchema.safeParse({ date: "2026-11-05", take: "500" }).success).toBe(false);
  });
});
