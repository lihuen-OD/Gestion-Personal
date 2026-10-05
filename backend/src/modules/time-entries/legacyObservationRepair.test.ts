import { describe, expect, it, vi } from "vitest";
import {
  applyObservationRepairs,
  assertStagingTarget,
  proposeObservationRepair,
  StaleObservationError,
  type ReferencedEntry,
} from "./legacyObservationRepair";
import { RETIRED_DUPLICATE_NOTE } from "./normalHoursReconciliation";

const retiredId = "116d2b2c-3510-46cc-bf4d-7eda6976ff6d";
const canonicalId = "e92bb60e-cf14-47ba-a79b-ae0814163741";
const employeeId = "18775715-d7b9-40d1-9fee-6c23cacd50c2";
const date = new Date("2026-09-02T00:00:00.000Z");
const legacy = `Generado por fichada de ingreso/salida.\nRetirada de cómputo por reconciliación 15M.4 -- fusionada en TimeEntry ${canonicalId}.`;
const row = { id: retiredId, employeeId, date, observation: legacy };
const canonical: ReferencedEntry = { id: canonicalId, employeeId, date, isNormalBase: true };
const referencesWith = (...entries: ReferencedEntry[]) => new Map(entries.map((entry) => [entry.id, entry]));

describe("proposeObservationRepair — observaciones legadas de TimeEntry", () => {
  it("A) id válido (canónica del mismo empleado/día, Horas normales) → texto vigente, sin ids", () => {
    const proposal = proposeObservationRepair(row, referencesWith(canonical));

    expect(proposal).toMatchObject({ status: "repair", before: legacy });
    expect(proposal.status === "repair" && proposal.after).toBe(`Generado por fichada de ingreso/salida.\n${RETIRED_DUPLICATE_NOTE}`);
    expect(JSON.stringify(proposal.status === "repair" && proposal.after)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("B) TimeEntry referenciado inexistente → no se modifica", () => {
    expect(proposeObservationRepair(row, referencesWith())).toMatchObject({ status: "skip", reason: "el TimeEntry referenciado no existe" });
  });

  it.each([
    ["otro empleado", { ...canonical, employeeId: "otro" }, "el TimeEntry referenciado es de otro empleado"],
    ["otra fecha", { ...canonical, date: new Date("2026-09-03T00:00:00.000Z") }, "el TimeEntry referenciado es de otra fecha"],
    ["no es Horas normales", { ...canonical, isNormalBase: false }, "el TimeEntry referenciado no es la carga de Horas normales"],
  ])("referencia ambigua (%s) → no se modifica", (_label, reference, reason) => {
    expect(proposeObservationRepair(row, referencesWith(reference))).toMatchObject({ status: "skip", reason });
  });

  it("otro texto legado ('Fichada <id>: ...', id de una jornada) no coincide con el patrón → no se modifica", () => {
    const observation = "Fichada 5867bcd8-5e31-4cb7-89a9-ff27c2bd27a8: generado por ingreso/salida.";
    expect(proposeObservationRepair({ ...row, observation }, referencesWith(canonical))).toMatchObject({ status: "skip", before: observation });
  });

  it("más de un id en la observación → no se modifica", () => {
    const observation = `Fichada 5867bcd8-5e31-4cb7-89a9-ff27c2bd27a8: x.\n${legacy}`;
    expect(proposeObservationRepair({ ...row, observation }, referencesWith(canonical))).toMatchObject({ status: "skip", reason: "la observación contiene más de un id técnico" });
  });
});

describe("assertStagingTarget", () => {
  it("C) production → aborta", () => {
    expect(() => assertStagingTarget("production", "development")).toThrow(/ABORT: entorno production/);
    expect(() => assertStagingTarget("staging", "production")).toThrow(/ABORT: entorno production/);
  });

  it("cualquier otro entorno que no sea staging → aborta", () => {
    expect(() => assertStagingTarget("local", "development")).toThrow(/sólo corre con APP_ENV=staging/);
  });

  it("staging → continúa", () => {
    expect(() => assertStagingTarget("staging", "development")).not.toThrow();
  });
});

describe("applyObservationRepairs — todo o nada", () => {
  const repairs = [
    { id: "entry-1", before: "a fusionada en TimeEntry x.", after: "a ok" },
    { id: "entry-2", before: "b fusionada en TimeEntry y.", after: "b ok" },
  ];

  it("actualiza cada fila sólo si su observación sigue siendo la leída", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { $transaction: <T>(fn: (tx: never) => Promise<T>) => fn({ timeEntry: { updateMany } } as never) };

    await expect(applyObservationRepairs(db, repairs)).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "entry-1", observation: repairs[0]!.before }, data: { observation: "a ok" } });
  });

  it("D) una fila modificada entre lectura y apply → no sobrescribe y revierte todo (error explícito)", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    let rolledBack = false;
    const db = {
      $transaction: async <T>(fn: (tx: never) => Promise<T>) => {
        try {
          return await fn({ timeEntry: { updateMany } } as never);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    };

    await expect(applyObservationRepairs(db, repairs)).rejects.toBeInstanceOf(StaleObservationError);
    expect(rolledBack).toBe(true);
    // La fila cambiada nunca se escribe sin la condición de "sin cambios".
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: "entry-2", observation: repairs[1]!.before }, data: { observation: "b ok" } });
  });
});
