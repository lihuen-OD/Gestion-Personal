import { z } from "zod";
import { sortQueryShape } from "../../shared/validation/listSort";

export const auditActionSchema = z.enum([
  "CREATE",
  "UPDATE",
  "DELETE",
  "ACTIVATE",
  "DEACTIVATE",
  "APPROVE",
  "REJECT",
  "RETURN",
  "LOGIN",
  "EXPORT",
]);

export const listAuditQuerySchema = z.object({
  entity: z.string().trim().optional(),
  entityId: z.string().trim().optional(),
  userId: z.string().uuid().optional(),
  action: auditActionSchema.optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(100),
  // Sólo Fecha: "Evento"/"Registro" se muestran traducidos (auditLabels.ts),
  // ordenar por el enum/entity crudo no respetaría el texto visible.
  ...sortQueryShape(["createdAt"] as const),
});

export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
