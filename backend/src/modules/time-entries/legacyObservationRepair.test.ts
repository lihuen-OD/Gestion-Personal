import { describe, expect, it, vi } from "vitest";
import {
  applyObservationRepairs,
  assertStagingTarget,
  proposeObservationRepair,
  StaleObservationError,
  type ReferencedEntry,
  type ReferencedWorkShift,
} from "./legacyObservationRepair";
import { RETIRED_DUPLICATE_NOTE } from "./normalHoursReconciliation";

const retiredId = "116d2b2c-3510-46cc-bf4d-7eda6976ff6d";
const canonicalId = "e92bb60e-cf14-47ba-a79b-ae0814163741";
const employeeId = "18775715-d7b9-40d1-9fee-6c23cacd50c2";
const date = new Date("2026-09-02T00:00:00.000Z");
const legacy = `Generado por fichada de ingreso/salida.\nRetirada de cómputo por reconciliación 15M.4 -- fusionada en TimeEntry ${canonicalId}.`;
const row = { id: retiredId, employeeId, date, workShiftId: null, observation: legacy };
const canonical: ReferencedEntry = { id: canonicalId, employeeId, date, isNormalBase: true };
const referencesWith = (...entries: ReferencedEntry[]) => ({ timeEntries: new Map(entries.map((entry) => [entry.id, entry])), workShifts: new Map() });

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

  it("un texto con id que no coincide con ningún patrón conocido → no se modifica", () => {
    const observation = "Revisado contra 5867bcd8-5e31-4cb7-89a9-ff27c2bd27a8 por el encargado.";
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

// "Fichada <workShiftId>: generado por ingreso/salida." (motor de fichadas viejo).
describe("proposeObservationRepair — 'Fichada <id>' apunta a una jornada (WorkShift)", () => {
  const entryId = "59d57ec9-5077-41f9-9825-c0c14a01a940";
  const workShiftId = "b48a2ab5-9681-4fb5-b1bb-ce9f7e9982a6";
  const entryDate = new Date("2026-09-16T00:00:00.000Z");
  const observation = `Generado por fichada de ingreso/salida.\nFichada ${workShiftId}: generado por ingreso/salida.\nReconciliación histórica 15M.4 (2026-09-17T13:33:43.550Z): total ajustado a 250 min reales desde WorkShift/TimeSegment.`;
  const entry = { id: entryId, employeeId, date: entryDate, workShiftId, observation };
  const shift: ReferencedWorkShift = { id: workShiftId, employeeId, segmentDates: [entryDate] };
  const lookupsWith = (...shifts: ReferencedWorkShift[]) => ({ timeEntries: new Map(), workShifts: new Map(shifts.map((item) => [item.id, item])) });

  it("A) jornada válida del mismo empleado que originó la carga → texto de negocio, resto intacto", () => {
    const proposal = proposeObservationRepair(entry, lookupsWith(shift));

    expect(proposal.status).toBe("repair");
    const after = proposal.status === "repair" ? proposal.after : "";
    expect(after).toBe("Generado por fichada de ingreso/salida.\nGenerado automáticamente a partir de la fichada.\nReconciliación histórica 15M.4 (2026-09-17T13:33:43.550Z): total ajustado a 250 min reales desde WorkShift/TimeSegment.");
    // F) el texto generado nunca incluye el id de la jornada.
    expect(after).not.toContain(workShiftId);
  });

  it("B) la jornada es de otro empleado → no se repara", () => {
    expect(proposeObservationRepair(entry, lookupsWith({ ...shift, employeeId: "otro-empleado" })))
      .toMatchObject({ status: "skip", reason: "la jornada referenciada es de otro empleado" });
  });

  it("C) la jornada no existe → no se repara", () => {
    expect(proposeObservationRepair(entry, lookupsWith())).toMatchObject({ status: "skip", reason: "la jornada (WorkShift) referenciada no existe" });
  });

  it("del mismo empleado pero sin relación con esta carga (otro workShiftId y sin tramos en la fecha) → no se repara", () => {
    const unrelated = { ...shift, segmentDates: [new Date("2026-09-20T00:00:00.000Z")] };
    expect(proposeObservationRepair({ ...entry, workShiftId: "otra-jornada" }, lookupsWith(unrelated)))
      .toMatchObject({ status: "skip", reason: "la jornada referenciada no originó esta carga (ni workShiftId ni tramos en la fecha)" });
  });

  it("basta una evidencia de origen: tramos en la fecha aunque workShiftId apunte a otra jornada (carga fusionada)", () => {
    expect(proposeObservationRepair({ ...entry, workShiftId: "otra-jornada" }, lookupsWith(shift))).toMatchObject({ status: "repair" });
  });
});
