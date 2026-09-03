import { ApprovalStatus, EmployeeStatus, Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { argentinaCalendarDate, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import type {
  CreateEmployeeDocumentInput,
  CreateEmployeeInput,
  CreateEmployeeBlockHistoryInput,
  CreateLaborMovementInput,
  CreateEmployeeFieldHistoryInput,
  EmployeeAssignmentInput,
  EmployeeTimeGridQuery,
  ListEmployeeHistoryQuery,
  ListEmployeeOrgChartQuery,
  ListEmployeeOptionsQuery,
  ListEmployeesQuery,
  UpdateEmployeeContactInput,
  UpdateEmployeeInput,
  UpsertEmployeeAddressInput,
  UpsertEmployeeTransportInput,
} from "./employees.schemas";

const employeeOptionSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  status: true,
} satisfies Prisma.EmployeeSelect;

// Etapa 14C.1: recortado a exactamente lo que el listado necesita — ver
// docs/decisions/EMPLOYEE_PERFORMANCE_14C1.md §1.5-1.6. La pantalla de
// Legajos (`EmployeesPage.tsx`) sólo renderiza Legajo/CUIL/Apellido/Nombre/
// Centro de costo/Estado/Acción (contrato explícito en
// docs/PROJECT_CONTEXT.md → "Legajos / Personas"), confirmado por lectura
// completa del componente antes de recortar este select. `sector`/`position`/
// `companies` no se muestran en ningún lado del listado y se sacaron (cada
// uno era una relación extra, un round-trip extra hacia la base). `dni`/
// `birthDate`/`gender`/`civilStatus`/`nationality`/`createdAt`/`updatedAt`
// tampoco se usan acá — son escalares del mismo query, su remoción no ahorra
// round-trips pero sí reduce payload. `costCenter` se mantiene (se muestra en
// la tabla) y `laborMovements` (take:5) también se mantiene a propósito: el
// Estado de la tabla se calcula desde movimientos laborales
// (`mapEmployeeFromApi`, regla de negocio explícita en
// docs/PROJECT_CONTEXT.md: "Employee status is calculated from labor
// movements") — sacarlo haría que el listado mostrara la columna cruda
// `Employee.status` en vez del valor calculado.
const employeeListSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  firstName: true,
  lastName: true,
  status: true,
  costCenter: { select: { id: true, name: true, code: true } },
  laborMovements: {
    select: {
      id: true,
      employeeId: true,
      type: true,
      effectiveFrom: true,
      reason: true,
      observation: true,
      createdAt: true,
      createdByUserId: true,
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { effectiveFrom: "desc" as const },
    take: 5,
  },
} satisfies Prisma.EmployeeSelect;

// Etapa 6L.1: única fuente de verdad para el shape de EmployeeHourConcept que
// se expone al frontend. Antes de esta etapa, employeeOverviewSelect definía
// su propio `hourConcepts: { select: { hourConcept: { select: { id, code,
// name } } } }` sin loadMode/systemRole ni el where de asignabilidad — como
// mapEmployeeFromApi filtra por `Boolean(hourConcept.loadMode)`, la pantalla
// de Legajo (que lee por /overview-details, no por /employees/:id) mostraba
// SIEMPRE cero conceptos adicionales asignados, sin importar lo que hubiera
// en la tabla. Cualquier select de Employee que necesite reflejar
// habilitaciones debe reusar este fragmento en vez de redeclarar el suyo.
const assignableHourConceptsSelect = {
  where: {
    hourConcept: { systemRole: null, status: "ACTIVO", deletedAt: null, loadMode: { not: null } },
  },
  select: {
    hourConceptId: true,
    hourConcept: {
      select: { id: true, code: true, name: true, kind: true, loadMode: true, status: true, systemRole: true },
    },
  },
} satisfies Prisma.Employee$hourConceptsArgs;

const employeeDetailSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  birthDate: true,
  gender: true,
  civilStatus: true,
  nationality: true,
  email: true,
  phone: true,
  mobile: true,
  emergencyContact: true,
  emergencyRelation: true,
  emergencyPhone: true,
  status: true,
  healthInsurance: true,
  agreement: true,
  receiptCategory: true,
  internalCategory: true,
  createdAt: true,
  updatedAt: true,
  createdByUserId: true,
  address: true,
  transport: true,
  sector: {
    select: {
      id: true,
      name: true,
      code: true,
      area: {
        select: {
          id: true,
          name: true,
          establishment: {
            select: {
              id: true,
              name: true,
              businessUnit: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  },
  costCenter: { select: { id: true, name: true, code: true } },
  position: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      mission: true,
      description: true,
      lastUpdatedAt: true,
      responsibilities: true,
      internalRelations: true,
      externalRelations: true,
      competencies: true,
      workConditions: true,
      performanceIndicators: true,
      evaluationCriteria: true,
      sectorId: true,
      createdAt: true,
      updatedAt: true,
      // Cadena real (sectorId -> area -> establishment -> businessUnit), unica
      // fuente de verdad para getPositionValidation desde el saneamiento de
      // Puestos (2026-08-18).
      sector: {
        select: {
          id: true,
          name: true,
          area: {
            select: {
              id: true,
              name: true,
              establishment: {
                select: {
                  id: true,
                  name: true,
                  businessUnit: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
      salaryCategories: {
        select: { salaryCategory: { select: { id: true, name: true, order: true } } },
      },
    },
  },
  companies: {
    select: {
      isPrimary: true,
      company: { select: { id: true, name: true, code: true } },
    },
  },
  laborMovements: {
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { effectiveFrom: "desc" as const },
    take: 50,
  },
  assignments: { take: 100, include: { user: { select: { id: true, name: true, employeeId: true } } } },
  hourConcepts: assignableHourConceptsSelect,
  novelties: { include: { noveltyType: true }, orderBy: { fromDate: "desc" as const }, take: 20 },
  documents: { include: { category: true }, orderBy: { createdAt: "desc" as const }, take: 20 },
} satisfies Prisma.EmployeeSelect;

// Snapshot mínimo pero completo para auditar PATCH /employees/:id.
// Incluye todo lo que updateEmployeeSchema puede modificar y evita cargar
// colecciones ajenas a este guardado (documentos, novedades, movimientos,
// asignaciones y conceptos horarios).
const employeeUpdateAuditSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  birthDate: true,
  gender: true,
  civilStatus: true,
  nationality: true,
  email: true,
  phone: true,
  mobile: true,
  emergencyContact: true,
  emergencyRelation: true,
  emergencyPhone: true,
  status: true,
  positionId: true,
  sectorId: true,
  costCenterId: true,
  healthInsurance: true,
  agreement: true,
  receiptCategory: true,
  internalCategory: true,
  address: true,
  companies: {
    select: {
      companyId: true,
      isPrimary: true,
    },
  },
} satisfies Prisma.EmployeeSelect;

const employeeUpdateWriteSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  birthDate: true,
  gender: true,
  civilStatus: true,
  nationality: true,
  email: true,
  phone: true,
  mobile: true,
  emergencyContact: true,
  emergencyRelation: true,
  emergencyPhone: true,
  status: true,
  positionId: true,
  sectorId: true,
  costCenterId: true,
  healthInsurance: true,
  agreement: true,
  receiptCategory: true,
  internalCategory: true,
} satisfies Prisma.EmployeeSelect;

const employeeOverviewCoreSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  birthDate: true,
  gender: true,
  civilStatus: true,
  nationality: true,
  email: true,
  phone: true,
  mobile: true,
  emergencyContact: true,
  emergencyRelation: true,
  emergencyPhone: true,
  status: true,
  healthInsurance: true,
  agreement: true,
  receiptCategory: true,
  internalCategory: true,
  createdAt: true,
  updatedAt: true,
  createdByUserId: true,
} satisfies Prisma.EmployeeSelect;

// Etapa 14C.1: antes, `findOverviewDetailsById` pedía esto MÁS `companies`/
// `laborMovements`/`assignments`/`hourConcepts` en un único `findFirst`
// anidado (~10 relaciones/niveles distintos, cada uno un round-trip propio
// sin `relationJoins` — ver docs/decisions/EMPLOYEE_PERFORMANCE_14C1.md
// §1.9-1.15). Ese select gigante quedó reemplazado por este (sólo escalares +
// relaciones to-one, ya el máximo que puede resolverse en un solo
// `findFirst`) más 4 `findMany` independientes ejecutados en paralelo — ver
// `findOverviewDetailsById` más abajo. El shape final que recibe el
// frontend es idéntico al de antes (mismo merge de campos), sólo cambió
// cómo se arma.
const employeeOverviewDetailsCoreSelect = {
  ...employeeOverviewCoreSelect,
  address: true,
  transport: true,
  sector: {
    select: {
      id: true,
      name: true,
      code: true,
      area: {
        select: {
          id: true,
          name: true,
          establishment: {
            select: {
              id: true,
              name: true,
              businessUnit: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  },
  costCenter: { select: { id: true, name: true, code: true } },
  position: true,
} satisfies Prisma.EmployeeSelect;

const timeGridEmployeeSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  status: true,
  sector: {
    select: {
      id: true,
      name: true,
      area: {
        select: {
          establishment: {
            select: {
              name: true,
              businessUnit: { select: { name: true } },
            },
          },
        },
      },
    },
  },
  costCenter: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, name: true, code: true } },
  companies: {
    select: {
      isPrimary: true,
      company: { select: { id: true, name: true, code: true } },
    },
  },
  hourConcepts: {
    where: { hourConcept: { systemRole: null, status: "ACTIVO", deletedAt: null, loadMode: { not: null } } },
    select: { hourConcept: { select: { id: true, code: true, name: true, kind: true, loadMode: true, status: true, systemRole: true } } },
  },
} satisfies Prisma.EmployeeSelect;

const timeGridCoreEmployeeSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  status: true,
  hourConcepts: {
    where: { hourConcept: { systemRole: null, status: "ACTIVO", deletedAt: null, loadMode: { not: null } } },
    select: { hourConcept: { select: { id: true, code: true, name: true, kind: true, loadMode: true, status: true, systemRole: true } } },
  },
} satisfies Prisma.EmployeeSelect;

const timeGridTimeEntryInclude = {
  employee: { select: { id: true, legajo: true, cuil: true, firstName: true, lastName: true, status: true } },
  hourConcept: { select: { id: true, code: true, name: true, kind: true, loadMode: true, status: true, systemRole: true } },
  // Etapa 11B: nombre de la/las regla(s) ganadora(s) de Hora Especial para el
  // detalle por legajo — mismo patrón ya usado en findPeriodEmployees (11A) y
  // findForExport (8F). `include` (no `select`) ya trae appliedMultiplier por
  // default (es un escalar de TimeEntry), sólo falta esta relación anidada.
  timeSegment: {
    select: {
      specialHourRuleApplications: {
        where: { isWinner: true },
        select: { wasConflicting: true, doubleHourRule: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.TimeEntryInclude;

const timeGridNoveltyInclude = {
  employee: { select: { id: true, legajo: true, firstName: true, lastName: true } },
  noveltyType: {
    select: {
      id: true,
      code: true,
      name: true,
      origin: true,
      exportsToFinnegans: true,
      allowsHours: true,
      allowsDateTo: true,
      hasValidity: true,
      blocksTimeEntry: true,
      setsWorkedHoursToZero: true,
      timeImpact: true,
      approvalRoles: true,
      finnegansLinks: {
        where: { status: "ACTIVO" },
        orderBy: { priority: "asc" as const },
        select: { code: true, name: true, hasValidity: true, status: true },
      },
    },
  },
  targetHourConcept: { select: { id: true, name: true } },
  documents: { select: { fileName: true }, orderBy: { createdAt: "desc" as const }, take: 1 },
} satisfies Prisma.NoveltyInclude;

function periodRange(period: string) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

type TimeGridCatalogs = {
  noveltyTypes: Awaited<ReturnType<typeof prisma.noveltyType.findMany>>;
  hourConcepts: Awaited<ReturnType<typeof prisma.hourConcept.findMany>>;
};
let timeGridCatalogCache: { data: TimeGridCatalogs; expiresAt: number } | null = null;
const TIME_GRID_CATALOG_CACHE_MS = 120_000;

async function getTimeGridCatalogs() {
  if (timeGridCatalogCache && Date.now() < timeGridCatalogCache.expiresAt) return timeGridCatalogCache.data;
  const [noveltyTypes, hourConcepts] = await Promise.all([
    prisma.noveltyType.findMany({
      where: { status: "ACTIVO" },
      include: { finnegansLinks: { orderBy: [{ priority: "asc" }, { code: "asc" }] } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: 500,
    }),
    prisma.hourConcept.findMany({
      where: { status: "ACTIVO" },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      take: 100,
    }),
  ]);
  const data = { noveltyTypes, hourConcepts };
  timeGridCatalogCache = { data, expiresAt: Date.now() + TIME_GRID_CATALOG_CACHE_MS };
  return data;
}

const employeeLaborAuditSelect = {
  id: true,
  legajo: true,
  status: true,
  laborMovements: {
    select: {
      id: true,
      type: true,
      effectiveFrom: true,
      reason: true,
      observation: true,
    },
    orderBy: { effectiveFrom: "desc" as const },
    take: 20,
  },
} satisfies Prisma.EmployeeSelect;

const employeeOrgChartSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  status: true,
  receiptCategory: true,
  internalCategory: true,
  companies: { include: { company: { select: { id: true, name: true, code: true } } } },
  sector: {
    select: {
      id: true,
      name: true,
      code: true,
      area: {
        select: {
          name: true,
          establishment: { select: { name: true, businessUnit: { select: { name: true } } } },
        },
      },
    },
  },
  costCenter: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, name: true, code: true } },
  assignments: { select: { type: true, personName: true } },
} satisfies Prisma.EmployeeSelect;

export function resolveLaborStatus(
  movements: Array<{ type: "ALTA" | "BAJA"; effectiveFrom: Date }>,
  reference: Date = new Date(),
): EmployeeStatus {
  const today = argentinaCalendarDate(todayArgentinaDateKey(reference));
  const sorted = [...movements].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  const effective = sorted.filter((movement) => movement.effectiveFrom <= today);
  const current = effective[effective.length - 1];
  const scheduledStart = sorted.find((movement) => movement.type === "ALTA" && movement.effectiveFrom > today);
  if (!current && scheduledStart) return EmployeeStatus.INACTIVO;
  return current?.type === "BAJA" ? EmployeeStatus.INACTIVO : EmployeeStatus.ACTIVO;
}

function laborStatusMovements(movements: Array<{ type: "ALTA" | "BAJA"; effectiveFrom: Date }>) {
  return movements.map((movement) => ({ effectiveFrom: movement.effectiveFrom, type: movement.type }));
}

function resolveEmployeeStatus(employee: { status: EmployeeStatus; laborMovements: Array<{ type: "ALTA" | "BAJA"; effectiveFrom: Date }> }) {
  if (!employee.laborMovements.length) return employee.status;
  return resolveLaborStatus(laborStatusMovements(employee.laborMovements));
}

function buildWhere(query: ListEmployeesQuery): Prisma.EmployeeWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.sectorId ? { sectorId: query.sectorId } : {}),
    ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
    ...(query.companyId ? { companies: { some: { companyId: query.companyId } } } : {}),
    ...(search
      ? {
          OR: [
            { legajo: { contains: search, mode: "insensitive" } },
            { legajoFinnegans: { contains: search, mode: "insensitive" } },
            { cuil: { contains: search, mode: "insensitive" } },
            { dni: { contains: search, mode: "insensitive" } },
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function buildOrgChartWhere(query: ListEmployeeOrgChartQuery): Prisma.EmployeeWhereInput {
  const search = query.search?.trim();
  return {
    status: query.status,
    ...(query.sectorId ? { sectorId: query.sectorId } : {}),
    ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
    ...(query.positionId ? { positionId: query.positionId } : {}),
    ...(query.companyId ? { companies: { some: { companyId: query.companyId } } } : {}),
    ...(search
      ? {
          OR: [
            { legajo: { contains: search, mode: "insensitive" } },
            { legajoFinnegans: { contains: search, mode: "insensitive" } },
            { cuil: { contains: search, mode: "insensitive" } },
            { dni: { contains: search, mode: "insensitive" } },
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { position: { name: { contains: search, mode: "insensitive" } } },
            { sector: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

function buildOptionsWhere(query: ListEmployeeOptionsQuery): Prisma.EmployeeWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.sectorId ? { sectorId: query.sectorId } : {}),
    ...(query.companyId ? { companies: { some: { companyId: query.companyId } } } : {}),
    ...(search
      ? {
          OR: [
            { legajo: { contains: search, mode: "insensitive" } },
            { legajoFinnegans: { contains: search, mode: "insensitive" } },
            { cuil: { contains: search, mode: "insensitive" } },
            { dni: { contains: search, mode: "insensitive" } },
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function createEmployeeData(input: CreateEmployeeInput) {
  return {
    legajo: input.legajo,
    legajoFinnegans: input.legajoFinnegans || null,
    cuil: input.cuil,
    dni: input.dni,
    firstName: input.firstName,
    lastName: input.lastName,
    birthDate: input.birthDate || null,
    gender: input.gender || null,
    civilStatus: input.civilStatus || null,
    nationality: input.nationality || null,
    email: input.email || null,
    phone: input.phone || null,
    mobile: input.mobile || null,
    emergencyContact: input.emergencyContact || null,
    emergencyRelation: input.emergencyRelation || null,
    emergencyPhone: input.emergencyPhone || null,
    status: input.status,
    positionId: input.positionId || null,
    sectorId: input.sectorId || null,
    costCenterId: input.costCenterId || null,
    healthInsurance: input.healthInsurance || null,
    agreement: input.agreement || null,
    receiptCategory: input.receiptCategory || null,
    internalCategory: input.internalCategory || null,
  };
}

function updateEmployeeData(input: UpdateEmployeeInput) {
  return {
    ...(input.legajo !== undefined ? { legajo: input.legajo } : {}),
    ...(input.legajoFinnegans !== undefined ? { legajoFinnegans: input.legajoFinnegans || null } : {}),
    ...(input.cuil !== undefined ? { cuil: input.cuil } : {}),
    ...(input.dni !== undefined ? { dni: input.dni } : {}),
    ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
    ...(input.birthDate !== undefined ? { birthDate: input.birthDate || null } : {}),
    ...(input.gender !== undefined ? { gender: input.gender || null } : {}),
    ...(input.civilStatus !== undefined ? { civilStatus: input.civilStatus || null } : {}),
    ...(input.nationality !== undefined ? { nationality: input.nationality || null } : {}),
    ...(input.email !== undefined ? { email: input.email || null } : {}),
    ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
    ...(input.mobile !== undefined ? { mobile: input.mobile || null } : {}),
    ...(input.emergencyContact !== undefined ? { emergencyContact: input.emergencyContact || null } : {}),
    ...(input.emergencyRelation !== undefined ? { emergencyRelation: input.emergencyRelation || null } : {}),
    ...(input.emergencyPhone !== undefined ? { emergencyPhone: input.emergencyPhone || null } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.positionId !== undefined ? { positionId: input.positionId || null } : {}),
    ...(input.sectorId !== undefined ? { sectorId: input.sectorId || null } : {}),
    ...(input.costCenterId !== undefined ? { costCenterId: input.costCenterId || null } : {}),
    ...(input.healthInsurance !== undefined ? { healthInsurance: input.healthInsurance || null } : {}),
    ...(input.agreement !== undefined ? { agreement: input.agreement || null } : {}),
    ...(input.receiptCategory !== undefined ? { receiptCategory: input.receiptCategory || null } : {}),
    ...(input.internalCategory !== undefined ? { internalCategory: input.internalCategory || null } : {}),
  };
}

function companyLinks(companyIds: string[], primaryCompanyId?: string | null) {
  const uniqueIds = Array.from(new Set(companyIds.filter(Boolean)));
  return uniqueIds.map((companyId, index) => ({
    companyId,
    isPrimary: primaryCompanyId ? companyId === primaryCompanyId : index === 0,
  }));
}

async function fetchSyncBatch(cursor: string | undefined): Promise<Array<{ id: string; currentStatus: EmployeeStatus; nextStatus: EmployeeStatus }>> {
  const rows = await prisma.employee.findMany({
    take: 100,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { id: "asc" },
    select: {
      id: true,
      status: true,
      laborMovements: { select: { type: true, effectiveFrom: true }, orderBy: { effectiveFrom: "desc" }, take: 5 },
    },
  });
  return rows.map((emp) => ({
    id: emp.id,
    currentStatus: emp.status as EmployeeStatus,
    nextStatus: resolveLaborStatus(emp.laborMovements.map((m) => ({ effectiveFrom: m.effectiveFrom, type: m.type as "ALTA" | "BAJA" }))),
  }));
}

export const employeesRepository = {
  async findMany(query: ListEmployeesQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where = { AND: [buildWhere(query), accessWhere, ...(query.status ? [{ status: query.status }] : [])] };
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.employee.findMany({
        where,
        select: employeeListSelect,
        orderBy: [{ status: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.employee.count({ where }),
    ]);
  },

  // Etapa 14C.1: `$transaction([...])` -> `Promise.all([...])`. Estas 3
  // queries son contadores agregados de resumen (tarjetas de Legajos), no un
  // guardado — misma categoría de dato que `dashboard.service.ts:
  // calculateMetrics` (15 queries en un único Promise.all, sin transacción,
  // ver docs/PERFORMANCE_STANDARDS.md §2.E). La forma-array de `$transaction`
  // ejecuta las queries secuencialmente dentro de la misma transacción en
  // Postgres — no en paralelo — lo que explicaba buena parte de los 1521ms
  // medidos en el journey real de 14B.3. `Promise.all` sí garantiza
  // concurrencia real. No requieren una foto transaccional consistente entre
  // sí (son 3 conteos independientes para 3 tarjetas separadas).
  async summary(accessWhere: Prisma.EmployeeWhereInput) {
    const [statusGroups, pendingTimeEmployeeGroups, missingTimeResponsible] = await Promise.all([
      prisma.employee.groupBy({
        by: ["status"],
        where: accessWhere,
        _count: { _all: true },
      }),
      prisma.timeEntry.groupBy({
        by: ["employeeId"],
        orderBy: { employeeId: "asc" },
        where: {
          employee: accessWhere,
          status: { in: [ApprovalStatus.PENDIENTE, ApprovalStatus.EN_REVISION] },
        },
      }),
      prisma.employee.count({
        where: {
          ...accessWhere,
          status: EmployeeStatus.ACTIVO,
          assignments: { none: { type: "TIME_RESPONSIBLE" } },
        },
      }),
    ]);
    const active = statusGroups.find((group) => group.status === EmployeeStatus.ACTIVO)?._count._all || 0;
    const total = statusGroups.reduce((sum, group) => sum + group._count._all, 0);
    const inactive = total - active;

    return {
      total,
      active,
      inactive,
      missingTimeResponsible,
      pendingTimeLoads: pendingTimeEmployeeGroups.length,
    };
  },

  findOrgChart(query: ListEmployeeOrgChartQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where = { AND: [buildOrgChartWhere(query), accessWhere] };
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.employee.findMany({
        where,
        select: employeeOrgChartSelect,
        orderBy: [{ internalCategory: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.employee.count({ where }),
    ]);
  },

  findOptions(query: ListEmployeeOptionsQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where = { AND: [buildOptionsWhere(query), accessWhere] };
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.employee.findMany({
        where,
        select: employeeOptionSelect,
        orderBy: [{ status: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.employee.count({ where }),
    ]);
  },

  findById(id: string, accessWhere: Prisma.EmployeeWhereInput = {}) {
    return prisma.employee.findFirst({ where: { AND: [{ id }, accessWhere] }, select: employeeDetailSelect });
  },

  findUpdateAuditSnapshot(id: string) {
    return prisma.employee.findUnique({ where: { id }, select: employeeUpdateAuditSelect });
  },

  findAssignmentsAuditSnapshot(id: string) {
    return prisma.employee.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        legajo: true,
        assignments: { take: 100, include: { user: { select: { id: true, name: true, employeeId: true } } } },
      },
    });
  },

  findContactAuditSnapshot(id: string) {
    return prisma.employee.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        legajo: true,
        email: true,
        phone: true,
        mobile: true,
        emergencyContact: true,
        emergencyRelation: true,
        emergencyPhone: true,
      },
    });
  },

  findAddressAuditSnapshot(id: string) {
    return prisma.employee.findUniqueOrThrow({
      where: { id },
      select: { id: true, legajo: true, address: true },
    });
  },

  findTransportAuditSnapshot(id: string) {
    return prisma.employee.findUniqueOrThrow({
      where: { id },
      select: { id: true, legajo: true, transport: true },
    });
  },

  findHourConceptsAuditSnapshot(id: string) {
    return prisma.employee.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        legajo: true,
        hourConcepts: { select: { hourConcept: { select: { id: true, code: true, name: true } } } },
      },
    });
  },

  findOverviewById(id: string, accessWhere: Prisma.EmployeeWhereInput = {}) {
    return prisma.employee.findFirst({ where: { AND: [{ id }, accessWhere] }, select: employeeOverviewCoreSelect });
  },

  // Etapa 14C.1: antes era un único `findFirst` con `companies`/
  // `laborMovements`/`assignments`/`hourConcepts` anidados (~10 round-trips
  // secuenciales/no garantizadamente paralelos sin relationJoins, medido en
  // 6021-6441ms en el journey real de 14B.3 — ver
  // docs/decisions/EMPLOYEE_PERFORMANCE_14C1.md). El core (escalares +
  // relaciones to-one) se resuelve primero para poder aplicar `accessWhere`
  // (control de acceso por rol) — si no existe o no es accesible, se corta
  // acá y nunca se disparan las 4 consultas hijas. Esas 4 sólo filtran por
  // `employeeId` (ya validado vía el core), en paralelo real con
  // `Promise.all` — mismo patrón ya usado en `dashboard.service.ts` y en la
  // Etapa 13F. `hourConcepts` reusa `assignableHourConceptsSelect` tal cual
  // (única fuente de verdad del where/select de habilitación, compartida con
  // `findById` — ver el comentario en su definición) para no reintroducir el
  // bug de la Etapa 6L.1. El objeto final devuelto tiene EXACTAMENTE el mismo
  // shape que antes de esta etapa — el frontend no necesita ningún cambio.
  async findOverviewDetailsById(id: string, accessWhere: Prisma.EmployeeWhereInput = {}) {
    const core = await prisma.employee.findFirst({
      where: { AND: [{ id }, accessWhere] },
      select: employeeOverviewDetailsCoreSelect,
    });
    if (!core) return null;

    const [companies, laborMovements, assignments, hourConcepts] = await Promise.all([
      prisma.employeeCompany.findMany({
        where: { employeeId: id },
        select: { isPrimary: true, company: { select: { id: true, name: true, code: true } } },
      }),
      prisma.laborMovement.findMany({
        where: { employeeId: id },
        include: { createdBy: { select: { id: true, name: true } } },
        orderBy: { effectiveFrom: "desc" },
        take: 50,
      }),
      prisma.employeeAssignment.findMany({
        where: { employeeId: id },
        take: 100,
        include: { user: { select: { id: true, name: true, employeeId: true } } },
      }),
      prisma.employeeHourConcept.findMany({
        where: { employeeId: id, ...assignableHourConceptsSelect.where },
        select: assignableHourConceptsSelect.select,
      }),
    ]);

    return { ...core, companies, laborMovements, assignments, hourConcepts };
  },

  async findTimeGrid(id: string, query: EmployeeTimeGridQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const { start, end } = periodRange(query.period);
    const [employee, entries, novelties, catalogs, observedShifts, observedPunches, normalConcept, breakdowns] = await Promise.all([
      prisma.employee.findFirst({
        where: { AND: [{ id }, accessWhere] },
        select: query.includeDetails ? timeGridEmployeeSelect : timeGridCoreEmployeeSelect,
      }),
      prisma.timeEntry.findMany({
        where: { employeeId: id, period: query.period },
        include: timeGridTimeEntryInclude,
        orderBy: [{ date: "asc" }, { hourConcept: { name: "asc" } }],
      }),
      query.includeDetails
        ? prisma.novelty.findMany({
            where: {
              employeeId: id,
              fromDate: { lt: end },
              OR: [{ toDate: null }, { toDate: { gte: start } }],
            },
            include: timeGridNoveltyInclude,
            orderBy: [{ fromDate: "asc" }, { createdAt: "desc" }],
            take: 200,
          })
        : Promise.resolve([]),
      query.includeDetails ? getTimeGridCatalogs() : Promise.resolve(null),
      prisma.workShift.count({
        where: {
          employeeId: id,
          startAt: { gte: start, lt: end },
          status: { in: ["FALTA_SALIDA", "FALTA_INGRESO", "OBSERVADO", "INVALIDO"] },
          reviewStatus: "PENDIENTE",
        },
      }),
      prisma.attendancePunch.count({
        where: {
          employeeId: id,
          timestamp: { gte: start, lt: end },
          status: { in: ["OBSERVADA", "RECHAZADA"] },
          reviewStatus: "PENDIENTE",
          startWorkShifts: { none: {} },
          endWorkShifts: { none: {} },
        },
      }),
      prisma.hourConcept.findFirst({
        where: { systemRole: "NORMAL_BASE", status: "ACTIVO", deletedAt: null },
        select: { id: true, code: true, name: true, kind: true, loadMode: true, status: true, systemRole: true },
      }),
      prisma.hourConceptBreakdown.findMany({
        where: {
          employeeId: id,
          period: query.period,
          status: { in: ["BORRADOR", "PENDIENTE", "EN_REVISION", "APROBADO", "DEVUELTO", "CERRADO"] },
        },
        select: { date: true, day: true, hourConceptId: true, minutes: true, status: true },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    if (!employee) return null;

    return {
      employee,
      entries,
      novelties,
      noveltyTypes: catalogs?.noveltyTypes ?? [],
      hourConcepts: catalogs?.hourConcepts ?? [],
      normalConcept,
      breakdowns,
      attendanceIssues: observedShifts + observedPunches,
    };
  },

  findEmployeeForManualBreakdown(id: string, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.findFirst({ where: { AND: [{ id }, accessWhere] }, select: { id: true } });
  },

  findHourConceptForManualBreakdown(id: string) {
    return prisma.hourConcept.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, status: true, deletedAt: true, loadMode: true, systemRole: true },
    });
  },

  async isHourConceptEnabled(employeeId: string, hourConceptId: string) {
    return Boolean(await prisma.employeeHourConcept.findUnique({
      where: { employeeId_hourConceptId: { employeeId, hourConceptId } },
      select: { employeeId: true },
    }));
  },

  findMonthlyClosure(employeeId: string, period: string) {
    return prisma.monthlyTimeClosure.findUnique({
      where: { employeeId_period: { employeeId, period } },
      select: { id: true, status: true },
    });
  },

  // Etapa 6L.3: approvedByUserId != null => lo cargó RRHH, aplica directo en
  // APROBADO. Sin ese id (Nivel 2/3) el desglose manual queda EN_REVISION —
  // no hay una acción separada de "enviar a revisión" para desgloses (a
  // diferencia de TimeEntry), así que el único guardado ya deja la fila
  // pendiente para que RRHH la vea en la bandeja.
  saveManualHourConceptBreakdown(input: {
    employeeId: string;
    hourConceptId: string;
    date: Date;
    period: string;
    day: number;
    minutes: number;
    observation?: string | null;
    createdByUserId?: string | null;
    approvedByUserId?: string | null;
  }) {
    return prisma.$transaction(async (tx) => {
      const where = { employeeId: input.employeeId, hourConceptId: input.hourConceptId, date: input.date, source: "MANUAL" as const };
      if (input.minutes === 0) {
        const deleted = await tx.hourConceptBreakdown.deleteMany({ where });
        return { item: null, deleted: deleted.count, operation: "DELETE" as const };
      }
      const status = input.approvedByUserId ? "APROBADO" : "EN_REVISION";
      const approvedAt = input.approvedByUserId ? new Date() : null;
      const existing = await tx.hourConceptBreakdown.findFirst({ where, orderBy: { createdAt: "asc" } });
      if (existing) {
        const item = await tx.hourConceptBreakdown.update({
          where: { id: existing.id },
          data: {
            minutes: input.minutes,
            observation: input.observation || null,
            period: input.period,
            day: input.day,
            status,
            approvedByUserId: input.approvedByUserId || null,
            approvedAt,
          },
        });
        await tx.hourConceptBreakdown.deleteMany({ where: { ...where, id: { not: existing.id } } });
        return { item, deleted: 0, operation: "UPDATE" as const };
      }
      const item = await tx.hourConceptBreakdown.create({
        data: {
          employeeId: input.employeeId,
          hourConceptId: input.hourConceptId,
          date: input.date,
          period: input.period,
          day: input.day,
          minutes: input.minutes,
          observation: input.observation || null,
          source: "MANUAL",
          status,
          createdByUserId: input.createdByUserId || null,
          ...(input.approvedByUserId ? { approvedByUserId: input.approvedByUserId, approvedAt } : {}),
        },
      });
      return { item, deleted: 0, operation: "CREATE" as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  // Etapa 6L.3 (ajuste): resolución RRHH de un desglose manual EN_REVISION
  // cargado por Nivel 2/3 — mismo criterio de scope que el resto del módulo.
  findManualBreakdownById(id: string, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.hourConceptBreakdown.findFirst({
      where: { id, source: "MANUAL", employee: accessWhere },
      include: {
        employee: { select: { id: true, legajo: true } },
        hourConcept: { select: { id: true, name: true } },
      },
    });
  },

  approveManualHourConceptBreakdown(id: string, approvedByUserId: string) {
    return prisma.hourConceptBreakdown.update({
      where: { id },
      data: { status: "APROBADO", approvedByUserId, approvedAt: new Date() },
      include: {
        employee: { select: { id: true, legajo: true } },
        hourConcept: { select: { id: true, name: true } },
      },
    });
  },

  rejectManualHourConceptBreakdown(id: string) {
    return prisma.hourConceptBreakdown.update({
      where: { id },
      data: { status: "RECHAZADO", approvedByUserId: null, approvedAt: null },
      include: {
        employee: { select: { id: true, legajo: true } },
        hourConcept: { select: { id: true, name: true } },
      },
    });
  },

  returnManualHourConceptBreakdown(id: string) {
    return prisma.hourConceptBreakdown.update({
      where: { id },
      data: { status: "DEVUELTO", approvedByUserId: null, approvedAt: null },
      include: {
        employee: { select: { id: true, legajo: true } },
        hourConcept: { select: { id: true, name: true } },
      },
    });
  },

  findLaborAuditSnapshot(id: string) {
    return prisma.employee.findUniqueOrThrow({ where: { id }, select: employeeLaborAuditSelect });
  },

  findByUniqueFields(input: Pick<CreateEmployeeInput, "legajo" | "legajoFinnegans" | "cuil" | "dni">) {
    const uniqueFields: Prisma.EmployeeWhereInput[] = [
      { legajo: input.legajo },
      { cuil: input.cuil },
      { dni: input.dni },
    ];
    if (input.legajoFinnegans) uniqueFields.push({ legajoFinnegans: input.legajoFinnegans });
    return prisma.employee.findFirst({
      where: { OR: uniqueFields },
      select: { id: true, legajo: true, legajoFinnegans: true, cuil: true, dni: true },
    });
  },

  findConflictingUniqueFields(id: string, input: UpdateEmployeeInput) {
    const uniqueFields: Prisma.EmployeeWhereInput[] = [];
    if (input.legajo !== undefined) uniqueFields.push({ legajo: input.legajo });
    if (input.legajoFinnegans) uniqueFields.push({ legajoFinnegans: input.legajoFinnegans });
    if (input.cuil !== undefined) uniqueFields.push({ cuil: input.cuil });
    if (input.dni !== undefined) uniqueFields.push({ dni: input.dni });
    if (!uniqueFields.length) return null;
    return prisma.employee.findFirst({
      where: { id: { not: id }, OR: uniqueFields },
      select: { id: true, legajo: true, legajoFinnegans: true, cuil: true, dni: true },
    });
  },

  async syncLaborStatuses() {
    let cursor: string | undefined = undefined;
    let totalScanned = 0;
    let totalUpdated = 0;

    while (true) {
      const batch = await fetchSyncBatch(cursor);

      if (batch.length === 0) break;

      cursor = batch[batch.length - 1]!.id;
      totalScanned += batch.length;

      const changes = batch
        .filter((emp) => emp.currentStatus !== emp.nextStatus);

      for (const change of changes) {
        await prisma.employee.update({
          where: { id: change.id },
          data: { status: change.nextStatus },
        });
        totalUpdated++;
      }
    }

    return { scanned: totalScanned, updated: totalUpdated };
  },

  create(input: CreateEmployeeInput, createdByUserId?: string | null) {
    const companies = companyLinks(input.companyIds, input.primaryCompanyId);
    const hourConceptIds = Array.from(new Set((input.hourConceptIds || []).filter(Boolean)));
    const initialMovements = input.initialLaborMovement
      ? [{
          type: input.initialLaborMovement.type,
          effectiveFrom: input.initialLaborMovement.effectiveFrom,
          reason: input.initialLaborMovement.reason,
          observation: input.initialLaborMovement.observation || null,
          createdByUserId: createdByUserId || null,
        }]
      : [];
    return prisma.employee.create({
      data: {
        ...createEmployeeData(input),
        ...(initialMovements.length ? { status: resolveLaborStatus(initialMovements) } : {}),
        createdByUserId: createdByUserId || null,
        ...(companies.length ? { companies: { createMany: { data: companies } } } : {}),
        ...(input.address ? { address: { create: input.address } } : {}),
        ...(hourConceptIds.length
          ? { hourConcepts: { createMany: { data: hourConceptIds.map((hourConceptId) => ({ hourConceptId })) } } }
          : {}),
        ...(initialMovements.length ? { laborMovements: { createMany: { data: initialMovements } } } : {}),
      },
      select: employeeDetailSelect,
    });
  },

  update(id: string, input: UpdateEmployeeInput) {
    const shouldReplaceCompanies = input.companyIds !== undefined || input.primaryCompanyId !== undefined;
    const companies = companyLinks(input.companyIds || [], input.primaryCompanyId);

    return prisma.employee.update({
      where: { id },
      data: {
        ...updateEmployeeData(input),
        ...(shouldReplaceCompanies
          ? {
              companies: {
                deleteMany: {},
                ...(companies.length ? { createMany: { data: companies } } : {}),
              },
            }
          : {}),
        ...(input.address
          ? {
              address: {
                upsert: {
                  create: input.address,
                  update: input.address,
                },
              },
            }
          : {}),
      },
      // La respuesta confirma los escalares escritos. Domicilio y empresas ya
      // están disponibles en el snapshot previo y el payload validado, por lo
      // que no hace falta volver a consultarlos para construir la auditoría.
      select: employeeUpdateWriteSelect,
    });
  },

  updateContact(employeeId: string, input: UpdateEmployeeContactInput) {
    return prisma.employee.update({
      where: { id: employeeId },
      data: {
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
        ...(input.mobile !== undefined ? { mobile: input.mobile || null } : {}),
        ...(input.emergencyContact !== undefined ? { emergencyContact: input.emergencyContact || null } : {}),
        ...(input.emergencyRelation !== undefined ? { emergencyRelation: input.emergencyRelation || null } : {}),
        ...(input.emergencyPhone !== undefined ? { emergencyPhone: input.emergencyPhone || null } : {}),
      },
      select: employeeDetailSelect,
    });
  },

  upsertAddress(employeeId: string, input: UpsertEmployeeAddressInput) {
    return prisma.employee.update({
      where: { id: employeeId },
      data: {
        address: {
          upsert: {
            create: input,
            update: input,
          },
        },
      },
      select: employeeDetailSelect,
    });
  },

  upsertTransport(employeeId: string, input: UpsertEmployeeTransportInput) {
    return prisma.employee.update({
      where: { id: employeeId },
      data: {
        transport: {
          upsert: {
            create: input,
            update: input,
          },
        },
      },
      select: employeeDetailSelect,
    });
  },

  async replaceAssignments(employeeId: string, assignments: EmployeeAssignmentInput[]) {
    // Etapa 6Q: el re-fetch con employeeDetailSelect (relaciones anidadas
    // pesadas) se saca de la transacción interactiva — es sólo lectura para
    // dar forma a la respuesta, no hace falta que sea atómico con el
    // delete+create, y mantenerlo afuera evita expirar el timeout de 5s de
    // Prisma bajo latencia alta de Neon (visto en QA de Etapa 6Q).
    await prisma.$transaction(async (tx) => {
      await tx.employeeAssignment.deleteMany({ where: { employeeId } });
      if (assignments.length) {
        await tx.employeeAssignment.createMany({
          data: assignments.map((assignment) => ({
            employeeId,
            type: assignment.type,
            userId: assignment.userId || null,
            personName: assignment.personName || null,
            role: assignment.role || null,
            effectiveFrom: assignment.effectiveFrom || null,
            effectiveTo: assignment.effectiveTo || null,
            status: assignment.status || null,
            notes: assignment.notes || null,
          })),
        });
      }
    });
    return prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: employeeDetailSelect });
  },

  async replaceHourConcepts(employeeId: string, hourConceptIds: string[]) {
    // Etapa 6Q: mismo criterio que replaceAssignments — el re-fetch pesado
    // se hace fuera de la transacción interactiva.
    const uniqueIds = Array.from(new Set(hourConceptIds.filter(Boolean)));
    await prisma.$transaction(async (tx) => {
      await tx.employeeHourConcept.deleteMany({ where: { employeeId } });
      if (uniqueIds.length) {
        await tx.employeeHourConcept.createMany({
          data: uniqueIds.map((hourConceptId) => ({ employeeId, hourConceptId })),
        });
      }
    });
    return prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: employeeDetailSelect });
  },

  findAssignableHourConceptIds(hourConceptIds: string[]) {
    return prisma.hourConcept.findMany({
      where: {
        id: { in: hourConceptIds },
        systemRole: null,
        status: "ACTIVO",
        deletedAt: null,
        loadMode: { not: null },
      },
      select: { id: true },
    });
  },

  // Etapa 7A: mismo criterio que replaceAssignments/replaceHourConcepts (6Q).
  // El create + recálculo de estado sí necesitan ser atómicos y quedan dentro
  // de la transacción; el re-fetch con employeeDetailSelect (relaciones
  // anidadas pesadas) es sólo lectura para dar forma a la respuesta y se hace
  // después de que la transacción cerró, para no arriesgar el timeout de 5s
  // de Prisma bajo latencia alta de Neon.
  async createLaborMovement(employeeId: string, input: CreateLaborMovementInput, createdByUserId?: string | null) {
    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.laborMovement.create({
        data: {
          employeeId,
          type: input.type,
          effectiveFrom: input.effectiveFrom,
          reason: input.reason,
          observation: input.observation || null,
          createdByUserId: createdByUserId || null,
        },
      });

      const movements = await tx.laborMovement.findMany({
        where: { employeeId },
        select: { type: true, effectiveFrom: true },
      });

      await tx.employee.update({
        where: { id: employeeId },
        data: { status: resolveLaborStatus(movements) },
      });

      return created;
    });

    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: employeeDetailSelect });
    return { employee, movement };
  },

  findDocumentCategory(categoryId: string) {
    return prisma.documentCategory.findUnique({
      where: { id: categoryId },
      select: { id: true, code: true, name: true },
    });
  },

  async createDocument(
    employeeId: string,
    input: Omit<CreateEmployeeDocumentInput, "storageKey"> & { storageKey: string; storageFileId?: string | null },
    uploadedByUserId?: string | null,
  ) {
    // Etapa 7A: mismo criterio que 6Q — el re-fetch con employeeDetailSelect
    // se hace fuera de la transacción. Acá además la transacción sólo envolvía
    // ese create (que ya es atómico por sí mismo) más la lectura pesada, así
    // que sacarla no pierde ninguna garantía.
    await prisma.employeeDocument.create({
      data: {
        employeeId,
        categoryId: input.categoryId,
        noveltyId: input.noveltyId || null,
        fileName: input.fileName,
        fileMimeType: input.fileMimeType,
        fileSizeBytes: input.fileSizeBytes,
        storageKey: input.storageKey,
        storageFileId: input.storageFileId || null,
        status: input.status,
        notes: input.notes || null,
        issuedAt: input.issuedAt || null,
        expiresAt: input.expiresAt || null,
        uploadedByUserId: uploadedByUserId || null,
      },
    });

    return prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: employeeDetailSelect });
  },

  findFieldHistory(employeeId: string, query: ListEmployeeHistoryQuery) {
    return prisma.employeeFieldHistory.findMany({
      where: {
        employeeId,
        ...(query.section ? { section: query.section } : {}),
        ...(query.field ? { field: query.field } : {}),
      },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      take: query.take,
    });
  },

  createFieldHistory(employeeId: string, input: CreateEmployeeFieldHistoryInput, createdByUserId?: string | null) {
    return prisma.employeeFieldHistory.create({
      data: {
        employeeId,
        section: input.section,
        field: input.field,
        fieldLabel: input.fieldLabel,
        oldValue: input.oldValue || null,
        newValue: input.newValue,
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
        createdByUserId: createdByUserId || null,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  },

  findBlockHistory(employeeId: string, query: ListEmployeeHistoryQuery) {
    return prisma.employeeBlockHistory.findMany({
      where: {
        employeeId,
        ...(query.section ? { section: query.section } : {}),
        ...(query.block ? { block: query.block } : {}),
      },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      take: query.take,
    });
  },

  createBlockHistory(employeeId: string, input: CreateEmployeeBlockHistoryInput, createdByUserId?: string | null) {
    return prisma.employeeBlockHistory.create({
      data: {
        employeeId,
        section: input.section,
        block: input.block,
        blockLabel: input.blockLabel,
        oldValue: input.oldValue || null,
        newValue: input.newValue,
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
        createdByUserId: createdByUserId || null,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  },
};
