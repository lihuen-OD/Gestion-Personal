import { WorkShiftStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { evaluateOpenShiftRisk, type OpenShiftRiskResult } from "./workShiftEvaluation.service";
import { createShiftAlert, toTemplateRef } from "./workShiftEvaluationRunner";
import type { ShiftTemplateLike } from "./shiftTemplateRef.types";
import { effectiveShiftTemplate } from "./templateRulesSnapshot";

/**
 * `scheduledStartAt`: R4.4, inicio programado congelado del bloque de rotación (null en jornadas legacy).
 * `frozen`: R4.6 (§25.9), la jornada con su snapshot de reglas — si lo tiene, gobierna en vez de la plantilla en vivo.
 */
export function computeOpenShiftRisk(startAt: Date, shiftTemplate: ShiftTemplateLike | null, now: Date, scheduledStartAt?: Date | null, frozen?: { shiftTemplateId: string | null; templateRulesSnapshot?: unknown }): OpenShiftRiskResult {
  const template = frozen ? effectiveShiftTemplate(frozen, shiftTemplate) : shiftTemplate;
  return evaluateOpenShiftRisk({ startAt, now, template: template ? toTemplateRef(template) : null, scheduledStartAt });
}

const RISK_RANK: Record<OpenShiftRiskResult["level"], number> = {
  EXPIRED: 2,
  MISSING_OUT: 1,
  NORMAL: 0,
};

export function compareOpenShiftRisk(a: OpenShiftRiskResult, b: OpenShiftRiskResult) {
  const rankDiff = RISK_RANK[b.level] - RISK_RANK[a.level];
  if (rankDiff !== 0) return rankDiff;
  return b.minutesOpen - a.minutesOpen;
}

export async function checkMissingOutRisk(now: Date) {
  const openShifts = await prisma.workShift.findMany({
    where: { status: WorkShiftStatus.ABIERTO, endAt: null },
    include: { shiftTemplate: true },
  });

  let created = 0;
  for (const shift of openShifts) {
    // Etapa 15M.7C: controla una jornada abierta, no la obligación de turno;
    // por eso el riesgo se evalúa para todos los regímenes.
    const risk = computeOpenShiftRisk(shift.startAt, shift.shiftTemplate, now, shift.scheduledStartAt, shift);
    if (risk.level !== "MISSING_OUT") continue;

    const existingAlert = await prisma.shiftAlert.findUnique({
      where: { workShiftId_type: { workShiftId: shift.id, type: "POSIBLE_OLVIDO_SALIDA" } },
    });
    if (existingAlert) continue;

    await createShiftAlert({
      employeeId: shift.employeeId,
      workShiftId: shift.id,
      type: "POSIBLE_OLVIDO_SALIDA",
      actualAt: now,
      differenceMinutes: risk.minutesOpen,
    });
    created += 1;
  }

  return { checked: openShifts.length, created };
}
