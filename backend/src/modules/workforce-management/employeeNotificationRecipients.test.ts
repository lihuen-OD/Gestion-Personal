import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeTimeResponsibleWhere } from "../employees/employeeAccess";
import { resolveEmployeeNotificationRecipients, resolveEmployeeNotificationRecipientsBatch, type RecipientsReader } from "./employeeNotificationRecipients";

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));

// Unitarios: qué le pide el resolver a la base (filtros canónicos) y cómo
// compone el resultado en memoria (unión, herencia, dedupe). La semántica real
// de esos filtros contra PostgreSQL (usuarios inactivos, vigencias, roles
// cambiados) la prueba employeeNotificationRecipients.integration.test.ts.

type Assignment = { employeeId: string; userId: string | null; user: { role: string } | null };
type Supervision = { supervisorUserId: string; supervisedUserId: string };

const N3 = "NIVEL_3_CARGA_HORARIA";
const N2 = "NIVEL_2_SUPERVISION";
const DAY = "2026-11-17";

function fakeDb(rows: { rrhh?: string[]; assignments?: Assignment[]; supervisions?: Supervision[] }) {
  const db = {
    user: { findMany: vi.fn().mockResolvedValue((rows.rrhh ?? []).map((id) => ({ id }))) },
    employeeAssignment: { findMany: vi.fn().mockResolvedValue(rows.assignments ?? []) },
    userSupervisionAssignment: {
      findMany: vi.fn(async (args: { where: { supervisedUserId: { in: string[] } } }) =>
        (rows.supervisions ?? []).filter((row) => args.where.supervisedUserId.in.includes(row.supervisedUserId))),
    },
  };
  return db as typeof db & RecipientsReader;
}

const direct = (employeeId: string, userId: string, role: string): Assignment => ({ employeeId, userId, user: { role } });

describe("resolveEmployeeNotificationRecipientsBatch — consultas", () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    db = fakeDb({ rrhh: ["rrhh"], assignments: [direct("emp", "joaquin", N3)], supervisions: [{ supervisorUserId: "eugenia", supervisedUserId: "joaquin" }] });
  });

  it("RRHH: sólo usuarios ACTIVO con rol Nivel 1 (1, 2)", async () => {
    await resolveEmployeeNotificationRecipientsBatch(["emp"], DAY, db);
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { role: "NIVEL_1_RRHH", status: "ACTIVO" }, select: { id: true } });
  });

  it("asignaciones: criterio canónico de vigencia en la fecha de referencia + usuario ACTIVO, todos los legajos en una consulta (11-14)", async () => {
    await resolveEmployeeNotificationRecipientsBatch(["emp", "emp-2", "emp"], DAY, db);
    expect(db.employeeAssignment.findMany).toHaveBeenCalledTimes(1);
    const where = db.employeeAssignment.findMany.mock.calls[0]![0].where;
    expect(where.AND).toEqual([activeTimeResponsibleWhere(DAY), { employeeId: { in: ["emp", "emp-2"] } }, { user: { status: "ACTIVO" } }]);
    // Ningún filtro por EmployeeAssignment.role (legacy).
    expect(JSON.stringify(where)).not.toContain('"role"');
  });

  it("supervisiones: ambos lados verificados por rol y estado al resolver, una consulta para todos los Nivel 3 (7-10)", async () => {
    await resolveEmployeeNotificationRecipientsBatch(["emp"], DAY, db);
    expect(db.userSupervisionAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(db.userSupervisionAssignment.findMany.mock.calls[0]![0].where).toEqual({
      supervisedUserId: { in: ["joaquin"] },
      supervised: { role: N3, status: "ACTIVO" },
      supervisor: { role: N2, status: "ACTIVO" },
    });
  });

  it("sin legajos no consulta nada", async () => {
    expect((await resolveEmployeeNotificationRecipientsBatch([], DAY, db)).size).toBe(0);
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.employeeAssignment.findMany).not.toHaveBeenCalled();
  });

  it("sin responsables Nivel 3 no consulta supervisiones", async () => {
    db = fakeDb({ rrhh: ["rrhh"], assignments: [direct("emp", "eugenia", N2)] });
    await resolveEmployeeNotificationRecipientsBatch(["emp"], DAY, db);
    expect(db.userSupervisionAssignment.findMany).not.toHaveBeenCalled();
  });
});

