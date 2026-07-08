import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { storageService } from "../../shared/storage/storage.service";
import { employeeAccessWhere } from "./employeeAccess";
import { employeesRepository } from "./employees.repository";
import type {
  CreateEmployeeDocumentInput,
  CreateEmployeeBlockHistoryInput,
  CreateEmployeeFieldHistoryInput,
  CreateEmployeeInput,
  CreateLaborMovementInput,
  EmployeeTimeGridQuery,
  ListEmployeeHistoryQuery,
  ListEmployeeOrgChartQuery,
  ListEmployeeOptionsQuery,
  ListEmployeesQuery,
  ReplaceEmployeeAssignmentsInput,
  ReplaceEmployeeHourConceptsInput,
  UpdateEmployeeContactInput,
  UpdateEmployeeInput,
  UpsertEmployeeAddressInput,
  UpsertEmployeeTransportInput,
} from "./employees.schemas";

const salaryOrder = [
  "Directorio",
  "Director",
  "Gerente General",
  "Gerente",
  "Jefe",
  "Encargado",
  "Coordinador",
  "Supervisor",
  "Administrativo A",
  "Administrativo B",
  "Administrativo C",
  "Administrativo D",
  "Operario A",
  "Operario B",
  "Operario C",
  "Operario D",
  "Especial A",
  "Especial B",
  "Especial C",
  "Especial D",
  "Especial E",
  "Especial F",
  "Especial G",
  "Especial H",
  "Especial I",
  "Especialista",
];

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function allowedValues(primary: string | null | undefined, values: unknown): string[] {
  const list = asStringArray(values);
  const fallback = primary?.trim() ? [primary.trim()] : [];
  return list.length ? list : fallback;
}

function compareCategory(range: string[], category?: string | null) {
  if (!category) return { status: "UNKNOWN_CATEGORY", range };
  if (!range.length) return { status: "NO_RANGE", range };
  const firstCategory = range[0];
  const lastCategory = range[range.length - 1];
  if (!firstCategory || !lastCategory) return { status: "NO_RANGE", range };
  const first = salaryOrder.indexOf(firstCategory);
  const last = salaryOrder.indexOf(lastCategory);
  const current = salaryOrder.indexOf(category);
  if (current === -1) return { status: "UNKNOWN_CATEGORY", range };
  if (first === -1 || last === -1) {
    return range.includes(category) ? { status: "IN_RANGE", range } : { status: "UNKNOWN_CATEGORY", range };
  }
  const min = Math.min(first, last);
  const max = Math.max(first, last);
  if (current < min) return { status: "BELOW_RANGE", range };
  if (current > max) return { status: "ABOVE_RANGE", range };
  return { status: "IN_RANGE", range };
}

function structureCheck(label: string, value: string, allowed: string[], hasPosition: boolean) {
  return {
    label,
    value: value || "Sin cargar",
    allowed,
    ok: !hasPosition || !allowed.length || allowed.includes(value),
    missing: !value,
  };
}

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("Employee unique field already exists", 409, "EMPLOYEE_UNIQUE_CONSTRAINT");
    }
    if (error.code === "P2025") {
      throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    }
    if (error.code === "P2003") {
      throw new AppError("Related record not found or cannot be used", 400, "RELATION_CONSTRAINT");
    }
  }
  throw error;
}

async function execute<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    mapPrismaError(error);
    throw error;
  }
}

function bufferFromBase64(value?: string | null) {
  if (!value) return undefined;
  const base64 = value.includes(",") ? value.split(",").pop() : value;
  if (!base64) return undefined;
  return Buffer.from(base64, "base64");
}

async function ensureUniqueEmployee(input: CreateEmployeeInput) {
  const existing = await employeesRepository.findByUniqueFields(input);
  if (!existing) return;
  throw new AppError("Employee with same legajo, Legajo Finnegans, CUIL or DNI already exists", 409, "EMPLOYEE_ALREADY_EXISTS", existing);
}

