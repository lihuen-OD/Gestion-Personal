import { z } from "zod";

const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, "period must use YYYY-MM format");

// Etapa 15L.3A (docs/decisions/FINNEGANS_EXPORT_NORMALIZED_15L3A.md): `period`
// pasa a ser obligatorio y `from`/`to` se retiran — el gate de cierre mensual
// es intrínsecamente mensual y ningún caller real (sólo
// FinnegansExportPage.tsx) usaba el rango libre. `includePending` también se
// retira: dejaba entrar novedades PENDIENTE/EN_REVISION, lo que contradecía
// la regla de selección de esta etapa (sólo APROBADO exporta, sin
// excepciones). `preview` la reemplaza con un significado distinto: no
// cambia qué novedades son candidatas, sólo si se exige cierre mensual
// aprobado y si la consulta queda auditada como exportación (ver
// finnegansExport.service.ts).
export const finnegansExportQuerySchema = z.object({
  period: periodSchema,
  employeeId: z.string().uuid().optional(),
  preview: z.coerce.boolean().default(false),
});

export type FinnegansExportQuery = z.infer<typeof finnegansExportQuerySchema>;
