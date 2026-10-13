import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { employeeReferenceSelect, formatEmployeeReference } from "../../shared/audit/employeeReference";
import { findProtectedClosurePeriods } from "../../shared/monthlyClosure/closurePeriodGuard";
import { adminRoles } from "../../shared/security/roles";
import { assertActorAuthorizedWithin, assertConfirmedPlan, DeletionPlanBuilder, type DeletionConfirmation, type DeletionPreview } from "../../shared/deletion/deletionPlan";
import { employeesService } from "../employees/employees.service";
import { mapLaborHistoryPersistenceError } from "../labor-history/laborHistory.service";
import { invalidatePositionsCache } from "./positions.repository";
import { positionsService } from "./positions.service";

/**
 * Eliminación controlada de un puesto (protocolo de shared/deletion).
 * - Las personas que lo tienen quedan sin puesto desde HOY, con la historia
 *   de un cambio manual (pendientes de recarga); nada anterior cambia.
 * - Si alguien lo tuvo alguna vez o una regla de horas especiales lo usa, el
 *   puesto se ARCHIVA: la historia y la regla lo siguen referenciando. Su
 *   alcance vigente se cierra desde hoy (queda en la historia por fecha).
 * - Si nadie lo usó nunca, se ELIMINA con su configuración propia (alcance,
 *   historia de alcance y categorías salariales).
 * - Las reglas de horas especiales no se amplían ni se recalculan: conservan
 *   el puesto archivado y se marcan para revisar.
 */

type Db = PrismaTransactionClient;

async function buildPlan(db: Db, id: string, todayKey: string) {
  const position = await db.position.findUnique({
    where: { id },
    select: { id: true, code: true, name: true, archivedAt: true, _count: { select: { employeePeriods: true, orgScopes: true, salaryCategories: true, scopePeriods: true } } },
  });
  if (!position) throw new AppError("Position not found", 404, "POSITION_NOT_FOUND");
  const [employees, rules] = await Promise.all([
    db.employee.findMany({ where: { positionId: id }, select: { id: true, ...employeeReferenceSelect } }),
    db.doubleHourRule.findMany({ where: { positionId: id }, select: { id: true, name: true } }),
  ]);
  const archive = position._count.employeePeriods > 0 || employees.length > 0 || rules.length > 0;
  const label = `${position.code} · ${position.name}`;
  const builder = new DeletionPlanBuilder();
  builder.add(archive ? "position.archive" : "position.delete", archive ? "ARCHIVE" : "DELETE", archive ? "Puesto que se archiva" : "Puesto que se elimina", archive
    ? "Sale de listados y selectores, pero se conserva porque la historia laboral o una regla de horas especiales lo referencia. Su alcance vigente se cierra desde hoy."
    : "Nadie lo tuvo nunca: se borra con su alcance, su historia de alcance y sus categorías salariales.", [{ id, name: label }]);
  builder.add("employee.position", "END", "Legajos que quedan sin puesto desde hoy", "Se registra el cambio desde hoy en la historia laboral; quedan pendientes de recarga hasta que se les asigne otro puesto.", employees.map((row) => ({ id: row.id, name: formatEmployeeReference(row) })), { affectsPeople: true });
  builder.add("doubleHourRule.review", "REVIEW", "Reglas de horas especiales para revisar", "Conservan el puesto (archivado) en su alcance: no se amplían ni cambian sus resultados históricos y dejan de alcanzar a quien ya no tiene el puesto. Revisalas.", rules.map((rule) => ({ id: rule.id, name: rule.name })));
  const protectedPeriods = await findProtectedClosurePeriods(db, employees.map((row) => ({ employeeId: row.id, period: todayKey.slice(0, 7) })));
  if (protectedPeriods.size) {
    builder.block("DELETION_CLOSURE_PROTECTED", `Hay ${protectedPeriods.size} ${protectedPeriods.size === 1 ? "legajo" : "legajos"} con el período ${todayKey.slice(0, 7)} ya enviado o aprobado: el cambio desde hoy no se puede registrar hasta que se pida su corrección.`);
  }
  if (position.archivedAt) builder.block("POSITION_ARCHIVED", `El puesto “${position.name}” ya está archivado.`);
  return { preview: builder.build({ kind: "position", id, code: position.code, name: position.name, label: "Puesto" }), archive, employees, scopeCount: position._count.orgScopes };
}