describe("resolveEmployeeNotificationRecipientsBatch — composición", () => {
  it("caso real: RRHH + Joaquín (N3 responsable) + Eugenia (N2 que lo supervisa) (1, 3, 5)", async () => {
    const db = fakeDb({ rrhh: ["rrhh"], assignments: [direct("oficina", "joaquin", N3)], supervisions: [{ supervisorUserId: "eugenia", supervisedUserId: "joaquin" }] });
    expect(await resolveEmployeeNotificationRecipients("oficina", DAY, db)).toEqual(["rrhh", "joaquin", "eugenia"]);
  });

  it("Nivel 2 responsable directo recibe (4)", async () => {
    const db = fakeDb({ rrhh: ["rrhh"], assignments: [direct("emp", "eugenia", N2)] });
    expect(await resolveEmployeeNotificationRecipients("emp", DAY, db)).toEqual(["rrhh", "eugenia"]);
  });

  it("Nivel 2 que supervisa a OTRO Nivel 3 no recibe (6)", async () => {
    const db = fakeDb({
      assignments: [direct("emp", "joaquin", N3)],
      supervisions: [{ supervisorUserId: "otra-n2", supervisedUserId: "otro-n3" }],
    });
    expect(await resolveEmployeeNotificationRecipients("emp", DAY, db)).toEqual(["joaquin"]);
  });

  it("responsable directo con rol distinto de Nivel 3 no genera herencia aunque exista una relación (9)", async () => {
    const db = fakeDb({
      assignments: [direct("emp", "ex-n3", "NIVEL_2_SUPERVISION")],
      supervisions: [{ supervisorUserId: "eugenia", supervisedUserId: "ex-n3" }],
    });
    expect(await resolveEmployeeNotificationRecipients("emp", DAY, db)).toEqual(["ex-n3"]);
  });

  it("Nivel 2 directo y además heredado → un solo userId (15)", async () => {
    const db = fakeDb({
      rrhh: ["rrhh"],
      assignments: [direct("emp", "eugenia", N2), direct("emp", "joaquin", N3)],
      supervisions: [{ supervisorUserId: "eugenia", supervisedUserId: "joaquin" }],
    });
    const recipients = await resolveEmployeeNotificationRecipients("emp", DAY, db);
    expect(recipients.filter((id) => id === "eugenia")).toHaveLength(1);
    expect(recipients.sort()).toEqual(["eugenia", "joaquin", "rrhh"]);
  });

  it("Nivel 2 que supervisa dos responsables del mismo legajo → un solo userId (16)", async () => {
    const db = fakeDb({
      assignments: [direct("emp", "joaquin", N3), direct("emp", "maria", N3)],
      supervisions: [{ supervisorUserId: "eugenia", supervisedUserId: "joaquin" }, { supervisorUserId: "eugenia", supervisedUserId: "maria" }],
    });
    expect((await resolveEmployeeNotificationRecipients("emp", DAY, db)).sort()).toEqual(["eugenia", "joaquin", "maria"]);
  });

  it("filas equivalentes repetidas y RRHH que además es responsable nunca duplican", async () => {
    const db = fakeDb({ rrhh: ["rrhh"], assignments: [direct("emp", "joaquin", N3), direct("emp", "joaquin", N3), direct("emp", "rrhh", "NIVEL_1_RRHH")] });
    expect(await resolveEmployeeNotificationRecipients("emp", DAY, db)).toEqual(["rrhh", "joaquin"]);
  });

  it("batch: Map por legajo, cada uno con sus responsables; legajo sin responsables recibe sólo RRHH", async () => {
    const db = fakeDb({
      rrhh: ["rrhh"],
      assignments: [direct("a", "joaquin", N3), direct("b", "maria", N3)],
      supervisions: [{ supervisorUserId: "eugenia", supervisedUserId: "joaquin" }],
    });
    const map = await resolveEmployeeNotificationRecipientsBatch(["a", "b", "c"], DAY, db);
    expect(Object.fromEntries(map)).toEqual({ a: ["rrhh", "joaquin", "eugenia"], b: ["rrhh", "maria"], c: ["rrhh"] });
    expect(db.employeeAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(db.userSupervisionAssignment.findMany).toHaveBeenCalledTimes(1);
  });
});
