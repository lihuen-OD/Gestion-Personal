/**
 * Horario REAL aplicable a un legajo en la fecha de un feriado, sin la
 * convocatoria (WORKED_TIME_ACCOUNTING_MODEL.md §20, D9). Única fuente para:
 *   - validar el guardado de convocatorias (no se acepta una convocatoria
 *     ACTIVA sin horario resoluble);
 *   - mostrar en "Gestionar feriados" el turno que tendría cada candidato.
 *
 * Reutiliza los núcleos existentes, sin un resolver paralelo:
 *   - rotación: el plan del día (`loadRotationConfiguration` +
 *     `resolveRotationDayPlan`), con REST / MISSING / CONFLICT explícitos;
 *   - turnos fijos: `applicableFixedAssignments` (vigencia, día de semana,
 *     estado de la asignación y de la plantilla);
 *   - régimen SIN_TURNO: sin turno aplicable.
 * Consultas fijas por llamada (rotaciones + asignaciones + regímenes), nunca
 * una por legajo. `db` permite correrlo dentro de la transacción del guardado
 * o en un diagnóstico de sólo lectura (sin el cliente compartido ni config/env).
 */
import type { Prisma } from "@prisma/client";
import { argentinaCalendarDate } from "../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { activeRegimeKindOn, applicableFixedAssignments, type FixedAssignment } from "./expectedShiftResolver";
import { loadRotationConfiguration, type RotationLoaderReader } from "./rotationPlan.loader";
import { resolveRotationDayPlan, type ExpectedDayPlanConflictReason, type ExpectedDayPlanMissingReason } from "./rotationPlan";

export type ConvocationScheduleKind = "FIXED" | "ROTATION_SHIFTS" | "ROTATION_REST" | "ROTATION_MISSING" | "ROTATION_CONFLICT" | "NONE";

export type ConvocationScheduleBlock = { templateId: string; code: string; name: string | null; startTime: string; endTime: string };

export type ConvocationSchedule = {
  kind: ConvocationScheduleKind;
  /** Turnos del día (vacío salvo FIXED y ROTATION_SHIFTS), en orden de inicio. */
  blocks: ConvocationScheduleBlock[];
  /** Motivo técnico del plan (MISSING / CONFLICT), para que la UI lo traduzca. */
  planReason: ExpectedDayPlanMissingReason | ExpectedDayPlanConflictReason | null;
};

/**
 * Sólo una rotación con conflicto exige plantilla (no se elige un turno en
 * silencio). Sin turno ese día (NONE/SIN_TURNO, descanso o día sin configurar
 * de la rotación) se convoca sin plantilla: obligación de día, con una única
 * alerta de ausencia al terminar el día si no registra actividad.
 */
export function scheduleRequiresTemplate(kind: ConvocationScheduleKind): boolean {
  return kind === "ROTATION_CONFLICT";
}

const CONFLICT_TEXT: Record<ExpectedDayPlanConflictReason, string> = {
  MULTIPLE_MEMBERSHIPS: "la persona tiene más de una pertenencia a rotaciones ese día",
  MULTIPLE_VERSIONS: "más de una versión de la grilla rige ese día",
  DUPLICATE_DAY_ROWS: "el día está cargado más de una vez en la grilla",
  REST_DAY_WITH_BLOCKS: "un descanso tiene bloques de turno",
  DUPLICATE_BLOCK_INDEX: "el día repite el orden de un bloque",
  OVERLAPPING_BLOCKS: "los bloques del día se superponen",
};

/** Texto de negocio del conflicto de la rotación (sin identificadores técnicos). */
export function conflictText(reason: ConvocationSchedule["planReason"]): string {
  return (reason && CONFLICT_TEXT[reason as ExpectedDayPlanConflictReason]) || "la configuración de la rotación es contradictoria";
}

export type ConvocationScheduleReader = RotationLoaderReader & Pick<PrismaTransactionClient, "shiftAssignment" | "employeeWorkRegime">;

const templateSelect = { id: true, code: true, name: true, startTime: true, endTime: true, status: true } as const;
type TemplateRow = Prisma.ShiftTemplateGetPayload<{ select: typeof templateSelect }>;

const toBlock = (template: { id: string; code: string; name?: string | null; startTime: string; endTime: string }): ConvocationScheduleBlock => ({
  templateId: template.id,
  code: template.code,
  name: template.name ?? null,
  startTime: template.startTime,
  endTime: template.endTime,
});

export async function resolveConvocationSchedules(db: ConvocationScheduleReader, employeeIds: string[], dateKey: string): Promise<Map<string, ConvocationSchedule>> {
  const ids = [...new Set(employeeIds)];
  const result = new Map<string, ConvocationSchedule>();
  if (!ids.length) return result;
  const date = argentinaCalendarDate(dateKey);

  // Rotación: el plan del día reemplaza a los turnos fijos (Opción C, §24.11).
  const configuration = await loadRotationConfiguration(db, { fromKey: dateKey, toKey: dateKey, employeeIds: ids });
  for (const employeeId of ids) {
    const plan = resolveRotationDayPlan(employeeId, dateKey, configuration);
    if (!plan) continue;
    if (plan.kind === "SHIFTS") result.set(employeeId, { kind: "ROTATION_SHIFTS", blocks: plan.blocks.map((block) => toBlock(block.template)), planReason: null });
    else if (plan.kind === "REST") result.set(employeeId, { kind: "ROTATION_REST", blocks: [], planReason: null });
    else result.set(employeeId, { kind: plan.kind === "MISSING" ? "ROTATION_MISSING" : "ROTATION_CONFLICT", blocks: [], planReason: plan.reason });
  }

  const fixedIds = ids.filter((id) => !result.has(id));
  if (!fixedIds.length) return result;
  const [assignments, regimes] = await Promise.all([
    db.shiftAssignment.findMany({
      where: { employeeId: { in: fixedIds }, status: "HABILITADO", shiftTemplate: { status: "ACTIVO" }, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
      select: { employeeId: true, status: true, effectiveFrom: true, effectiveTo: true, weekdays: true, shiftTemplate: { select: templateSelect } },
    }),
    db.employeeWorkRegime.findMany({
      where: { employeeId: { in: fixedIds }, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
      select: { employeeId: true, effectiveFrom: true, effectiveTo: true, workRegime: { select: { kind: true } } },
    }),
  ]);
  for (const employeeId of fixedIds) {
    const regimeKind = activeRegimeKindOn(regimes.filter((row) => row.employeeId === employeeId).map((row) => ({ effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, kind: row.workRegime.kind })), date);
    const fixed: FixedAssignment<TemplateRow>[] = assignments
      .filter((row) => row.employeeId === employeeId)
      .map((row) => ({ status: row.status, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, weekdays: row.weekdays, template: row.shiftTemplate }));
    const templates = regimeKind === "SIN_TURNO" ? [] : applicableFixedAssignments(fixed, date).map((assignment) => assignment.template);
    const unique = [...new Map(templates.map((template) => [template.id, template])).values()].sort((left, right) => left.startTime.localeCompare(right.startTime));
    result.set(employeeId, unique.length ? { kind: "FIXED", blocks: unique.map(toBlock), planReason: null } : { kind: "NONE", blocks: [], planReason: null });
  }
  return result;
}
