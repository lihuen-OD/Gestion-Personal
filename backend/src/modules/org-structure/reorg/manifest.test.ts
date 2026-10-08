import { describe, expect, it } from "vitest";
import { stableColumns, verifyV1, verifyV2, type RowManifest, type V1Expectation } from "./manifest";

function manifest(tables: RowManifest["tables"]): RowManifest {
  return { takenAt: "t", host: "h", tables };
}

const empty: V1Expectation = { deleted: {}, nullified: {}, ruleChanges: {}, newRows: {}, newAuditRows: 0 };

const pre = manifest({
  Employee: { key: ["id"], columns: [], rows: { e1: { stable: "p1", watched: { positionId: "pos-1", sectorId: "sec-1", costCenterId: "cc-1" } } } },
  Sector: { key: ["id"], columns: [], rows: { "sec-1": { stable: "s1" } } },
  TimeEntry: { key: ["id"], columns: [], rows: { t1: { stable: "h1" } } },
  DoubleHourRule: { key: ["id"], columns: [], rows: { r1: { stable: "r", watched: { companyId: null, sectorId: null, positionId: "pos-1", status: "ACTIVO" } } } },
  DoubleHourRuleEmployee: { key: ["ruleId", "employeeId"], columns: [], rows: {} },
  AuditLog: { key: ["id"], columns: [], rows: { a1: { stable: "a", watched: { entity: "X", entityId: "1", createdAt: "c" } } } },
});

function clone(value: RowManifest): RowManifest {
  return JSON.parse(JSON.stringify(value)) as RowManifest;
}

describe("stableColumns", () => {
  it("excluye las columnas vigiladas y updatedAt sólo en tablas vigiladas", () => {
    expect(stableColumns("Employee", ["id", "dni", "positionId", "updatedAt"])).toEqual(["id", "dni"]);
    expect(stableColumns("TimeEntry", ["id", "hours", "updatedAt"])).toEqual(["id", "hours", "updatedAt"]);
  });
});

describe("verifyV1", () => {
  it("acepta exactamente los cambios autorizados (vaciado, borrado, R2 y auditoría)", () => {
    const post = clone(pre);
    post.tables.Employee!.rows.e1!.watched = { positionId: null, sectorId: null, costCenterId: "cc-1" };
    delete post.tables.Sector!.rows["sec-1"];
    post.tables.DoubleHourRule!.rows.r1!.watched!.positionId = null;
    post.tables.DoubleHourRuleEmployee!.rows["r1|e1"] = { stable: "x" };
    post.tables.AuditLog!.rows.a2 = { stable: "b" };
    post.tables.AuditLog!.rows.a3 = { stable: "c" };

    const violations = verifyV1(pre, post, {
      deleted: { Sector: ["sec-1"] },
      nullified: { Employee: { e1: ["positionId", "sectorId"] } },
      ruleChanges: { r1: { positionId: null } },
      newRows: { DoubleHourRuleEmployee: ["r1|e1"] },
      newAuditRows: 2,
    });
    expect(violations).toEqual([]);
  });

  it("detecta un dato personal cambiado, un centro de costo tocado y un registro protegido borrado", () => {
    const post = clone(pre);
    post.tables.Employee!.rows.e1!.stable = "otro";
    post.tables.Employee!.rows.e1!.watched!.costCenterId = null;
    delete post.tables.TimeEntry!.rows.t1;
    const codes = verifyV1(pre, post, empty).map((violation) => violation.code);
    expect(codes).toEqual(expect.arrayContaining(["CONTENT_CHANGED", "WATCHED_CHANGED", "UNEXPECTED_DELETE"]));
  });

  it("una regla con su dimensión vaciada sin decisión es una violación (ampliaría la regla)", () => {
    const post = clone(pre);
    post.tables.DoubleHourRule!.rows.r1!.watched!.positionId = null;
    expect(verifyV1(pre, post, empty)).toContainEqual(expect.objectContaining({ table: "DoubleHourRule", code: "WATCHED_CHANGED" }));
  });

  it("detecta filas nuevas no autorizadas y cantidad de auditoría distinta", () => {
    const post = clone(pre);
    post.tables.TimeEntry!.rows.t2 = { stable: "nuevo" };
    const codes = verifyV1(pre, post, { ...empty, newAuditRows: 1 }).map((violation) => violation.code);
    expect(codes).toEqual(expect.arrayContaining(["UNEXPECTED_NEW_ROW", "AUDIT_COUNT"]));
  });
});

