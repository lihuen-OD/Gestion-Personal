import { z } from "zod";

export const employeeStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);

export const listEmployeesQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: employeeStatusSchema.optional(),
  companyId: z.string().uuid().optional(),
  sectorId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(100),
});

export const listEmployeeOrgChartQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: employeeStatusSchema.default("ACTIVO"),
  companyId: z.string().uuid().optional(),
  sectorId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(1000).default(500),
});

export const employeeAddressSchema = z.object({
  province: z.string().trim().max(120).optional().nullable(),
  department: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  street: z.string().trim().max(160).optional().nullable(),
  streetNumber: z.string().trim().max(40).optional().nullable(),
  postalCode: z.string().trim().max(40).optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  mapLabel: z.string().trim().max(240).optional().nullable(),
});

export const createEmployeeSchema = z.object({
  legajo: z.string().trim().min(1).max(40),
  legajoFinnegans: z.string().trim().max(40).optional().nullable(),
  cuil: z.string().trim().min(6).max(30),
  dni: z.string().trim().min(5).max(20),
  firstName: z.string().trim().min(2).max(100),
  lastName: z.string().trim().min(2).max(100),
  birthDate: z.coerce.date(),
  gender: z.string().trim().min(1).max(40),
  civilStatus: z.string().trim().max(80).optional().nullable(),
  nationality: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160).optional().nullable(),
  phone: z.string().trim().max(80).optional().nullable(),
  mobile: z.string().trim().max(80).optional().nullable(),
  emergencyContact: z.string().trim().max(160).optional().nullable(),
  emergencyRelation: z.string().trim().max(80).optional().nullable(),
  emergencyPhone: z.string().trim().max(80).optional().nullable(),
  status: employeeStatusSchema.default("ACTIVO"),
  positionId: z.string().uuid().optional().nullable(),
  sectorId: z.string().uuid().optional().nullable(),
  costCenterId: z.string().uuid().optional().nullable(),
  healthInsurance: z.string().trim().max(120).optional().nullable(),
  agreement: z.string().trim().max(120).optional().nullable(),
  receiptCategory: z.string().trim().max(120).optional().nullable(),
  internalCategory: z.string().trim().max(120).optional().nullable(),
  companyIds: z.array(z.string().uuid()).default([]),
  primaryCompanyId: z.string().uuid().optional().nullable(),
  address: employeeAddressSchema.optional(),
});

export const updateEmployeeSchema = createEmployeeSchema.partial();

export const updateEmployeeContactSchema = z.object({
  email: z.string().trim().email().max(160).optional().nullable(),
  phone: z.string().trim().max(80).optional().nullable(),
  mobile: z.string().trim().max(80).optional().nullable(),
  emergencyContact: z.string().trim().max(160).optional().nullable(),
  emergencyRelation: z.string().trim().max(80).optional().nullable(),
  emergencyPhone: z.string().trim().max(80).optional().nullable(),
});

export const upsertEmployeeAddressSchema = employeeAddressSchema.refine(
  (value) =>
    Boolean(
      value.province ||
        value.department ||
        value.city ||
        value.street ||
        value.streetNumber ||
        value.postalCode ||
        value.latitude ||
        value.longitude ||
        value.mapLabel,
    ),
  { message: "At least one address field is required" },
);

export const upsertEmployeeTransportSchema = z.object({
  usesCompanyTransport: z.boolean().default(false),
  locality: z.string().trim().max(120).optional().nullable(),
  pickupAddress: z.string().trim().max(180).optional().nullable(),
  pickupReference: z.string().trim().max(180).optional().nullable(),
  busLine: z.string().trim().max(120).optional().nullable(),
  schedule: z.string().trim().max(120).optional().nullable(),
  observation: z.string().trim().max(600).optional().nullable(),
});

export const assignmentTypeSchema = z.enum(["DIRECT_MANAGER", "TIME_RESPONSIBLE"]);

export const employeeAssignmentSchema = z.object({
  type: assignmentTypeSchema,
  userId: z.string().uuid().optional().nullable(),
  personName: z.string().trim().min(2).max(160).optional().nullable(),
  role: z.string().trim().max(120).optional().nullable(),
  effectiveFrom: z.coerce.date().optional().nullable(),
  effectiveTo: z.coerce.date().optional().nullable(),
  status: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(600).optional().nullable(),
}).refine((value) => Boolean(value.userId || value.personName), {
  message: "userId or personName is required",
});

