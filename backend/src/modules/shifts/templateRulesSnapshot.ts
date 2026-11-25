/**
 * R4.6 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9, garantía 1): reglas
 * de la plantilla adoptada CONGELADAS en la jornada (`WorkShift.templateRulesSnapshot`).
 *
 * Se escriben en la misma actualización que adopta `shiftTemplateId` (apertura
 * con bloque de rotación, adopción legacy del post-proceso, cambio de bloque y
 * rollover). Mientras la jornada está abierta, la salida, el olvido de salida y
 * los límites usan este snapshot: un ajuste posterior de tolerancias o límites
 * de la plantilla sólo rige para jornadas nuevas.
 *
 * Jornadas sin snapshot (anteriores a R4.6, manuales, sin plantilla): la
 * plantilla en vivo, exactamente como antes. Un snapshot ilegible o de una
 * versión desconocida también cae en la plantilla en vivo (con un log), nunca
 * en un error: la fichada no puede depender de este dato.
 */
import { z } from "zod";
import type { ShiftTemplateLike } from "./shiftTemplateRef.types";

export const TEMPLATE_RULES_SNAPSHOT_VERSION = 1;

const minutes = z.number().int();

const snapshotSchema = z.object({
  version: z.literal(TEMPLATE_RULES_SNAPSHOT_VERSION),
  templateId: z.string().min(1),
  code: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  crossesMidnight: z.boolean(),
  entryToleranceBeforeMinutes: minutes,
  entryToleranceAfterMinutes: minutes,
  exitToleranceBeforeMinutes: minutes,
  exitToleranceAfterMinutes: minutes,
  minimumMinutesForCompliance: minutes.nullable(),
  maximumInformativeMinutes: minutes.nullable(),
  missingOutAlertAfterMinutes: minutes.nullable(),
  absoluteOpenShiftLimitMinutes: minutes,
  capturedAt: z.string(),
});

export type TemplateRulesSnapshot = z.infer<typeof snapshotSchema>;

/** Snapshot (JSON) de las reglas vigentes de `template` en `capturedAt`. */
export function buildTemplateRulesSnapshot(template: ShiftTemplateLike, capturedAt: Date): TemplateRulesSnapshot {
  return {
    version: TEMPLATE_RULES_SNAPSHOT_VERSION,
    templateId: template.id,
    code: template.code,
    startTime: template.startTime,
    endTime: template.endTime,
    crossesMidnight: template.crossesMidnight,
    entryToleranceBeforeMinutes: template.entryToleranceBeforeMinutes,
    entryToleranceAfterMinutes: template.entryToleranceAfterMinutes,
    exitToleranceBeforeMinutes: template.exitToleranceBeforeMinutes,
    exitToleranceAfterMinutes: template.exitToleranceAfterMinutes,
    minimumMinutesForCompliance: template.minimumMinutesForCompliance,
    maximumInformativeMinutes: template.maximumInformativeMinutes,
    missingOutAlertAfterMinutes: template.missingOutAlertAfterMinutes,
    absoluteOpenShiftLimitMinutes: template.absoluteOpenShiftLimitMinutes,
    capturedAt: capturedAt.toISOString(),
  };
}

/** Reglas congeladas como `ShiftTemplateLike`; null si no hay snapshot o no se puede leer. */
export function parseTemplateRulesSnapshot(value: unknown): ShiftTemplateLike | null {
  if (value === null || value === undefined) return null;
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) {
    console.warn("WORK_SHIFT_TEMPLATE_SNAPSHOT_UNREADABLE", { severity: "warning", version: typeof value === "object" && value && "version" in value ? (value as { version?: unknown }).version : undefined });
    return null;
  }
  const { version: _version, templateId, capturedAt: _capturedAt, ...rules } = parsed.data;
  return { id: templateId, ...rules };
}

/**
 * Reglas que gobiernan una jornada: el snapshot si existe y corresponde a la
 * plantilla adoptada; si no, la plantilla en vivo (comportamiento anterior a R4.6).
 */
export function effectiveShiftTemplate<T extends ShiftTemplateLike>(
  shift: { shiftTemplateId: string | null; templateRulesSnapshot?: unknown },
  live: T | null,
): ShiftTemplateLike | T | null {
  const frozen = parseTemplateRulesSnapshot(shift.templateRulesSnapshot);
  if (frozen && shift.shiftTemplateId && frozen.id === shift.shiftTemplateId) return frozen;
  return live;
}
