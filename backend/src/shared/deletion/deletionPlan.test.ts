import { describe, expect, it, vi } from "vitest";
import { assertActorAuthorizedWithin, assertConfirmedPlan, deletionConflictResponse, DeletionPlanBuilder, TYPED_CONFIRMATION_THRESHOLD } from "./deletionPlan";
import { AppError } from "../errors/AppError";

const target = { kind: "zone", id: "zone-1", code: "ZN-1", name: "Granjas porcinas", label: "Zona" };
const items = (count: number, prefix = "e") => Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, name: `Nombre ${index}` }));

describe("DeletionPlanBuilder", () => {
  it("agrupa por clave, deduplica ids y ordena por nombre", () => {
    const preview = new DeletionPlanBuilder()
      .add("establishment.delete", "DELETE", "Establecimientos", "Se borran", [{ id: "b", name: "La Sucho" }, { id: "a", name: "La Honoria" }])
      .add("establishment.delete", "DELETE", "Establecimientos", "Se borran", [{ id: "a", name: "La Honoria" }])
      .add("vacío", "DELETE", "Nada", "Nada", [])
      .build(target);
    expect(preview.groups).toEqual([{ key: "establishment.delete", effect: "DELETE", label: "Establecimientos", consequence: "Se borran", count: 2, items: [{ id: "a", name: "La Honoria" }, { id: "b", name: "La Sucho" }] }]);
  });

  it("la huella cambia si cambia cualquier id alcanzado, aunque el detalle no se liste", () => {
    const base = () => new DeletionPlanBuilder().add("rows", "RECALCULATE", "Filas", "x", items(3), { listed: false });
    const a = base().build(target);
    const b = base().build(target);
    const c = new DeletionPlanBuilder().add("rows", "RECALCULATE", "Filas", "x", items(4), { listed: false }).build(target);
    expect(a.token).toBe(b.token);
    expect(c.token).not.toBe(a.token);
    expect(a.groups[0]).toMatchObject({ count: 3, items: [] });
  });

  it("pide escribir el nombre si afecta personas, archiva o alcanza muchos registros", () => {
    expect(new DeletionPlanBuilder().add("x", "DELETE", "x", "x", items(1)).build(target).requiresTypedConfirmation).toBe(false);
    expect(new DeletionPlanBuilder().add("x", "END", "x", "x", items(1), { affectsPeople: true }).build(target).requiresTypedConfirmation).toBe(true);
    expect(new DeletionPlanBuilder().add("x", "ARCHIVE", "x", "x", items(1)).build(target).requiresTypedConfirmation).toBe(true);
    expect(new DeletionPlanBuilder().add("x", "DELETE", "x", "x", items(TYPED_CONFIRMATION_THRESHOLD)).build(target).requiresTypedConfirmation).toBe(true);
  });

  it("lista hasta 50 ítems pero cuenta todos", () => {
    const preview = new DeletionPlanBuilder().add("x", "DELETE", "x", "x", items(70)).build(target);
    expect(preview.groups[0]).toMatchObject({ count: 70 });
    expect(preview.groups[0]!.items).toHaveLength(50);
  });
});

describe("assertConfirmedPlan", () => {
  const preview = new DeletionPlanBuilder().add("x", "ARCHIVE", "x", "x", items(1)).build(target);

  it("plan distinto al de la vista previa → 409 con la vista previa nueva", () => {
    try {
      assertConfirmedPlan(preview, { token: "0".repeat(64), confirmationText: target.name });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, code: "DELETION_PREVIEW_CHANGED", details: { preview } });
      expect(deletionConflictResponse(error)).toEqual({ status: 409, body: { error: { code: "DELETION_PREVIEW_CHANGED", message: expect.any(String) }, preview } });
    }
  });

  it("bloqueos → 409 DELETION_BLOCKED", () => {
    const blocked = new DeletionPlanBuilder().block("PERIOD_CLOSED", "Período aprobado.").build(target);
    expect(() => assertConfirmedPlan(blocked, { token: blocked.token })).toThrow(expect.objectContaining({ code: "DELETION_BLOCKED" }));
  });

  it("el nombre escrito se compara sin mayúsculas ni espacios de más; si no coincide, 400", () => {
    expect(() => assertConfirmedPlan(preview, { token: preview.token, confirmationText: "  granjas   PORCINAS " })).not.toThrow();
    expect(() => assertConfirmedPlan(preview, { token: preview.token, confirmationText: "Granjas" })).toThrow(expect.objectContaining({ statusCode: 400, code: "DELETION_CONFIRMATION_MISMATCH" }));
  });

  it("otros errores no son conflictos de confirmación", () => {
    expect(deletionConflictResponse(new AppError("x", 400, "OTRO"))).toBeNull();
  });
});

describe("assertActorAuthorizedWithin", () => {
  const tx = (user: unknown) => ({ user: { findUnique: vi.fn().mockResolvedValue(user) } }) as never;
  it("relee rol y estado dentro de la transacción", async () => {
    await expect(assertActorAuthorizedWithin(tx({ role: "NIVEL_1_RRHH", status: "ACTIVO" }), "u1", ["NIVEL_1_RRHH"])).resolves.toBeUndefined();
    await expect(assertActorAuthorizedWithin(tx({ role: "NIVEL_2_SUPERVISION", status: "ACTIVO" }), "u1", ["NIVEL_1_RRHH"])).rejects.toMatchObject({ statusCode: 403, code: "DELETION_FORBIDDEN" });
    await expect(assertActorAuthorizedWithin(tx({ role: "NIVEL_1_RRHH", status: "INACTIVO" }), "u1", ["NIVEL_1_RRHH"])).rejects.toMatchObject({ statusCode: 403 });
    await expect(assertActorAuthorizedWithin(tx(null), null, ["NIVEL_1_RRHH"])).rejects.toMatchObject({ statusCode: 403 });
  });
});
