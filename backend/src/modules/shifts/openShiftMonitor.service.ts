import { WorkShiftStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { evaluateOpenShiftRisk, type OpenShiftRiskResult } from "./workShiftEvaluation.service";
import { createShiftAlert, toTemplateRef } from "./workShiftEvaluationRunner";
import type { ShiftTemplateLike } from "./shiftTemplateRef.types";

export function computeOpenShiftRisk(startAt: Date, shiftTemplate: ShiftTemplateLike | null, now: Date): OpenShiftRiskResult {
  return evaluateOpenShiftRisk({ startAt, now, template: shiftTemplate ? toTemplateRef(shiftTemplate) : null });
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
    const risk = computeOpenShiftRisk(shift.startAt, shift.shiftTemplate, now);
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
