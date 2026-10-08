/**
 * Lectores SIMULADOS para el motor de horas especiales (D-5,
 * docs/decisions/ORG_LOCATION_REORGANIZATION.md §19). Envuelven la transacción
 * de sólo lectura y alteran en memoria lo que el motor lee de la historia
 * temporal: nunca escriben. Sirven para medir efectos sin tocar datos.
 */
import type { Tx } from "../org-reorg/lib";

type Removed = { positions: ReadonlySet<string>; sectors: ReadonlySet<string>; companies: ReadonlySet<string> };
type Args<D extends { findMany: (args: never) => unknown }> = Parameters<D["findMany"]>[0];
const asDate = (key: string) => new Date(`${key}T00:00:00.000Z`);

/**
 * La historia sin las referencias a registros que la limpieza borraría
 * (impacto "si esas referencias desaparecieran"). La limpieza real nunca lo
 * hace: una referencia de historia al inventario la bloquea (§19.6).
 */
export function historyWithoutReferences(tx: Tx, removed: Removed) {
  return {
    doubleHourRule: tx.doubleHourRule,
    holidayWorkAssignment: tx.holidayWorkAssignment,
    employeeCostCenterPeriod: tx.employeeCostCenterPeriod,
    positionOrgScopePeriod: tx.positionOrgScopePeriod,
    employeePositionPeriod: {
      findMany: async (args: Args<Tx["employeePositionPeriod"]>) => ((await tx.employeePositionPeriod.findMany(args)) as Array<{ positionId?: string | null }>)
        .map((row) => (row.positionId && removed.positions.has(row.positionId) ? { ...row, positionId: null } : row)),
    },
    employeeLegacySectorPeriod: {
      findMany: async (args: Args<Tx["employeeLegacySectorPeriod"]>) => ((await tx.employeeLegacySectorPeriod.findMany(args)) as Array<{ sectorId?: string | null }>)
        .map((row) => (row.sectorId && removed.sectors.has(row.sectorId) ? { ...row, sectorId: null } : row)),
    },
    employeeEmployerPeriod: {
      findMany: async (args: Args<Tx["employeeEmployerPeriod"]>) => ((await tx.employeeEmployerPeriod.findMany(args)) as Array<{ companies?: Array<{ companyId: string }> }>)
        .map((row) => ({ ...row, companies: (row.companies ?? []).filter((link) => !removed.companies.has(link.companyId)) })),
    },
  };
}

/**
 * Historia SINTÉTICA igual a los valores vigentes, abierta desde `fromKey`,
 * para legajos y puestos que no tienen historia registrada en una dimensión.
 * Donde sí hay historia se usa la real. Permite comparar el motor nuevo con
 * el anterior (que usaba los valores vigentes) sin inicializar nada: si la
 * historia coincidiera con los valores actuales, el resultado debe ser
 * idéntico. NO es una inicialización ni la reemplaza (§19.4).
 */
export async function historyFromCurrentValues(tx: Tx, fromKey: string) {
  const [employees, scopes, withPosition, withCostCenter, withSector, withEmployer, positionsWithScopeHistory] = await Promise.all([
    tx.employee.findMany({ select: { id: true, positionId: true, costCenterId: true, sectorId: true, companies: { select: { companyId: true } } } }),
    tx.positionOrgScope.findMany({ select: { positionId: true, level: true, companyId: true, businessUnitId: true, sectorId: true, areaId: true, area: { select: { sectorId: true } } } }),
    tx.employeePositionPeriod.findMany({ distinct: ["employeeId"], select: { employeeId: true } }),
    tx.employeeCostCenterPeriod.findMany({ distinct: ["employeeId"], select: { employeeId: true } }),
    tx.employeeLegacySectorPeriod.findMany({ distinct: ["employeeId"], select: { employeeId: true } }),
    tx.employeeEmployerPeriod.findMany({ distinct: ["employeeId"], select: { employeeId: true } }),
    tx.positionOrgScopePeriod.findMany({ distinct: ["positionId"], select: { positionId: true } }),
  ]);
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  const has = (rows: Array<{ employeeId: string }>) => new Set(rows.map((row) => row.employeeId));
  const real = { position: has(withPosition), costCenter: has(withCostCenter), sector: has(withSector), employer: has(withEmployer) };
  const realScopes = new Set(positionsWithScopeHistory.map((row) => row.positionId));
  const period = (id: string) => ({ id: `simulated-${id}`, effectiveFrom: asDate(fromKey), effectiveTo: null });
  const employeeIdOf = (args: unknown) => (args as { where: { employeeId: string } }).where.employeeId;
  return {
    doubleHourRule: tx.doubleHourRule,
    holidayWorkAssignment: tx.holidayWorkAssignment,
    employeePositionPeriod: {
      findMany: async (args: Args<Tx["employeePositionPeriod"]>) => {
        const id = employeeIdOf(args);
        return real.position.has(id) ? tx.employeePositionPeriod.findMany(args) : [{ ...period(`position-${id}`), positionId: byId.get(id)?.positionId ?? null }];
      },
    },
    employeeCostCenterPeriod: {
      findMany: async (args: Args<Tx["employeeCostCenterPeriod"]>) => {
        const id = employeeIdOf(args);
        return real.costCenter.has(id) ? tx.employeeCostCenterPeriod.findMany(args) : [{ ...period(`cost-center-${id}`), costCenterId: byId.get(id)?.costCenterId ?? null }];
      },
    },
    employeeLegacySectorPeriod: {
      findMany: async (args: Args<Tx["employeeLegacySectorPeriod"]>) => {
        const id = employeeIdOf(args);
        return real.sector.has(id) ? tx.employeeLegacySectorPeriod.findMany(args) : [{ ...period(`sector-${id}`), sectorId: byId.get(id)?.sectorId ?? null }];
      },
    },
    employeeEmployerPeriod: {
      findMany: async (args: Args<Tx["employeeEmployerPeriod"]>) => {
        const id = employeeIdOf(args);
        return real.employer.has(id) ? tx.employeeEmployerPeriod.findMany(args) : [{ ...period(`employer-${id}`), companies: byId.get(id)?.companies ?? [] }];
      },
    },
    positionOrgScopePeriod: {
      findMany: async (args: Args<Tx["positionOrgScopePeriod"]>) => {
        const wanted = ((args as { where: { positionId: { in: string[] } } }).where.positionId.in);
        const realRows = wanted.some((id) => realScopes.has(id))
          ? await tx.positionOrgScopePeriod.findMany({ ...args, where: { ...(args as { where: object }).where, positionId: { in: wanted.filter((id) => realScopes.has(id)) } } } as Args<Tx["positionOrgScopePeriod"]>)
          : [];
        const synthesized = wanted.filter((id) => !realScopes.has(id)).flatMap((positionId) => {
          const nodes = scopes.filter((scope) => scope.positionId === positionId);
          return nodes.length
            ? [{ ...period(`scope-${positionId}`), positionId, nodes: nodes.map((node) => ({ level: node.level, companyId: node.companyId, businessUnitId: node.businessUnitId, sectorId: node.sectorId, areaId: node.areaId, areaSectorId: node.level === "AREA" ? node.area?.sectorId ?? null : null })) }]
            : [];
        });
        return [...realRows, ...synthesized];
      },
    },
  };
}