describe("verifyV1 — restauración", () => {
  it("con newAuditRows ANY acepta auditoría nueva pero exige todo lo demás idéntico al previo", () => {
    const post = clone(pre);
    post.tables.AuditLog!.rows.a7 = { stable: "limpieza" };
    post.tables.AuditLog!.rows.a8 = { stable: "restauración" };
    expect(verifyV1(pre, post, { ...empty, newAuditRows: "ANY" })).toEqual([]);
    post.tables.Sector!.rows["sec-1"]!.stable = "distinto";
    expect(verifyV1(pre, post, { ...empty, newAuditRows: "ANY" })).toContainEqual(expect.objectContaining({ code: "CONTENT_CHANGED" }));
  });
});

describe("verifyV2", () => {
  it("permite cambios laborales auditados y filas nuevas; exige datos personales y registros protegidos intactos", () => {
    const now = clone(pre);
    now.tables.Employee!.rows.e1!.watched!.positionId = "pos-nuevo";
    now.tables.AuditLog!.rows.a9 = { stable: "z", watched: { entity: "Employee", entityId: "e1", createdAt: "d" } };
    now.tables.TimeEntry!.rows.t2 = { stable: "hora nueva" };
    now.tables.Sector!.rows["sec-nuevo"] = { stable: "n" };
    const summary = verifyV2(pre, now);
    expect(summary.violations).toEqual([]);
    expect(summary.laborChanges).toBe(1);
    expect(summary.newRowsByTable).toMatchObject({ TimeEntry: 1, Sector: 1, AuditLog: 1 });
  });

  it("un cambio laboral sin auditoría o un dato personal cambiado son violaciones", () => {
    const now = clone(pre);
    now.tables.Employee!.rows.e1!.watched!.costCenterId = "cc-2";
    now.tables.TimeEntry!.rows.t1!.stable = "editada";
    const codes = verifyV2(pre, now).violations.map((violation) => violation.code);
    expect(codes).toEqual(expect.arrayContaining(["UNAUDITED_LABOR_CHANGE", "PROTECTED_CHANGED"]));
  });
});

describe("verifyV1 — whitelist de archivo A8 §12.9.4", () => {
  const archivedPre = manifest({
    Sector: {
      key: ["id"], columns: [],
      rows: {
        "sec-keep": { stable: "s1", watched: { archivedAt: null } },
        "sec-other": { stable: "s2", watched: { archivedAt: null } },
        "sec-del": { stable: "s3", watched: { archivedAt: null } },
      },
    },
  });

  it("acepta exactamente archivedAt en los IDs retained, con borrado autorizado, y exige que queden archivados", () => {
    const post = clone(archivedPre);
    post.tables.Sector!.rows["sec-keep"]!.watched!.archivedAt = "2026-10-08T00:00:00.000Z";
    delete post.tables.Sector!.rows["sec-del"];

    const violations = verifyV1(archivedPre, post, { ...empty, archived: { Sector: ["sec-keep"] }, deleted: { Sector: ["sec-del"] } });
    expect(violations).toEqual([]);
  });

  it("archivar un ID fuera de la lista retained y no archivar el esperado aborta (F1.1 + diff fuera del whitelist)", () => {
    const post = clone(archivedPre);
    post.tables.Sector!.rows["sec-other"]!.watched!.archivedAt = "2026-10-08T00:00:00.000Z";

    const codes = verifyV1(archivedPre, post, { ...empty, archived: { Sector: ["sec-keep"] } }).map((violation) => violation.code);
    expect(codes).toEqual(expect.arrayContaining(["WATCHED_CHANGED", "NOT_ARCHIVED"]));
  });

  it("un ID retained que no quedó archivado viola F1.1 con su clave exacta", () => {
    const violations = verifyV1(archivedPre, clone(archivedPre), { ...empty, archived: { Sector: ["sec-keep"] } });
    expect(violations).toContainEqual(expect.objectContaining({ table: "Sector", key: "sec-keep", code: "NOT_ARCHIVED" }));
  });
});