export const replaceEmployeeAssignmentsSchema = z.object({
  assignments: z.array(employeeAssignmentSchema).max(20),
});

export const replaceEmployeeHourConceptsSchema = z.object({
  hourConceptIds: z.array(z.string().uuid()).max(50),
});

export const laborMovementTypeSchema = z.enum(["ALTA", "BAJA"]);

export const createLaborMovementSchema = z.object({
  type: laborMovementTypeSchema,
  effectiveFrom: z.coerce.date(),
  reason: z.string().trim().min(2).max(180),
  observation: z.string().trim().max(600).optional().nullable(),
});

export const documentStatusSchema = z.enum(["PENDIENTE", "VIGENTE", "POR_VENCER", "VENCIDO", "RECHAZADO"]);

export const createEmployeeDocumentSchema = z.object({
  categoryId: z.string().uuid(),
  noveltyId: z.string().uuid().optional().nullable(),
  fileName: z.string().trim().min(1).max(240),
  fileMimeType: z.string().trim().min(3).max(120),
  fileSizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
  fileBase64: z.string().trim().max(35 * 1024 * 1024).optional().nullable(),
  storageKey: z.string().trim().max(500).optional().nullable(),
  status: documentStatusSchema.default("PENDIENTE"),
  notes: z.string().trim().max(1000).optional().nullable(),
  issuedAt: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
});

export const employeeHistorySectionSchema = z.enum([
  "INFORMACION_GENERAL",
  "CONTACTO_DOMICILIO",
  "DATOS_LABORALES",
  "RESPONSABLES_ASIGNACIONES",
  "TRANSPORTE",
  "CONFIGURACION_HORARIA_LIQUIDACION",
]);

export const listEmployeeHistoryQuerySchema = z.object({
  section: employeeHistorySectionSchema.optional(),
  field: z.string().trim().max(120).optional(),
  block: z.string().trim().max(120).optional(),
  take: z.coerce.number().int().positive().max(100).default(50),
});

export const createEmployeeFieldHistorySchema = z.object({
  section: employeeHistorySectionSchema,
  field: z.string().trim().min(1).max(120),
  fieldLabel: z.string().trim().min(1).max(160),
  oldValue: z.string().trim().max(2000).optional().nullable(),
  newValue: z.string().trim().min(1).max(2000),
  effectiveFrom: z.coerce.date(),
  reason: z.string().trim().min(2).max(600),
});

export const createEmployeeBlockHistorySchema = z.object({
  section: employeeHistorySectionSchema,
  block: z.string().trim().min(1).max(120),
  blockLabel: z.string().trim().min(1).max(160),
  oldValue: z.string().trim().max(2000).optional().nullable(),
  newValue: z.string().trim().min(1).max(2000),
  effectiveFrom: z.coerce.date(),
  reason: z.string().trim().min(2).max(600),
});

export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
export type ListEmployeeOrgChartQuery = z.infer<typeof listEmployeeOrgChartQuerySchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type UpdateEmployeeContactInput = z.infer<typeof updateEmployeeContactSchema>;
export type UpsertEmployeeAddressInput = z.infer<typeof upsertEmployeeAddressSchema>;
export type UpsertEmployeeTransportInput = z.infer<typeof upsertEmployeeTransportSchema>;
export type EmployeeAssignmentInput = z.infer<typeof employeeAssignmentSchema>;
export type ReplaceEmployeeAssignmentsInput = z.infer<typeof replaceEmployeeAssignmentsSchema>;
export type ReplaceEmployeeHourConceptsInput = z.infer<typeof replaceEmployeeHourConceptsSchema>;
export type CreateLaborMovementInput = z.infer<typeof createLaborMovementSchema>;
export type CreateEmployeeDocumentInput = z.infer<typeof createEmployeeDocumentSchema>;
export type ListEmployeeHistoryQuery = z.infer<typeof listEmployeeHistoryQuerySchema>;
export type CreateEmployeeFieldHistoryInput = z.infer<typeof createEmployeeFieldHistorySchema>;
export type CreateEmployeeBlockHistoryInput = z.infer<typeof createEmployeeBlockHistorySchema>;
