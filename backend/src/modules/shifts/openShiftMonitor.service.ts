import { WorkShiftStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { resolveActiveWorkRegime } from "../work-regimes/workRegimes.service";
import { evaluateOpenShiftRisk, type OpenShiftRiskResult } from "./workShiftEvaluation.service";
import { createShiftAlert, toTemplateRef } from "./workShiftEvaluationRunner";
import type { ShiftTemplateLike } from "./shiftTemplateRef.types";

// `suppressMissingOutDefault` es opcional a propósito (Etapa 10E): el
// llamador de attendanceSummary (timeEntries.service.ts) sigue sin pasarlo,
// así que el ranking de riesgo que ve Asistencia no cambia — es un indicador
// operativo de "hace cuánto está abierta esta jornada", no una decisión de
// alertar, y no depende del régimen. Sólo checkMissingOutRisk (que sí decide
// si crear un ShiftAlert) lo resuelve y lo pasa.
export function computeOpenShiftRisk(startAt: Date, shiftTemplate: ShiftTemplateLike | null, now: Date, suppressMissingOutDefault?: boolean): OpenShiftRiskResult {
  return evaluateOpenShiftRisk({ startAt, now, template: shiftTemplate ? toTemplateRef(shiftTemplate) : null, suppressMissingOutDefault });
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

  // Etapa 10E: resuelve el régimen vigente de cada jornada abierta para
  // decidir si corresponde suprimir el default de "olvido de salida" sin
  // turno (mismo criterio que isOutOfShiftAlertSuppressed en
  // workShiftEvaluationRunner.ts — alertOnOutOfShift=false lo suprime).
  const regimes = await Promise.all(openShifts.map((shift) => resolveActiveWorkRegime(shift.employeeId, now)));

  let created = 0;
  for (const [index, shift] of openShifts.entries()) {
    const suppressMissingOutDefault = regimes[index]?.alertOnOutOfShift === false;
    const risk = computeOpenShiftRisk(shift.startAt, shift.shiftTemplate, now, suppressMissingOutDefault);
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
