import { z } from "zod";

const calendarDateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Fecha inválida");

/**
 * A7: parámetros de filtro de estructura compartidos por los listados de
 * legajos (ver shared/prisma/employeeStructureWhere.ts). El modo de alcance
 * NO tiene valor por defecto (D-7 pendiente): el nodo y el modo viajan juntos.
 */
export const employeeStructureQueryShape = {
  scopeLevel: z.enum(["COMPANY", "BUSINESS_UNIT", "SECTOR", "AREA"]).optional(),
  scopeNodeId: z.string().uuid().optional(),
  scopeMode: z.enum(["WITHIN", "COVERS"]).optional(),
  locationZoneId: z.string().uuid().optional(),
  locationEstablishmentId: z.string().uuid().optional(),
  locationDate: calendarDateKey.optional(),
  reloadStatus: z.enum(["PENDING", "COMPLETE"]).optional(),
};

type StructureQuery = { scopeLevel?: string; scopeNodeId?: string; scopeMode?: string; locationZoneId?: string; locationEstablishmentId?: string; locationDate?: string };

export function refineEmployeeStructureQuery(value: StructureQuery, ctx: z.RefinementCtx) {
  const scopeParts = [value.scopeLevel, value.scopeNodeId, value.scopeMode].filter(Boolean).length;
  if (scopeParts !== 0 && scopeParts !== 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scopeMode"], message: "El filtro de alcance requiere nivel, nodo y modo (WITHIN o COVERS)." });
  }
  if (value.locationDate && !value.locationZoneId && !value.locationEstablishmentId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["locationDate"], message: "La fecha de vigencia requiere una zona o un establecimiento." });
  }
}
