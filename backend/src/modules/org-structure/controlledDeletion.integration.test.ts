/**
 * Integración REAL de eliminación controlada contra PostgreSQL desechable.
 * Opt-in: DELETION_IT_DATABASE_URL debe apuntar a localhost y a una base
 * deletion_it*. La base se vacía antes de cada prueba; nunca acepta Neon.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env.DELETION_IT_DATABASE_URL;

function assertLocalThrowaway(value: string) {
  const parsed = new URL(value);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)) throw new Error(`DELETION_IT_DATABASE_URL debe ser local (es ${parsed.hostname}).`);
  if (!parsed.pathname.slice(1).startsWith("deletion_it")) throw new Error("La base debe llamarse deletion_it*: se vacía durante la prueba.");
}

describe.skipIf(!url)("eliminación controlada — PostgreSQL local real", () => {
  let db: PrismaClient;
  let other: PrismaClient;
  let orgDeletion: typeof import("./orgStructure.deletion").orgStructureDeletion;
  let positionDeletion: typeof import("../positions/positions.deletion").positionsDeletion;
  let hourConceptDeletion: typeof import("../hour-concepts/hourConcepts.service").hourConceptsService;
  let workforceDeletion: typeof import("../workforce-management/workforce.service").workforceService;
  const actor = { userId: "it-user", ipAddress: "127.0.0.1", userAgent: "vitest" };

  async function truncate() {
    const tables = await db.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`);
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map(({ name }) => `"${name}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }

  async function removeFailureHook() {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS deletion_it_fail_audit ON "AuditLog"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS deletion_it_fail_audit()`);
  }

  async function baseFixture() {
    await db.user.create({ data: { id: "it-user", name: "RRHH IT", email: "rrhh@deletion-it.local", passwordHash: "x", role: "NIVEL_1_RRHH" } });
    const province = await db.province.create({ data: { id: "it-province", code: "IT-P", name: "Provincia IT" } });
    const zone = await db.zone.create({ data: { id: "it-zone", code: "IT-Z", name: "Granjas porcinas", provinceId: province.id } });
    const north = await db.establishment.create({ data: { id: "it-est-n", code: "IT-EN", name: "Granja Norte", isLegacy: false, zoneId: zone.id } });
    const south = await db.establishment.create({ data: { id: "it-est-s", code: "IT-ES", name: "Granja Sur", isLegacy: false, zoneId: zone.id } });
    const unit = await db.establishmentUnit.create({ data: { id: "it-unit", code: "GAL-1", name: "Galpón 1", establishmentId: north.id } });
    const costCenter = await db.costCenter.create({ data: { id: "it-cc", code: "IT-CC", name: "Centro compartido" } });
    await db.costCenterEstablishment.create({ data: { costCenterId: costCenter.id, establishmentId: north.id } });
    const position = await db.position.create({ data: { id: "it-position", code: "IT-POS", name: "Operario porcino" } });
    const employee = await db.employee.create({ data: { id: "it-employee", legajo: "IT-001", cuil: "20-00000001-1", dni: "00000001", firstName: "Ana", lastName: "Integración", positionId: position.id } });
    await db.employeePositionPeriod.create({ data: { id: "it-position-history", employeeId: employee.id, positionId: position.id, effectiveFrom: new Date("2026-01-01"), reason: "Alta IT" } });
    const location = await db.employeeWorkLocation.create({ data: { id: "it-location", employeeId: employee.id, zoneId: zone.id, effectiveFrom: new Date("2026-01-01"), reason: "Alta IT" } });
    await db.employeeWorkLocationEstablishment.create({ data: { workLocationId: location.id, establishmentId: north.id, coverage: "UNITS" } });
    await db.employeeWorkLocationUnit.create({ data: { workLocationId: location.id, establishmentId: north.id, unitId: unit.id } });
    const concept = await db.hourConcept.create({ data: { id: "it-concept", code: "IT-H", name: "Horas IT", kind: "OTRO", loadMode: "MANUAL", workTreatment: "WITHIN_BASE" } });
    const timeEntry = await db.timeEntry.create({ data: { id: "it-time", employeeId: employee.id, hourConceptId: concept.id, date: new Date("2026-02-02"), period: "2026-02", day: 2, hours: 8, totalMinutes: 480 } });
    return { zone, north, south, unit, costCenter, position, employee, location, timeEntry };
  }

  beforeAll(async () => {
    assertLocalThrowaway(url!);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasourceUrl: url });
    other = new PrismaClient({ datasourceUrl: url });
    const schema = await db.$queryRaw<Array<{ zone: string | null; audit: string | null }>>`
      SELECT to_regclass('public."Zone"')::text AS zone,
             to_regclass('public."AuditLog"')::text AS audit
    `;
    if (!schema[0]?.zone || !schema[0]?.audit) throw new Error("La base deletion_it no tiene el esquema Prisma actual aplicado.");
    ({ orgStructureDeletion: orgDeletion } = await import("./orgStructure.deletion"));
    ({ positionsDeletion: positionDeletion } = await import("../positions/positions.deletion"));
    ({ hourConceptsService: hourConceptDeletion } = await import("../hour-concepts/hourConcepts.service"));
    ({ workforceService: workforceDeletion } = await import("../workforce-management/workforce.service"));
  }, 60_000);
  beforeEach(async () => { await removeFailureHook(); await truncate(); });
  afterAll(async () => { await Promise.all([db?.$disconnect(), other?.$disconnect()]); });

  it("zona: procesa establecimientos/unidades, retira el vínculo compartido y conserva persona, horas e historia", async () => {
    const f = await baseFixture();
    const preview = await orgDeletion.preview("zone", f.zone.id);
    expect(preview.groups.filter((group) => group.key.startsWith("establishment.")).reduce((total, group) => total + group.count, 0)).toBe(2);
    expect(preview.groups.find((group) => group.key === "establishmentUnit.archive")?.count).toBe(1);
    await orgDeletion.execute("zone", f.zone.id, { token: preview.token, confirmationText: preview.confirmationText }, actor);
    expect(await db.employee.count({ where: { id: f.employee.id } })).toBe(1);
    expect(await db.timeEntry.count({ where: { id: f.timeEntry.id } })).toBe(1);
    expect(await db.employeePositionPeriod.count({ where: { id: "it-position-history" } })).toBe(1);
    expect(await db.costCenter.count({ where: { id: f.costCenter.id } })).toBe(1);
    expect(await db.costCenterEstablishment.count({ where: { costCenterId: f.costCenter.id } })).toBe(0);
    expect(await db.employeeWorkLocation.findUnique({ where: { id: f.location.id } })).toMatchObject({ employeeId: f.employee.id });
    expect(await db.auditLog.count({ where: { entity: "Zone", entityId: f.zone.id } })).toBe(1);
  }, 60_000);

  it("puesto asignado: archiva, deja al legajo sin puesto y conserva horas e historia", async () => {
    const f = await baseFixture();
    const preview = await positionDeletion.preview(f.position.id);
    await positionDeletion.execute(f.position.id, { token: preview.token, confirmationText: preview.confirmationText }, actor);
    expect(await db.position.findUnique({ where: { id: f.position.id } })).toMatchObject({ archivedAt: expect.any(Date) });
    expect(await db.employee.findUnique({ where: { id: f.employee.id } })).toMatchObject({ positionId: null });
    expect(await db.employeePositionPeriod.count({ where: { employeeId: f.employee.id } })).toBeGreaterThanOrEqual(2);
    expect(await db.timeEntry.count({ where: { id: f.timeEntry.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entity: "Position", entityId: f.position.id } })).toBe(1);
  }, 60_000);

  it("puesto sin asignaciones: un cambio histórico con los mismos ids exige una segunda confirmación", async () => {
    await db.user.create({ data: { id: "it-user", name: "RRHH IT", email: "rrhh@deletion-it.local", passwordHash: "x", role: "NIVEL_1_RRHH" } });
    const company = await db.company.create({ data: { id: "it-company", code: "IT-C", name: "Empresa IT" } });
    const position = await db.position.create({ data: { id: "it-position-free", code: "IT-PF", name: "Puesto libre" } });
    const category = await db.salaryCategory.create({ data: { id: "it-salary", name: "Categoría IT", order: 1 } });
    await db.positionSalaryCategory.create({ data: { positionId: position.id, salaryCategoryId: category.id } });
    const period = await db.positionOrgScopePeriod.create({ data: { id: "it-scope-period", positionId: position.id, effectiveFrom: new Date("2026-01-01"), reason: "Original" } });
    await db.positionOrgScopePeriodNode.create({ data: { id: "it-scope-node", periodId: period.id, level: "COMPANY", companyId: company.id } });

    const first = await positionDeletion.preview(position.id);
    await other.positionOrgScopePeriod.update({ where: { id: period.id }, data: { reason: "Corregido concurrentemente" } });
    await expect(positionDeletion.execute(position.id, { token: first.token }, actor)).rejects.toMatchObject({ code: "DELETION_PREVIEW_CHANGED" });
    expect(await db.position.count({ where: { id: position.id } })).toBe(1);
    expect(await db.positionSalaryCategory.count({ where: { positionId: position.id } })).toBe(1);
    expect(await db.positionOrgScopePeriod.findUniqueOrThrow({ where: { id: period.id } })).toMatchObject({ reason: "Corregido concurrentemente" });
    expect(await db.auditLog.count()).toBe(0);

    const second = await positionDeletion.preview(position.id);
    await positionDeletion.execute(position.id, { token: second.token }, actor);
    expect(await db.position.count({ where: { id: position.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entity: "Position", entityId: position.id } })).toBe(1);
  }, 60_000);

  it("concepto horario: un snapshot abierto cambiado se revierte con token viejo y se confirma con una nueva preview", async () => {
    await db.user.create({ data: { id: "it-user", name: "RRHH IT", email: "rrhh@deletion-it.local", passwordHash: "x", role: "NIVEL_1_RRHH" } });
    const employee = await db.employee.create({ data: { id: "it-hour-employee", legajo: "IT-H01", cuil: "20-00000002-2", dni: "00000002", firstName: "Hora", lastName: "Integración" } });
    await db.hourConcept.create({ data: { id: "it-normal", code: "IT-NORMAL", name: "Horas normales", kind: "NORMAL", systemRole: "NORMAL_BASE" } });
    const concept = await db.hourConcept.create({ data: { id: "it-delete-hour", code: "IT-DEL", name: "Concepto a eliminar", kind: "OTRO", loadMode: "MANUAL", workTreatment: "ADDITIVE_TO_WORKED_TOTAL" } });
    await db.hourConceptBreakdown.create({ data: { id: "it-breakdown", employeeId: employee.id, date: new Date("2026-02-02"), period: "2026-02", day: 2, hourConceptId: concept.id, minutes: 60, source: "MANUAL", status: "EN_REVISION" } });
    const closure = await db.monthlyTimeClosure.create({ data: { id: "it-open-closure", employeeId: employee.id, period: "2026-02", status: "ABIERTO", snapshot: { marker: "preview" } } });

    const first = await hourConceptDeletion.previewDeletion(concept.id);
    await other.monthlyTimeClosure.update({ where: { id: closure.id }, data: { snapshot: { marker: "changed" } } });
    await expect(hourConceptDeletion.executeDeletion(concept.id, { token: first.token, confirmationText: concept.name }, actor)).rejects.toMatchObject({ code: "DELETION_PREVIEW_CHANGED" });
    expect(await db.hourConcept.count({ where: { id: concept.id } })).toBe(1);
    expect(await db.hourConceptBreakdown.count({ where: { id: "it-breakdown" } })).toBe(1);
    expect(await db.monthlyTimeClosure.findUniqueOrThrow({ where: { id: closure.id } })).toMatchObject({ snapshot: { marker: "changed" } });
    expect(await db.auditLog.count()).toBe(0);

    const second = await hourConceptDeletion.previewDeletion(concept.id);
    await hourConceptDeletion.executeDeletion(concept.id, { token: second.token, confirmationText: concept.name }, actor);
    expect(await db.hourConcept.count({ where: { id: concept.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: concept.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entity: "MonthlyTimeClosure", entityId: closure.id } })).toBe(1);
  }, 60_000);

  it("regla sin horas: cambiar multiplicador/prioridad/alcance exige una segunda confirmación", async () => {
    await db.user.create({ data: { id: "it-user", name: "RRHH IT", email: "rrhh@deletion-it.local", passwordHash: "x", role: "NIVEL_1_RRHH" } });
    const company = await db.company.create({ data: { id: "it-rule-company", code: "IT-RC", name: "Empresa regla" } });
    const rule = await db.doubleHourRule.create({ data: { id: "it-rule", name: "Regla sin horas", recurrenceType: "SEMANAL", fromDate: new Date("2026-01-01"), weekdays: [0], multiplier: 2, priority: 1, reason: "IT", companyId: company.id } });

    const first = await workforceDeletion.previewDoubleRuleDeletion(rule.id);
    await other.doubleHourRule.update({ where: { id: rule.id }, data: { multiplier: 3, priority: 2, companyId: null } });
    await expect(workforceDeletion.executeDoubleRuleDeletion(rule.id, { token: first.token }, actor)).rejects.toMatchObject({ code: "DELETION_PREVIEW_CHANGED" });
    expect(await db.doubleHourRule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({ priority: 2, companyId: null, status: "ACTIVO" });
    expect(await db.auditLog.count()).toBe(0);

    const second = await workforceDeletion.previewDoubleRuleDeletion(rule.id);
    await workforceDeletion.executeDoubleRuleDeletion(rule.id, { token: second.token }, actor);
    expect(await db.doubleHourRule.count({ where: { id: rule.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entity: "DoubleHourRule", entityId: rule.id } })).toBe(1);
  }, 60_000);

  it("si falla la auditoría, revierte todas las mutaciones", async () => {
    const f = await baseFixture();
    const preview = await orgDeletion.preview("zone", f.zone.id);
    await db.$executeRawUnsafe(`CREATE FUNCTION deletion_it_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure IT'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER deletion_it_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION deletion_it_fail_audit()`);
    try {
      await expect(orgDeletion.execute("zone", f.zone.id, { token: preview.token, confirmationText: preview.confirmationText }, actor)).rejects.toThrow("audit failure IT");
      expect(await db.zone.findUnique({ where: { id: f.zone.id } })).toMatchObject({ archivedAt: null });
      expect(await db.establishment.count({ where: { zoneId: f.zone.id } })).toBe(2);
      expect(await db.costCenterEstablishment.count({ where: { costCenterId: f.costCenter.id } })).toBe(1);
      expect(await db.employeeWorkLocation.findUnique({ where: { id: f.location.id } })).toMatchObject({ effectiveTo: null });
      expect(await db.auditLog.count()).toBe(0);
    } finally {
      await removeFailureHook();
    }
  }, 60_000);

  it("dos conexiones: la misma selección con otra vigencia invalida el token y la segunda confirmación usa el plan actualizado", async () => {
    const f = await baseFixture();
    const first = await orgDeletion.preview("zone", f.zone.id);
    await other.employeeWorkLocation.update({ where: { id: f.location.id }, data: { effectiveFrom: new Date("2026-01-02") } });
    await expect(orgDeletion.execute("zone", f.zone.id, { token: first.token, confirmationText: first.confirmationText }, actor)).rejects.toMatchObject({ code: "DELETION_PREVIEW_CHANGED" });
    expect(await db.establishment.count({ where: { zoneId: f.zone.id } })).toBe(2);
    expect(await db.employeeWorkLocation.findUniqueOrThrow({ where: { id: f.location.id } })).toMatchObject({ effectiveFrom: new Date("2026-01-02"), effectiveTo: null });
    expect(await db.auditLog.count()).toBe(0);
    const second = await orgDeletion.preview("zone", f.zone.id);
    expect(second.token).not.toBe(first.token);
    expect(second.groups.filter((group) => group.key.startsWith("establishment.")).reduce((total, group) => total + group.count, 0)).toBe(2);
    await orgDeletion.execute("zone", f.zone.id, { token: second.token, confirmationText: second.confirmationText }, actor);
    expect(await db.auditLog.count({ where: { entity: "Zone", entityId: f.zone.id } })).toBe(1);
  }, 60_000);
});
