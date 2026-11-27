import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeTimeResponsibleWhere } from "../employees/employeeAccess";
import { resolveEmployeeNotificationRecipients, resolveEmployeeNotificationRecipientsBatch, type RecipientsReader } from "./employeeNotificationRecipients";

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));

// Unitarios: qué le pide el resolver a la base (filtros canónicos) y cómo
// compone el resultado en memoria (unión, herencia, dedupe). La semántica real
// de esos filtros contra PostgreSQL (usuarios inactivos, vigencias, roles
// cambiados) la prueba employeeNotificationRecipients.integration.test.ts.

type Assignment = { employeeId: string; userId: string | null };
type Supervision = { supervisorUserId: string; supervisedUserId: string };

const N3 = "NIVEL_3_CARGA_HORARIA";
const N2 = "NIVEL_2_SUPERVISION";
const DAY = "2026-11-17";

// `assignments` simula lo que devuelve la base YA filtrada (sólo Nivel 2
// ACTIVO); el filtro en sí se verifica en "consultas".
function fakeDb(rows: { rrhh?: string[]; assignments?: Assignment[]; supervisions?: Supervision[] }) {
  const db = {
    user: { findMany: vi.fn().mockResolvedValue((rows.rrhh ?? []).map((id) => ({ id }))) },
    employeeAssignment: { findMany: vi.fn().mockResolvedValue(rows.assignments ?? []) },
    userSupervisionAssignment: {
      findMany: vi.fn(async (args: { where: { supervisorUserId: { in: string[] } } }) =>
        (rows.supervisions ?? []).filter((row) => args.where.supervisorUserId.in.includes(row.supervisorUserId))),
    },
  };
  return db as typeof db & RecipientsReader;
}

const direct = (employeeId: string, userId: string): Assignment => ({ employeeId, userId });

describe("resolveEmployeeNotificationRecipientsBatch — consultas", () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    db = fakeDb({ rrhh: ["rrhh"], assignments: [direct("emp", "eugenia")], supervisions: [{ supervisorUserId: "eugenia", supervisedUserId: "joaquin" }] });
  });

  it("RRHH: sólo usuarios ACTIVO con rol Nivel 1", async () => {
    await resolveEmployeeNotificationRecipientsBatch(["emp"], DAY, db);
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { role: "NIVEL_1_RRHH", status: "ACTIVO" }, select: { id: true } });
  });

  it("asignaciones: vigencia canónica + usuario Nivel 2 ACTIVO, todos los legajos en una consulta", async () => {
    await resolveEmployeeNotificationRecipientsBatch(["emp", "emp-2", "emp"], DAY, db);
    expect(db.employeeAssignment.findMany).toHaveBeenCalledTimes(1);
    const where = db.employeeAssignment.findMany.mock.calls[0]![0].where;
    expect(where.AND).toEqual([activeTimeResponsibleWhere(DAY), { employeeId: { in: ["emp", "emp-2"] } }, { user: { role: N2, status: "ACTIVO" } }]);
  });

  it("supervisiones: Nivel 3 ACTIVO supervisados por los Nivel 2 responsables, ambos lados verificados, una consulta", async () => {
    await resolveEmployeeNotificationRecipientsBatch(["emp"], DAY, db);
    expect(db.userSupervisionAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(db.userSupervisionAssignment.findMany.mock.calls[0]![0].where).toEqual({
      supervisorUserId: { in: ["eugenia"] },
      supervised: { role: N3, status: "ACTIVO" },
      supervisor: { role: N2, status: "ACTIVO" },
    });
  });

  it("sin legajos no consulta nada", async () => {
    expect((await resolveEmployeeNotificationRecipientsBatch([], DAY, db)).size).toBe(0);
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.employeeAssignment.findMany).not.toHaveBeenCalled();
  });

  it("sin responsables Nivel 2 no consulta supervisiones", async () => {
    db = fakeDb({ rrhh: ["rrhh"] });
    await resolveEmployeeNotificationRecipientsBatch(["emp"], DAY, db);
    expect(db.userSupervisionAssignment.findMany).not.toHaveBeenCalled();
  });
});

describe("resolveEmployeeNotificationRecipientsBatch — composición", () => {
  it("caso Planta: RRHH + Planta (N2 responsable) + Nivel 3 que supervisa", async () => {
    const db = fakeDb({ rrhh: ["rrhh"], assignments: [direct("992", "planta")], supervisions: [{ supervisorUserId: "planta", supervisedUserId: "carga" }] });
    expect(await resolveEmployeeNotificationRecipients("992", DAY, db)).toEqual(["rrhh", "planta", "carga"]);
  });

  it("Nivel 2 responsable sin supervisados recibe sólo él", async () => {
    const db = fakeDb({ rrhh: ["rrhh"], assignments: [direct("emp", "eugenia")] });
    expect(await resolveEmployeeNotificationRecipients("emp", DAY, db)).toEqual(["rrhh", "eugenia"]);
  });

  it("Nivel 3 supervisado por OTRO Nivel 2 no recibe", async () => {
    const db = fakeDb({ assignments: [direct("emp", "eugenia")], supervisions: [{ supervisorUserId: "otra-n2", supervisedUserId: "otro-n3" }] });
    expect(await resolveEmployeeNotificationRecipients("emp", DAY, db)).toEqual(["eugenia"]);
  });

  it("Nivel 3 con dos Nivel 2 responsables del mismo legajo → un solo userId", async () => {
    const db = fakeDb({
      assignments: [direct("emp", "eugenia"), direct("emp", "planta")],
      supervisions: [{ supervisorUserId: "eugenia", supervisedUserId: "joaquin" }, { supervisorUserId: "planta", supervisedUserId: "joaquin" }],
    });
    expect((await resolveEmployeeNotificationRecipients("emp", DAY, db)).sort()).toEqual(["eugenia", "joaquin", "planta"]);
  });

  it("filas repetidas y RRHH que además figura nunca duplican", async () => {
    const db = fakeDb({ rrhh: ["rrhh"], assignments: [direct("emp", "eugenia"), direct("emp", "eugenia")], supervisions: [{ supervisorUserId: "eugenia", supervisedUserId: "rrhh" }] });
    expect(await resolveEmployeeNotificationRecipients("emp", DAY, db)).toEqual(["rrhh", "eugenia"]);
  });

  it("batch: Map por legajo; legajo sin responsables recibe sólo RRHH", async () => {
    const db = fakeDb({
      rrhh: ["rrhh"],
      assignments: [direct("a", "eugenia"), direct("b", "planta")],
      supervisions: [{ supervisorUserId: "eugenia", supervisedUserId: "joaquin" }],
    });
    const map = await resolveEmployeeNotificationRecipientsBatch(["a", "b", "c"], DAY, db);
    expect(Object.fromEntries(map)).toEqual({ a: ["rrhh", "eugenia", "joaquin"], b: ["rrhh", "planta"], c: ["rrhh"] });
    expect(db.userSupervisionAssignment.findMany).toHaveBeenCalledTimes(1);
  });
});
