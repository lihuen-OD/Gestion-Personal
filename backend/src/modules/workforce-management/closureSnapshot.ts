import type { Prisma } from "@prisma/client";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import {
  accountEmployeePeriods,
  accountingBaseEntrySelect,
  accountingBreakdownSelect,
  countedBreakdownStatusWhere,
  emptyPeriodAccounting,
  toAccountingBaseEntry,
  toAccountingBreakdown,
} from "../time-entries/workedTimeAccounting";

/**
 * Snapshot de auditoría de `MonthlyTimeClosure` (docs/decisions/
 * WORKED_TIME_ACCOUNTING_MODEL.md §9/§14). Única implementación: la usan el
 * envío de cierres (`workforceService.submitClosures`) y la recalculación
 * controlada cuando RRHH corrige o elimina un concepto horario
 * (`hourConceptsRepository`). Recibe el cliente para poder correr dentro de
 * la transacción de quien la llama.
 */
type Db = PrismaTransactionClient;

export type ClosureSnapshotRecalculation = {
  reason: "HOUR_CONCEPT_WORK_TREATMENT_CHANGED" | "HOUR_CONCEPT_DELETED";
  hourConceptId: string;
  hourConceptCode: string;
};

export type ClosureSnapshotTarget = { id: string; employeeId: string; period: string; snapshot: Prisma.JsonValue | null };

export type RebuiltClosureSnapshot = {
  id: string;
  employeeId: string;
  period: string;
  before: Prisma.JsonValue | null;
  after: Prisma.InputJsonObject;
};

function periodRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(year!, month! - 1, 1)), end: new Date(Date.UTC(year!, month!, 1)) };
}

/**
 * `entries` conserva el formato previo (Horas base NORMAL_BASE agrupadas por
 * estado). `accounting` congela la composición real del período con el
 * modelo único — mismo criterio de estado que la grilla por legajo (base
 * APROBADO/EN_REVISION, conceptos sin RECHAZADO), así cierre y grilla nunca
 * calculan distinto. 3 consultas batch para todos los legajos del período.
 */
export async function buildClosureSnapshots(db: Db, employeeIds: string[], period: string): Promise<Map<string, Prisma.InputJsonObject>> {
  const range = periodRange(period);
  const [rows, baseEntries, breakdowns] = await Promise.all([
    db.timeEntry.groupBy({
      by: ["employeeId", "status"],
      where: { employeeId: { in: employeeIds }, period, hourConcept: { systemRole: "NORMAL_BASE" } },
      _sum: { hours: true },
      _count: true,
    }),
    db.timeEntry.findMany({
      where: { employeeId: { in: employeeIds }, period, status: { in: ["APROBADO", "EN_REVISION"] }, hourConcept: { systemRole: "NORMAL_BASE" } },
      select: accountingBaseEntrySelect,
    }),
    db.hourConceptBreakdown.findMany({
      where: { employeeId: { in: employeeIds }, period, status: countedBreakdownStatusWhere },
      select: { ...accountingBreakdownSelect, hourConcept: { select: { workTreatment: true, code: true, name: true } } },
    }),
  ]);
  const accountingByEmployee = accountEmployeePeriods(baseEntries.map(toAccountingBaseEntry), breakdowns.map(toAccountingBreakdown));
  const conceptNames = new Map(breakdowns.map((breakdown) => [breakdown.hourConceptId, { code: breakdown.hourConcept.code, name: breakdown.hourConcept.name }]));
  return new Map(employeeIds.map((employeeId) => {
    const accounting = accountingByEmployee.get(employeeId) ?? emptyPeriodAccounting();
    const snapshot = {
      range,
      entries: rows.filter((row) => row.employeeId === employeeId).map((row) => ({ status: row.status, hours: Number(row._sum.hours || 0), records: row._count })),
      accounting: {
        model: "WORKED_TIME_ACCOUNTING_V1",
        ...accounting,
        concepts: accounting.concepts.map((concept) => ({ ...concept, ...conceptNames.get(concept.hourConceptId) })),
      },
    };
    return [employeeId, snapshot as unknown as Prisma.InputJsonObject];
  }));
}

function snapshotMentionsConcept(snapshot: Prisma.JsonValue | null, hourConceptId: string) {
  const concepts = (snapshot as { accounting?: { concepts?: Array<{ hourConceptId?: string }> } } | null)?.accounting?.concepts;
  return Array.isArray(concepts) && concepts.some((concept) => concept?.hourConceptId === hourConceptId);
}

/**
 * Cierres cuyo snapshot quedaría desactualizado si cambia la lectura de un
 * concepto: los de cada empleado+período con desgloses que cuentan
 * (`pairs`, ya calculados por quien llama) y los que ya mencionan el
 * concepto en su snapshot (p. ej. un desglose rechazado después del envío).
 * 1 consulta.
 */
export async function findClosuresForHourConcept(db: Db, hourConceptId: string, pairs: Array<{ employeeId: string; period: string }>): Promise<ClosureSnapshotTarget[]> {
  const pairKeys = new Set(pairs.map((pair) => `${pair.employeeId}:${pair.period}`));
  const closures = await db.monthlyTimeClosure.findMany({
    where: {
      OR: [
        ...(pairs.length
          ? [{ employeeId: { in: [...new Set(pairs.map((pair) => pair.employeeId))] }, period: { in: [...new Set(pairs.map((pair) => pair.period))] } }]
          : []),
        { snapshot: { path: ["accounting", "concepts"], array_contains: [{ hourConceptId }] } },
      ],
    },
    select: { id: true, employeeId: true, period: true, snapshot: true },
  });
  return closures.filter((closure) =>
    closure.snapshot !== null && (pairKeys.has(`${closure.employeeId}:${closure.period}`) || snapshotMentionsConcept(closure.snapshot, hourConceptId)),
  );
}

/**
 * Reconstruye el snapshot con el mismo builder del envío y los datos
 * vigentes. No toca estado, autoría ni fechas del cierre (un APROBADO sigue
 * APROBADO, igual que una corrección directa de RRHH en un período cerrado).
 * Devuelve before/after para que quien llama los audite.
 */
export async function rebuildClosureSnapshots(db: Db, closures: ClosureSnapshotTarget[], recalculation: ClosureSnapshotRecalculation): Promise<RebuiltClosureSnapshot[]> {
  const byPeriod = new Map<string, ClosureSnapshotTarget[]>();
  for (const closure of closures) byPeriod.set(closure.period, [...(byPeriod.get(closure.period) ?? []), closure]);

  const recalculatedAt = new Date().toISOString();
  const rebuilt: RebuiltClosureSnapshot[] = [];
  for (const [period, items] of byPeriod) {
    const snapshots = await buildClosureSnapshots(db, items.map((item) => item.employeeId), period);
    for (const closure of items) {
      const after = { ...snapshots.get(closure.employeeId)!, recalculation: { ...recalculation, at: recalculatedAt } };
      await db.monthlyTimeClosure.update({ where: { id: closure.id }, data: { snapshot: after } });
      rebuilt.push({ id: closure.id, employeeId: closure.employeeId, period, before: closure.snapshot, after });
    }
  }
  return rebuilt;
}