async function ensureNoEmployeeConflict(id: string, input: UpdateEmployeeInput) {
  const existing = await employeesRepository.findConflictingUniqueFields(id, input);
  if (!existing) return;
  throw new AppError("Employee with same legajo, Legajo Finnegans, CUIL or DNI already exists", 409, "EMPLOYEE_ALREADY_EXISTS", existing);
}

export const employeesService = {
  async list(query: ListEmployeesQuery, user: Express.AuthUser) {
    const [items, total] = await employeesRepository.findMany(query, employeeAccessWhere(user));
    return {
      items,
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  summary(user: Express.AuthUser) {
    return employeesRepository.summary(employeeAccessWhere(user));
  },

  async listOrgChart(query: ListEmployeeOrgChartQuery, user: Express.AuthUser) {
    const [items, total] = await employeesRepository.findOrgChart(query, employeeAccessWhere(user));
    return {
      items,
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  async listOptions(query: ListEmployeeOptionsQuery, user: Express.AuthUser) {
    const [items, total] = await employeesRepository.findOptions(query, employeeAccessWhere(user));
    return {
      items,
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  async getById(id: string, user?: Express.AuthUser) {
    const employee = await employeesRepository.findById(id, user ? employeeAccessWhere(user) : {});
    if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    return employee;
  },

  async getOverviewById(id: string, user: Express.AuthUser) {
    const employee = await employeesRepository.findOverviewById(id, employeeAccessWhere(user));
    if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    return employee;
  },

  async getTimeGrid(id: string, query: EmployeeTimeGridQuery, user: Express.AuthUser) {
    const grid = await employeesRepository.findTimeGrid(id, query, employeeAccessWhere(user));
    if (!grid) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    return grid;
  },

  async getPositionValidation(id: string, user: Express.AuthUser) {
    const employee = await employeesService.getById(id, user);
    const position = employee.position;
    const businessUnit = employee.sector?.area?.establishment?.businessUnit?.name || "";
    const establishment = employee.sector?.area?.establishment?.name || "";
    const sector = employee.sector?.name || "";
    const range = position ? allowedValues(null, position.salaryRangeCategories) : [];
    const categoryResult = position ? compareCategory(range, employee.internalCategory) : { status: "NO_POSITION", range: [] };
    const checks = [
      structureCheck("Unidad de negocio", businessUnit, position ? allowedValues(position.businessUnitName, position.businessUnitNames) : [], Boolean(position)),
      structureCheck("Establecimiento", establishment, position ? allowedValues(position.establishmentName, position.establishmentNames) : [], Boolean(position)),
      structureCheck("Sector", sector, position ? allowedValues(position.sectorName, position.sectorNames) : [], Boolean(position)),
    ];
    const structuralMismatch = checks.some((row) => position && row.allowed.length && !row.ok && !row.missing);
    const categoryMismatch = ["BELOW_RANGE", "ABOVE_RANGE", "UNKNOWN_CATEGORY"].includes(categoryResult.status);
    const categoryPending = ["NO_POSITION", "NO_RANGE"].includes(categoryResult.status) || !employee.internalCategory;
    const tone = !position
      ? "neutral"
      : structuralMismatch || categoryMismatch
        ? "danger"
        : categoryPending || checks.some((row) => row.missing)
          ? "warning"
          : "success";
    const title = !position
      ? "Puesto sin seleccionar"
      : tone === "success"
        ? "Datos laborales dentro del puesto"
        : tone === "danger"
          ? "Hay datos fuera del puesto"
          : "Validacion pendiente";
    const categoryTextByStatus: Record<string, string> = {
      IN_RANGE: `${employee.internalCategory || "La categoria interna"} esta dentro del rango salarial.`,
      BELOW_RANGE: `${employee.internalCategory || "La categoria interna"} esta por debajo del rango salarial.`,
      ABOVE_RANGE: `${employee.internalCategory || "La categoria interna"} esta por encima del rango salarial.`,
      NO_POSITION: "No hay puesto seleccionado. Se puede guardar igual; la validacion queda pendiente.",
      NO_RANGE: "El puesto no tiene rango salarial configurado.",
      UNKNOWN_CATEGORY: "La categoria interna no se encuentra en el catalogo salarial.",
    };

    return {
      tone,
      title,
      categoryText: categoryTextByStatus[categoryResult.status],
      checks,
      category: {
        status: categoryResult.status,
        value: employee.internalCategory || "Sin cargar",
        range: categoryResult.range,
      },
    };
  },

  async create(input: CreateEmployeeInput, audit?: AuditContext) {
    await ensureUniqueEmployee(input);
    const employee = await execute(() => employeesRepository.create(input, audit?.userId));
    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "Employee",
      entityId: employee.id,
      description: `Se creo el legajo ${employee.legajo} - ${employee.lastName}, ${employee.firstName}.`,
      after: employee as Prisma.InputJsonValue,
    });
    return employee;
  },

  async update(id: string, input: UpdateEmployeeInput, audit?: AuditContext) {
    await ensureNoEmployeeConflict(id, input);
    const before = await employeesService.getById(id);
    const employee = await execute(() => employeesRepository.update(id, input));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "Employee",
      entityId: employee.id,
      description: `Se actualizo el legajo ${employee.legajo} - ${employee.lastName}, ${employee.firstName}.`,
      before: before as Prisma.InputJsonValue,
      after: employee as Prisma.InputJsonValue,
    });
    return employee;
  },

  async replaceAssignments(id: string, input: ReplaceEmployeeAssignmentsInput, audit?: AuditContext) {
    const before = await employeesService.getById(id);
    const employee = await execute(() => employeesRepository.replaceAssignments(id, input.assignments));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeAssignment",
      entityId: employee.id,
      description: `Se actualizaron responsables/asignaciones del legajo ${employee.legajo}.`,
      before: before.assignments as Prisma.InputJsonValue,
      after: employee.assignments as Prisma.InputJsonValue,
    });
    return employee;
  },

  async updateContact(id: string, input: UpdateEmployeeContactInput, audit?: AuditContext) {
    const before = await employeesService.getById(id);
    const employee = await execute(() => employeesRepository.updateContact(id, input));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeContact",
      entityId: employee.id,
      description: `Se actualizo contacto del legajo ${employee.legajo}.`,
      before: {
        email: before.email,
        phone: before.phone,
        mobile: before.mobile,
        emergencyContact: before.emergencyContact,
        emergencyRelation: before.emergencyRelation,
        emergencyPhone: before.emergencyPhone,
      } as Prisma.InputJsonValue,
      after: {
        email: employee.email,
        phone: employee.phone,
        mobile: employee.mobile,
        emergencyContact: employee.emergencyContact,
        emergencyRelation: employee.emergencyRelation,
        emergencyPhone: employee.emergencyPhone,
      } as Prisma.InputJsonValue,
    });
    return employee;
  },

  async upsertAddress(id: string, input: UpsertEmployeeAddressInput, audit?: AuditContext) {
    const before = await employeesService.getById(id);
    const employee = await execute(() => employeesRepository.upsertAddress(id, input));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeAddress",
      entityId: employee.id,
      description: `Se actualizo domicilio del legajo ${employee.legajo}.`,
      before: before.address as Prisma.InputJsonValue,
      after: employee.address as Prisma.InputJsonValue,
    });
    return employee;
  },

  async upsertTransport(id: string, input: UpsertEmployeeTransportInput, audit?: AuditContext) {
    const before = await employeesService.getById(id);
    const employee = await execute(() => employeesRepository.upsertTransport(id, input));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeTransport",
      entityId: employee.id,
      description: `Se actualizo transporte del legajo ${employee.legajo}.`,
      before: before.transport as Prisma.InputJsonValue,
      after: employee.transport as Prisma.InputJsonValue,
    });
    return employee;
  },

  async replaceHourConcepts(id: string, input: ReplaceEmployeeHourConceptsInput, audit?: AuditContext) {
    const before = await employeesService.getById(id);
    const employee = await execute(() => employeesRepository.replaceHourConcepts(id, input.hourConceptIds));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeHourConcept",
      entityId: employee.id,
      description: `Se actualizaron horas habilitadas del legajo ${employee.legajo}.`,
      before: before.hourConcepts as Prisma.InputJsonValue,
      after: employee.hourConcepts as Prisma.InputJsonValue,
    });
    return employee;
  },

  async createLaborMovement(id: string, input: CreateLaborMovementInput, audit?: AuditContext) {
    const before = await employeesRepository.findLaborAuditSnapshot(id);
    const { employee, movement } = await execute(() => employeesRepository.createLaborMovement(id, input, audit?.userId));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "LaborMovement",
      entityId: employee.id,
      description: `Se registro movimiento ${input.type} para el legajo ${employee.legajo}.`,
      before: { status: before.status, laborMovements: before.laborMovements } as Prisma.InputJsonValue,
      after: { status: employee.status, movement } as Prisma.InputJsonValue,
    });
    return employee;
  },

  async createDocument(id: string, input: CreateEmployeeDocumentInput, audit?: AuditContext) {
    const before = await employeesService.getById(id);
    const storageKey =
      input.storageKey ||
      (
        await storageService.upload({
          buffer: bufferFromBase64(input.fileBase64),
          fileName: input.fileName,
          mimeType: input.fileMimeType,
          folder: `employees/${id}/documents`,
        })
      ).storageKey;
    const employee = await execute(() =>
      employeesRepository.createDocument(id, { ...input, storageKey }, audit?.userId),
    );
    const document = employee.documents[0];
    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "EmployeeDocument",
      entityId: employee.id,
      description: `Se agrego documentacion al legajo ${employee.legajo}.`,
      before: before.documents as Prisma.InputJsonValue,
      after: employee.documents as Prisma.InputJsonValue,
    });
    return employee;
  },

  async syncLaborStatuses(audit?: AuditContext) {
    const result = await employeesRepository.syncLaborStatuses();
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "Employee",
      entityId: null,
      description: `Se sincronizaron estados laborales. Revisados: ${result.scanned}. Actualizados: ${result.updated}.`,
      after: result as Prisma.InputJsonValue,
    });
    return result;
  },

  async listFieldHistory(id: string, query: ListEmployeeHistoryQuery, user: Express.AuthUser) {
    await employeesService.getById(id, user);
    return employeesRepository.findFieldHistory(id, query);
  },

  async createFieldHistory(id: string, input: CreateEmployeeFieldHistoryInput, audit?: AuditContext, user?: Express.AuthUser) {
    if (user) await employeesService.getById(id, user);
    const record = await execute(() => employeesRepository.createFieldHistory(id, input, audit?.userId));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeFieldHistory",
      entityId: record.id,
      description: `Se registro historial del campo ${input.fieldLabel}.`,
      after: record as Prisma.InputJsonValue,
    });
    return record;
  },

  async listBlockHistory(id: string, query: ListEmployeeHistoryQuery, user: Express.AuthUser) {
    await employeesService.getById(id, user);
    return employeesRepository.findBlockHistory(id, query);
  },

  async createBlockHistory(id: string, input: CreateEmployeeBlockHistoryInput, audit?: AuditContext, user?: Express.AuthUser) {
    if (user) await employeesService.getById(id, user);
    const record = await execute(() => employeesRepository.createBlockHistory(id, input, audit?.userId));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeBlockHistory",
      entityId: record.id,
      description: `Se registro historial del bloque ${input.blockLabel}.`,
      after: record as Prisma.InputJsonValue,
    });
    return record;
  },
};
