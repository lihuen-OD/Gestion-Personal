import type { ShiftTemplate } from "@prisma/client";

export type ShiftTemplateLike = Pick<
  ShiftTemplate,
  | "id"
  | "code"
  | "startTime"
  | "endTime"
  | "crossesMidnight"
  | "entryToleranceBeforeMinutes"
  | "entryToleranceAfterMinutes"
  | "exitToleranceBeforeMinutes"
  | "exitToleranceAfterMinutes"
  | "minimumMinutesForCompliance"
  | "maximumInformativeMinutes"
  | "missingOutAlertAfterMinutes"
  | "absoluteOpenShiftLimitMinutes"
>;
