import { z } from "zod";

export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);

const baseCatalogSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  status: recordStatusSchema.default("ACTIVO"),
});
const idArraySchema = z.array(z.string().uuid()).default([]);

export const createCompanySchema = baseCatalogSchema;
export const updateCompanySchema = baseCatalogSchema.partial();

export const createBusinessUnitSchema = baseCatalogSchema.extend({
  companyId: z.string().uuid().optional(),
  companyIds: idArraySchema,
});
export const updateBusinessUnitSchema = createBusinessUnitSchema.partial();

export const createEstablishmentSchema = baseCatalogSchema.extend({
  companyId: z.string().uuid().optional(),
  companyIds: idArraySchema,
  businessUnitId: z.string().uuid().optional().nullable(),
  businessUnitIds: idArraySchema,
  province: z.string().trim().max(120).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  street: z.string().trim().max(160).optional().nullable(),
  streetNumber: z.string().trim().max(40).optional().nullable(),
  postalCode: z.string().trim().max(40).optional().nullable(),
});
export const updateEstablishmentSchema = createEstablishmentSchema.partial();

export const createAreaSchema = baseCatalogSchema.extend({
  establishmentId: z.string().uuid().optional().nullable(),
  businessUnitIds: idArraySchema,
  establishmentIds: idArraySchema,
});
export const updateAreaSchema = createAreaSchema.partial();

export const createSectorSchema = baseCatalogSchema.extend({
  areaId: z.string().uuid().optional().nullable(),
  areaIds: idArraySchema,
  establishmentIds: idArraySchema,
});
export const updateSectorSchema = createSectorSchema.partial();

export const createCostCenterSchema = baseCatalogSchema.extend({
  companyIds: idArraySchema,
  businessUnitIds: idArraySchema,
  establishmentIds: idArraySchema,
  areaIds: idArraySchema,
  sectorIds: idArraySchema,
});
export const updateCostCenterSchema = createCostCenterSchema.partial();

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type CreateBusinessUnitInput = z.infer<typeof createBusinessUnitSchema>;
export type UpdateBusinessUnitInput = z.infer<typeof updateBusinessUnitSchema>;
export type CreateEstablishmentInput = z.infer<typeof createEstablishmentSchema>;
export type UpdateEstablishmentInput = z.infer<typeof updateEstablishmentSchema>;
export type CreateAreaInput = z.infer<typeof createAreaSchema>;
export type UpdateAreaInput = z.infer<typeof updateAreaSchema>;
export type CreateSectorInput = z.infer<typeof createSectorSchema>;
export type UpdateSectorInput = z.infer<typeof updateSectorSchema>;
export type CreateCostCenterInput = z.infer<typeof createCostCenterSchema>;
export type UpdateCostCenterInput = z.infer<typeof updateCostCenterSchema>;
