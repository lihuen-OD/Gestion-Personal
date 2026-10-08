import type { OrgScopeLevel } from "@prisma/client";
import { calendarDateKey } from "../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import type { DateKey, Period } from "./laborHistory.periods";
import type { ScopeNodeSnapshot } from "./laborHistory.scope";

// Acceso a las tablas de historia temporal (D-5, ORG_LOCATION_REORGANIZATION.md
// §19). Todas las funciones reciben el cliente: las escrituras corren siempre
// dentro de la transacción del cambio (con su auditoría) y las lecturas del
// motor, dentro de la transacción de quien lo invoca cuando la hay.

export type ScalarDimension = "POSITION" | "COST_CENTER" | "LEGACY_SECTOR";

export type HistoryReader = Pick<
  PrismaTransactionClient,
  "employeePositionPeriod" | "employeeCostCenterPeriod" | "employeeLegacySectorPeriod" | "employeeEmployerPeriod" | "positionOrgScopePeriod"
>;

type Db = PrismaTransactionClient;

const day = (key: DateKey) => new Date(`${key}T00:00:00.000Z`);
const keyOrNull = (date: Date | null) => (date ? calendarDateKey(date) : null);
const periodSelect = { id: true, effectiveFrom: true, effectiveTo: true } as const;
const asPeriod = <V>(row: { id: string; effectiveFrom: Date; effectiveTo: Date | null }, value: V): Period<V> => ({
  id: row.id,
  effectiveFrom: calendarDateKey(row.effectiveFrom),
  effectiveTo: keyOrNull(row.effectiveTo),
  value,
});

/** Vigencias que se superponen con [fromKey, toKey]; sin rango, todas. */
function overlapping(range?: { fromKey: DateKey; toKey: DateKey }) {
  if (!range) return {};
  return { effectiveFrom: { lte: day(range.toKey) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day(range.fromKey) } }] };
}

const orderBy = { effectiveFrom: "asc" } as const;

export type NewPeriod = { effectiveFrom: DateKey; effectiveTo: DateKey | null; reason: string; createdByUserId: string | null };

function nodeData(periodId: string, node: ScopeNodeSnapshot) {
  return {
    periodId,
    level: node.level as OrgScopeLevel,
    companyId: node.level === "COMPANY" ? node.nodeId : null,
    businessUnitId: node.level === "BUSINESS_UNIT" ? node.nodeId : null,
    sectorId: node.level === "SECTOR" ? node.nodeId : null,
    areaId: node.level === "AREA" ? node.nodeId : null,
    areaSectorId: node.level === "AREA" ? node.areaSectorId : null,
  };
}

function nodeFromRow(row: { level: OrgScopeLevel; companyId: string | null; businessUnitId: string | null; sectorId: string | null; areaId: string | null; areaSectorId: string | null }): ScopeNodeSnapshot {
  return { level: row.level, nodeId: (row.companyId ?? row.businessUnitId ?? row.sectorId ?? row.areaId)!, areaSectorId: row.areaSectorId };
}

const nodeSelect = { level: true, companyId: true, businessUnitId: true, sectorId: true, areaId: true, areaSectorId: true } as const;

