/**
 * Asignación PURA de una fichada a un bloque programado — R4.2
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.3). Mecanismo compartido
 * para los consumidores futuros (evidencia de ingreso en R4.3, adopción del
 * turno en la entrada en R4.4); hoy no lo usa ningún servicio productivo y el
 * matching legacy de turnos fijos (`matchShiftForEmployee`) no cambia.
 *
 * Regla (decisión de negocio del 2026-11-20):
 *   - Ventana de un bloque: [inicio − 240 min, fin) — 240 =
 *     EARLY_ARRIVAL_REVIEW_THRESHOLD_MINUTES; inicio de ventana inclusivo,
 *     fin exclusivo.
 *   - Fuera de TODAS las ventanas → UNASSIGNED: la fichada no satisface
 *     ninguna obligación (no implica ausencia ni irregularidad: la
 *     clasificación es de los consumidores).
 *   - Varias ventanas → primero el bloque ya en curso; luego el inicio más
 *     cercano; empate → el inicio más temprano (y, con el mismo inicio, el que
 *     termina antes: nunca depende del orden recibido). Devuelve A LO SUMO UN bloque:
 *     una fichada nunca satisface dos.
 *   - Asignar no es puntualidad ni cumplimiento definitivo: las tolerancias
 *     del turno las evalúan los consumidores.
 */
import { argentinaDateKey, nextCalendarDateKey, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";
import type { ExpectedBlock, ExpectedDayPlan, RotationTemplateRef } from "./rotationPlan";
import { EARLY_ARRIVAL_REVIEW_THRESHOLD_MINUTES } from "./workShiftEvaluation.service";

export const DEFAULT_BLOCK_EARLY_WINDOW_MINUTES = EARLY_ARRIVAL_REVIEW_THRESHOLD_MINUTES;

export type AssignableBlock = { scheduledStartAt: Date; scheduledEndAt: Date };

export type BlockAssignment<B extends AssignableBlock> =
  | { kind: "ASSIGNED"; block: B; differenceMinutes: number; withinScheduledInterval: boolean }
  | { kind: "UNASSIGNED"; reason: "NO_CANDIDATES" | "OUTSIDE_ALL_WINDOWS" };

export function assignInstantToBlock<B extends AssignableBlock>(instant: Date, candidates: readonly B[], options: { earlyWindowMinutes?: number } = {}): BlockAssignment<B> {
  if (!candidates.length) return { kind: "UNASSIGNED", reason: "NO_CANDIDATES" };
  const earlyWindowMs = (options.earlyWindowMinutes ?? DEFAULT_BLOCK_EARLY_WINDOW_MINUTES) * 60_000;
  const at = instant.getTime();
  const inWindow = candidates.filter((block) => at >= block.scheduledStartAt.getTime() - earlyWindowMs && at < block.scheduledEndAt.getTime());
  if (!inWindow.length) return { kind: "UNASSIGNED", reason: "OUTSIDE_ALL_WINDOWS" };

  const inProgress = (block: B) => at >= block.scheduledStartAt.getTime() && at < block.scheduledEndAt.getTime();
  const winner = [...inWindow].sort((left, right) => {
    const progress = Number(inProgress(right)) - Number(inProgress(left));
    if (progress !== 0) return progress;
    const distance = Math.abs(at - left.scheduledStartAt.getTime()) - Math.abs(at - right.scheduledStartAt.getTime());
    if (distance !== 0) return distance;
    const start = left.scheduledStartAt.getTime() - right.scheduledStartAt.getTime();
    if (start !== 0) return start;
    // Mismo inicio (sólo posible con bloques de distintas fuentes; el plan de
    // rotación los marca CONFLICT): el que termina antes, sin depender del orden.
    return left.scheduledEndAt.getTime() - right.scheduledEndAt.getTime();
  })[0]!;
  return {
    kind: "ASSIGNED",
    block: winner,
    differenceMinutes: Math.round((at - winner.scheduledStartAt.getTime()) / 60_000),
    withinScheduledInterval: inProgress(winner),
  };
}

/**
 * Bloques candidatos para una fichada: los de los planes de D−1, D y D+1 (D =
 * fecha argentina del instante) — cubre bloques nocturnos que empezaron el
 * día anterior y entradas anticipadas al día siguiente. Sólo planes SHIFTS
 * aportan bloques (REST, MISSING y CONFLICT no generan candidatos). Sin
 * duplicados por `obligationKey`, ordenados por inicio.
 */
export function candidateBlocksAround<T extends RotationTemplateRef>(instant: Date, planFor: (dateKey: string) => ExpectedDayPlan<T> | null | undefined): ExpectedBlock<T>[] {
  const day = argentinaDateKey(instant);
  const byKey = new Map<string, ExpectedBlock<T>>();
  for (const dateKey of [previousCalendarDateKey(day), day, nextCalendarDateKey(day)]) {
    const plan = planFor(dateKey);
    if (plan?.kind !== "SHIFTS") continue;
    for (const block of plan.blocks) byKey.set(block.obligationKey, block);
  }
  return [...byKey.values()].sort((left, right) => left.scheduledStartAt.getTime() - right.scheduledStartAt.getTime() || left.blockIndex - right.blockIndex);
}