export const positionsDeletion = {
  async preview(id: string): Promise<DeletionPreview> {
    const todayKey = todayArgentinaDateKey();
    return prisma.$transaction(async (tx) => (await buildPlan(tx, id, todayKey)).preview, { timeout: 30_000, maxWait: 10_000 });
  },

  async execute(id: string, confirmation: DeletionConfirmation, audit?: AuditContext) {
    const todayKey = todayArgentinaDateKey();
    let result: { preview: DeletionPreview; archive: boolean };
    try {
      result = await prisma.$transaction(async (tx) => {
        await assertActorAuthorizedWithin(tx, audit?.userId, adminRoles);
        const plan = await buildPlan(tx, id, todayKey);
        assertConfirmedPlan(plan.preview, confirmation);
        const context = { effectiveFrom: todayKey, reason: `Eliminación del puesto “${plan.preview.target.name}”`, audit };
        for (const employee of plan.employees) await employeesService.detachLaborReferencesWithin(tx, employee.id, { positionId: id }, context);
        if (plan.archive) {
          // Alcance vigente cerrado desde hoy (queda en la historia por fecha) y puesto archivado.
          if (plan.scopeCount) {
            const scopes = await tx.positionOrgScope.findMany({ where: { positionId: id }, select: { level: true, companyId: true, businessUnitId: true, sectorId: true, areaId: true } });
            await positionsService.removeScopeNodesWithin(tx, id, new Set(scopes.map((scope) => `${scope.level}:${scope.companyId || scope.businessUnitId || scope.sectorId || scope.areaId}`)), context);
          }
          await tx.position.update({ where: { id }, data: { archivedAt: new Date() } });
        } else {
          // Configuración propia, explícitamente y sin depender de CASCADE.
          await tx.positionOrgScopePeriodNode.deleteMany({ where: { period: { positionId: id } } });
          await tx.positionOrgScopePeriod.deleteMany({ where: { positionId: id } });
          await tx.positionOrgScope.deleteMany({ where: { positionId: id } });
          await tx.positionSalaryCategory.deleteMany({ where: { positionId: id } });
          await tx.position.delete({ where: { id } });
        }
        await auditService.registerWithin(tx, {
          ...audit,
          action: plan.archive ? "UPDATE" : "DELETE",
          entity: "Position",
          entityId: id,
          description: `Se ${plan.archive ? "archivó" : "eliminó"} el puesto ${plan.preview.target.code} - ${plan.preview.target.name} con sus dependencias: ${plan.preview.groups.map((group) => `${group.label}: ${group.count}`).join("; ")}.`,
          before: { target: plan.preview.target, groups: plan.preview.groups } as unknown as Prisma.InputJsonValue,
          after: { fate: plan.archive ? "ARCHIVE" : "DELETE" } as Prisma.InputJsonValue,
        });
        return { preview: plan.preview, archive: plan.archive };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000, maxWait: 10_000 });
    } catch (error) {
      mapLaborHistoryPersistenceError(error);
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2003")) {
        throw new AppError("Otra operación modificó este puesto al mismo tiempo. Volvé a revisar la vista previa y confirmá de nuevo.", 409, "DELETION_CONCURRENT_CHANGE");
      }
      throw error;
    }
    invalidatePositionsCache();
    clearAuditDerivedCaches();
    return { done: true, target: result.preview.target, groups: result.preview.groups, archived: result.archive };
  },
};
