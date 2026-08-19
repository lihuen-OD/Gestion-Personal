import type { OpenShiftOverflowAction, WorkRegimeKind } from "@prisma/client";
import { argentinaCalendarDate, argentinaDateKey } from "../../shared/datetime/argentinaTime";
import { findActiveEmployeeWorkRegime } from "./workRegimes.repository";

export interface ActiveWorkRegime {
  kind: WorkRegimeKind;
  alertOnOutOfShift: boolean;
  openShiftOverflowAction: OpenShiftOverflowAction;
}

// Resuelve el régimen vigente de un empleado para la fecha calendario
// Argentina del instante dado. Devuelve null si no tiene ningún régimen
// asignado para esa fecha — en ese caso el llamador debe comportarse
// exactamente igual que si el módulo de régimen no existiera.
export async function resolveActiveWorkRegime(employeeId: string, instant: Date): Promise<ActiveWorkRegime | null> {
  const referenceDate = argentinaCalendarDate(argentinaDateKey(instant));
  const assignment = await findActiveEmployeeWorkRegime(employeeId, referenceDate);
  if (!assignment) return null;
  return {
    kind: assignment.workRegime.kind,
    alertOnOutOfShift: assignment.workRegime.alertOnOutOfShift,
    openShiftOverflowAction: assignment.workRegime.openShiftOverflowAction,
  };
}
