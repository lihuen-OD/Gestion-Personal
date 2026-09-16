import { z } from "zod";

const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, "period must use YYYY-MM format");

// Etapa 15L.3A (docs/decisions/FINNEGANS_EXPORT_NORMALIZED_15L3A.md): `period`
// pasa a ser obligatorio y `from`/`to` se retiran — el gate de cierre mensual
// es intrínsecamente mensual y ningún caller real (sólo
// FinnegansExportPage.tsx) usaba el rango libre. `includePending` también se
// retira: dejaba entrar novedades PENDIENTE/EN_REVISION, lo que contradecía
// la regla de selección de esta etapa (sólo APROBADO exporta, sin
// excepciones).
//
// Etapa 15L.4: este GET queda exclusivamente para preview — la exportación
// definitiva se movió a `POST /novelties/export` (ver
// finnegansExportRequestSchema, más abajo), porque ahora crea un registro
// persistente (batch) y necesita `format`/`reexportReason`/`idempotencyKey`,
// que no tienen sentido como query params de un GET. `preview` se mantiene
// en el contrato por compatibilidad textual con lo ya documentado — el
// controller siempre trata este GET como preview, sin importar su valor.
export const finnegansExportQuerySchema = z.object({
  period: periodSchema,
  employeeId: z.string().uuid().optional(),
  preview: z.coerce.boolean().default(true),
});

export type FinnegansExportQuery = z.infer<typeof finnegansExportQuerySchema>;

export const finnegansExportFormatSchema = z.enum(["XLSX", "CSV"]);

// Etapa 15L.4 §10/§22/§23: cuerpo de la exportación definitiva.
// `reexportReason` es opcional acá a nivel de esquema (zod no sabe todavía
// si el período ya tiene un batch anterior) — la obligatoriedad real para
// una reexportación la exige el backend en
// finnegansExport.service.ts::assertReexportReason, no este schema.
// `idempotencyKey` es obligatoria: la genera el frontend una vez por click
// de exportación (crypto.randomUUID()) y protege contra un batch duplicado
// por doble click/retry de red.
export const finnegansExportRequestSchema = z.object({
  period: periodSchema,
  employeeId: z.string().uuid().optional(),
  format: finnegansExportFormatSchema,
  reexportReason: z.string().trim().min(5, "reexportReason must be at least 5 characters").max(500).optional(),
  idempotencyKey: z.string().uuid(),
});

export type FinnegansExportRequest = z.infer<typeof finnegansExportRequestSchema>;

export const finnegansExportHistoryQuerySchema = z.object({
  period: periodSchema,
});

export type FinnegansExportHistoryQuery = z.infer<typeof finnegansExportHistoryQuerySchema>;