export const laborHistoryRepository = {
  async findScalarPeriods(db: HistoryReader, dimension: ScalarDimension, employeeId: string, range?: { fromKey: DateKey; toKey: DateKey }): Promise<Period<string | null>[]> {
    const where = { employeeId, ...overlapping(range) };
    if (dimension === "POSITION") {
      return (await db.employeePositionPeriod.findMany({ where, orderBy, select: { ...periodSelect, positionId: true } })).map((row) => asPeriod(row, row.positionId));
    }
    if (dimension === "COST_CENTER") {
      return (await db.employeeCostCenterPeriod.findMany({ where, orderBy, select: { ...periodSelect, costCenterId: true } })).map((row) => asPeriod(row, row.costCenterId));
    }
    return (await db.employeeLegacySectorPeriod.findMany({ where, orderBy, select: { ...periodSelect, sectorId: true } })).map((row) => asPeriod(row, row.sectorId));
  },

  async findEmployerPeriods(db: HistoryReader, employeeId: string, range?: { fromKey: DateKey; toKey: DateKey }): Promise<Period<string[]>[]> {
    const rows = await db.employeeEmployerPeriod.findMany({ where: { employeeId, ...overlapping(range) }, orderBy, select: { ...periodSelect, companies: { select: { companyId: true } } } });
    return rows.map((row) => asPeriod(row, row.companies.map((link) => link.companyId).sort()));
  },

  async findScopePeriods(db: HistoryReader, positionIds: string[], range?: { fromKey: DateKey; toKey: DateKey }): Promise<Map<string, Period<ScopeNodeSnapshot[]>[]>> {
    const result = new Map<string, Period<ScopeNodeSnapshot[]>[]>();
    if (!positionIds.length) return result;
    const rows = await db.positionOrgScopePeriod.findMany({
      where: { positionId: { in: positionIds }, ...overlapping(range) },
      orderBy,
      select: { ...periodSelect, positionId: true, nodes: { select: nodeSelect } },
    });
    for (const row of rows) result.set(row.positionId, [...(result.get(row.positionId) ?? []), asPeriod(row, row.nodes.map(nodeFromRow))]);
    return result;
  },

  /** Legajos con el puesto asignado en alguna fecha desde `fromKey` (para proteger sus cierres). */
  async findPositionAssignmentsFrom(db: Db, positionId: string, fromKey: DateKey) {
    const rows = await db.employeePositionPeriod.findMany({
      where: { positionId, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day(fromKey) } }] },
      select: { employeeId: true, effectiveFrom: true, effectiveTo: true },
    });
    return rows.map((row) => ({ employeeId: row.employeeId, effectiveFrom: calendarDateKey(row.effectiveFrom), effectiveTo: keyOrNull(row.effectiveTo) }));
  },

  /** Períodos de cierre existentes desde `fromPeriod` (cualquier estado). */
  async findClosurePeriodsFrom(db: Db, employeeIds: string[], fromPeriod: string) {
    if (!employeeIds.length) return [];
    return db.monthlyTimeClosure.findMany({ where: { employeeId: { in: employeeIds }, period: { gte: fromPeriod } }, select: { employeeId: true, period: true } });
  },

  async createScalarPeriod(db: Db, dimension: ScalarDimension, employeeId: string, value: string | null, period: NewPeriod) {
    const base = { employeeId, effectiveFrom: day(period.effectiveFrom), effectiveTo: period.effectiveTo ? day(period.effectiveTo) : null, reason: period.reason, createdByUserId: period.createdByUserId };
    if (dimension === "POSITION") return (await db.employeePositionPeriod.create({ data: { ...base, positionId: value }, select: { id: true } })).id;
    if (dimension === "COST_CENTER") return (await db.employeeCostCenterPeriod.create({ data: { ...base, costCenterId: value }, select: { id: true } })).id;
    return (await db.employeeLegacySectorPeriod.create({ data: { ...base, sectorId: value }, select: { id: true } })).id;
  },

  async closeScalarPeriod(db: Db, dimension: ScalarDimension, id: string, effectiveTo: DateKey) {
    const data = { effectiveTo: day(effectiveTo) };
    if (dimension === "POSITION") await db.employeePositionPeriod.update({ where: { id }, data, select: { id: true } });
    else if (dimension === "COST_CENTER") await db.employeeCostCenterPeriod.update({ where: { id }, data, select: { id: true } });
    else await db.employeeLegacySectorPeriod.update({ where: { id }, data, select: { id: true } });
  },

  async replaceScalarPeriodValue(db: Db, dimension: ScalarDimension, id: string, value: string | null, reason: string) {
    if (dimension === "POSITION") await db.employeePositionPeriod.update({ where: { id }, data: { positionId: value, reason }, select: { id: true } });
    else if (dimension === "COST_CENTER") await db.employeeCostCenterPeriod.update({ where: { id }, data: { costCenterId: value, reason }, select: { id: true } });
    else await db.employeeLegacySectorPeriod.update({ where: { id }, data: { sectorId: value, reason }, select: { id: true } });
  },

  async createEmployerPeriod(db: Db, employeeId: string, companyIds: string[], period: NewPeriod) {
    const created = await db.employeeEmployerPeriod.create({
      data: { employeeId, effectiveFrom: day(period.effectiveFrom), effectiveTo: period.effectiveTo ? day(period.effectiveTo) : null, reason: period.reason, createdByUserId: period.createdByUserId },
      select: { id: true },
    });
    if (companyIds.length) await db.employeeEmployerPeriodCompany.createMany({ data: companyIds.map((companyId) => ({ periodId: created.id, companyId })) });
    return created.id;
  },

  async closeEmployerPeriod(db: Db, id: string, effectiveTo: DateKey) {
    await db.employeeEmployerPeriod.update({ where: { id }, data: { effectiveTo: day(effectiveTo) }, select: { id: true } });
  },

  /** Corrección del conjunto de una vigencia (mismo inicio): reemplaza sus filas hijas. */
  async replaceEmployerPeriodCompanies(db: Db, id: string, companyIds: string[], reason: string) {
    await db.employeeEmployerPeriodCompany.deleteMany({ where: { periodId: id } });
    if (companyIds.length) await db.employeeEmployerPeriodCompany.createMany({ data: companyIds.map((companyId) => ({ periodId: id, companyId })) });
    await db.employeeEmployerPeriod.update({ where: { id }, data: { reason }, select: { id: true } });
  },

  async createScopePeriod(db: Db, positionId: string, nodes: ScopeNodeSnapshot[], period: NewPeriod) {
    const created = await db.positionOrgScopePeriod.create({
      data: { positionId, effectiveFrom: day(period.effectiveFrom), effectiveTo: period.effectiveTo ? day(period.effectiveTo) : null, reason: period.reason, createdByUserId: period.createdByUserId },
      select: { id: true },
    });
    await db.positionOrgScopePeriodNode.createMany({ data: nodes.map((node) => nodeData(created.id, node)) });
    return created.id;
  },

  async closeScopePeriod(db: Db, id: string, effectiveTo: DateKey) {
    await db.positionOrgScopePeriod.update({ where: { id }, data: { effectiveTo: day(effectiveTo) }, select: { id: true } });
  },

  async replaceScopePeriodNodes(db: Db, id: string, nodes: ScopeNodeSnapshot[], reason: string) {
    await db.positionOrgScopePeriodNode.deleteMany({ where: { periodId: id } });
    await db.positionOrgScopePeriodNode.createMany({ data: nodes.map((node) => nodeData(id, node)) });
    await db.positionOrgScopePeriod.update({ where: { id }, data: { reason }, select: { id: true } });
  },

  /** Cantidad de vigencias que referencian un puesto (asignaciones o alcance). */
  async countPositionHistory(db: Db, positionId: string) {
    const [assignments, scopes] = await Promise.all([
      db.employeePositionPeriod.count({ where: { positionId } }),
      db.positionOrgScopePeriod.count({ where: { positionId } }),
    ]);
    return { assignments, scopes };
  },
};
