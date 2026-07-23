import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Admin1234!", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@losod.local" },
    update: {},
    create: {
      name: "Administrador RRHH",
      email: "admin@losod.local",
      passwordHash,
      role: "NIVEL_1_RRHH",
    },
  });

  const company = await prisma.company.upsert({
    where: { code: "LOSOD" },
    update: {},
    create: {
      code: "LOSOD",
      name: "Los O'Dwyer",
    },
  });

  const businessUnit = await prisma.businessUnit.upsert({
    where: { companyId_code: { companyId: company.id, code: "ADM" } },
    update: {},
    create: {
      companyId: company.id,
      code: "ADM",
      name: "Administracion",
    },
  });

  const establishment = await prisma.establishment.upsert({
    where: { companyId_code: { companyId: company.id, code: "CASA-CENTRAL" } },
    update: {},
    create: {
      companyId: company.id,
      businessUnitId: businessUnit.id,
      code: "CASA-CENTRAL",
      name: "Casa Central",
      province: "Entre Rios",
      department: "Colon",
      city: "Colon",
    },
  });

  const area = await prisma.area.upsert({
    where: { code: "ADM-GRAL" },
    update: {},
    create: {
      establishmentId: establishment.id,
      code: "ADM-GRAL",
      name: "Administracion General",
    },
  });

  const sector = await prisma.sector.upsert({
    where: { code: "RRHH" },
    update: {},
    create: {
      areaId: area.id,
      code: "RRHH",
      name: "RRHH",
    },
  });

  const supervisor = await prisma.user.upsert({
    where: { email: "supervisor@losod.local" },
    update: { sectorId: sector.id },
    create: {
      name: "Supervisor Demo",
      email: "supervisor@losod.local",
      passwordHash,
      role: "NIVEL_2_SUPERVISION",
      sectorId: sector.id,
    },
  });

  const cargaHorariaUser = await prisma.user.upsert({
    where: { email: "carga@losod.local" },
    update: {},
    create: {
      name: "Carga Horaria Demo",
      email: "carga@losod.local",
      passwordHash,
      role: "NIVEL_3_CARGA_HORARIA",
    },
  });

  const costCenter = await prisma.costCenter.upsert({
    where: { code: "ADM-01" },
    update: {},
    create: {
      code: "ADM-01",
      name: "Administracion Central",
    },
  });

  const salaryCategories = [
    { name: "Directorio", family: "Direccion" },
    { name: "Director", family: "Direccion" },
    { name: "Gerente General", family: "Direccion" },
    { name: "Direccion", family: "Direccion" },
    { name: "Gerencia", family: "Direccion" },
    { name: "Encargado A", family: "Encargado" },
    { name: "Encargado B", family: "Encargado" },
    { name: "Encargado C", family: "Encargado" },
    { name: "Encargado", family: "Encargado" },
    { name: "Administrativo A", family: "Administrativo" },
    { name: "Administrativo B", family: "Administrativo" },
    { name: "Administrativo C", family: "Administrativo" },
    { name: "Administrativo D", family: "Administrativo" },
    { name: "Administrativo", family: "Administrativo" },
    { name: "Especial A", family: "Especialista" },
    { name: "Especial B", family: "Especialista" },
    { name: "Especial C", family: "Especialista" },
    { name: "Especial D", family: "Especialista" },
    { name: "Especial E", family: "Especialista" },
    { name: "Especial F", family: "Especialista" },
    { name: "Especial G", family: "Especialista" },
    { name: "Especial H", family: "Especialista" },
    { name: "Especial I", family: "Especialista" },
    { name: "Especialista", family: "Especialista" },
    { name: "Operario A", family: "Operario" },
    { name: "Operario B", family: "Operario" },
    { name: "Operario C", family: "Operario" },
    { name: "Operario D", family: "Operario" },
    { name: "Peon General", family: "Operario" },
    { name: "Peon Especializado", family: "Operario" },
  ];

  for (const [index, category] of salaryCategories.entries()) {
    await prisma.salaryCategory.upsert({
      where: { name: category.name },
      update: { family: category.family, order: index + 1, status: "ACTIVO" },
      create: { ...category, order: index + 1 },
    });
  }

  const hourNormal = await prisma.hourConcept.upsert({
    where: { code: "HC-NORMAL" },
    update: {},
    create: {
      code: "HC-NORMAL",
      name: "Hora normal",
      kind: "NORMAL",
    },
  });

  await prisma.hourConcept.upsert({
    where: { code: "HC-GUARDIA" },
    update: {},
    create: {
      code: "HC-GUARDIA",
      name: "Guardia",
      kind: "GUARDIA",
    },
  });

  const noveltyType = await prisma.noveltyType.upsert({
    where: { code: "NOV-LLEGADA-TARDE" },
    update: {
      allowedLoadRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"],
      approvalRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión"],
    },
    create: {
      code: "NOV-LLEGADA-TARDE",
      name: "Llegada tarde",
      uiColor: "amber",
      kind: "HORARIA",
      origin: "INTERNA",
      allowsHours: true,
      allowsDateTo: false,
      hasValidity: false,
      requiresApproval: false,
      timeImpact: "REGISTRA_HORAS_NO_TRABAJADAS",
      allowedLoadRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"],
      approvalRoles: ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión"],
    },
  });

  await prisma.documentCategory.upsert({
    where: { code: "DOC-DNI" },
    update: {},
    create: {
      code: "DOC-DNI",
      name: "DNI",
      description: "Documento nacional de identidad.",
    },
  });

  const auditRoles = {
    rrhh: "Nivel 1 - RRHH",
    supervision: "Nivel 2 - SupervisiÃ³n / GestiÃ³n",
    carga: "Nivel 3 - Administrativo de Carga Horaria",
  };
  const auditParameters = [
    {
      code: "AUD-001",
      name: "Cambios de legajo",
      scope: "LEGAJO",
      severity: "CRITICO",
      description: "Audita altas, modificaciones y bajas de datos sensibles del legajo.",
      trackCreate: true,
      trackUpdate: true,
      trackDeleteOrDeactivate: true,
      trackApproval: false,
      trackExport: false,
      requiresReason: true,
      requiresEffectiveDate: true,
      visibleToRoles: [auditRoles.rrhh],
      notification: { enabled: true, rolesToNotify: [auditRoles.rrhh], notifyOnCreate: true, notifyOnUpdate: true, notifyOnDeleteOrDeactivate: true, notifyOnExport: false },
      retention: { amount: 10, unit: "ANIOS", lockAfterClose: true, allowExport: true },
    },
    {
      code: "AUD-002",
      name: "Carga y aprobacion de horas",
      scope: "HORAS",
      severity: "ADVERTENCIA",
      description: "Audita carga horaria, aprobaciones, cierres y reaperturas de periodo.",
      trackCreate: true,
      trackUpdate: true,
      trackDeleteOrDeactivate: true,
      trackApproval: true,
      trackExport: false,
      requiresReason: true,
      requiresEffectiveDate: false,
      visibleToRoles: [auditRoles.rrhh, auditRoles.supervision, auditRoles.carga],
      notification: { enabled: true, rolesToNotify: [auditRoles.rrhh, auditRoles.supervision], notifyOnCreate: false, notifyOnUpdate: true, notifyOnDeleteOrDeactivate: true, notifyOnExport: false },
      retention: { amount: 5, unit: "ANIOS", lockAfterClose: true, allowExport: true },
    },
    {
      code: "AUD-003",
      name: "Cierre y exportacion",
      scope: "LIQUIDACION",
      severity: "CRITICO",
      description: "Audita cierre, exportacion y reapertura de informacion exportable.",
      trackCreate: true,
      trackUpdate: true,
      trackDeleteOrDeactivate: false,
      trackApproval: true,
      trackExport: true,
      requiresReason: true,
      requiresEffectiveDate: false,
      visibleToRoles: [auditRoles.rrhh],
      notification: { enabled: true, rolesToNotify: [auditRoles.rrhh], notifyOnCreate: false, notifyOnUpdate: true, notifyOnDeleteOrDeactivate: false, notifyOnExport: true },
      retention: { amount: 10, unit: "ANIOS", lockAfterClose: true, allowExport: true },
    },
    {
      code: "AUD-004",
      name: "Gestion documental",
      scope: "DOCUMENTACION",
      severity: "ADVERTENCIA",
      description: "Audita carga, vencimiento, aprobacion y reemplazo de documentos.",
      trackCreate: true,
      trackUpdate: true,
      trackDeleteOrDeactivate: true,
      trackApproval: true,
      trackExport: false,
      requiresReason: false,
      requiresEffectiveDate: false,
      visibleToRoles: [auditRoles.rrhh, auditRoles.supervision],
      notification: { enabled: true, rolesToNotify: [auditRoles.rrhh], notifyOnCreate: false, notifyOnUpdate: true, notifyOnDeleteOrDeactivate: true, notifyOnExport: false },
      retention: { amount: 10, unit: "ANIOS", lockAfterClose: false, allowExport: true },
    },
    {
      code: "AUD-005",
      name: "Cambios de configuracion",
      scope: "CONFIGURACION",
      severity: "CRITICO",
      description: "Audita cambios en catalogos maestros y parametros del sistema.",
      trackCreate: true,
      trackUpdate: true,
      trackDeleteOrDeactivate: true,
      trackApproval: false,
      trackExport: false,
      requiresReason: true,
      requiresEffectiveDate: false,
      visibleToRoles: [auditRoles.rrhh],
      notification: { enabled: true, rolesToNotify: [auditRoles.rrhh], notifyOnCreate: true, notifyOnUpdate: true, notifyOnDeleteOrDeactivate: true, notifyOnExport: false },
      retention: { amount: 10, unit: "ANIOS", lockAfterClose: true, allowExport: true },
    },
  ];

  for (const parameter of auditParameters) {
    await prisma.auditParameter.upsert({
      where: { code: parameter.code },
      update: parameter,
      create: {
        ...parameter,
        createdBy: "Sistema",
        updatedBy: "Sistema",
        history: [
          {
            id: `${parameter.code}-seed`,
            action: "Alta inicial",
            description: `Se creo el parametro de auditoria ${parameter.name}.`,
            createdAt: "2026-06-01T09:00:00.000Z",
            createdByUserId: "system",
            createdByUserName: "Sistema",
          },
        ],
      },
    });
  }

  const position = await prisma.position.upsert({
    where: { code: "PUESTO-RRHH-ADMIN" },
    update: {},
    create: {
      code: "PUESTO-RRHH-ADMIN",
      name: "Administrativo RRHH",
      areaId: area.id,
      sectorId: sector.id,
      mission: "Gestionar informacion administrativa del personal.",
    },
  });

  const employee = await prisma.employee.upsert({
    where: { legajo: "000001" },
    update: {},
    create: {
      legajo: "000001",
      legajoFinnegans: "000001",
      cuil: "20-00000001-1",
      dni: "00000001",
      firstName: "Carlos",
      lastName: "Demo",
      status: "ACTIVO",
      positionId: position.id,
      sectorId: sector.id,
      costCenterId: costCenter.id,
      healthInsurance: "OSPRERA",
      createdByUserId: admin.id,
      companies: {
        create: {
          companyId: company.id,
          isPrimary: true,
        },
      },
      hourConcepts: {
        create: {
          hourConceptId: hourNormal.id,
        },
      },
      address: {
        create: {
          province: "Entre Rios",
          department: "Colon",
          city: "Colon",
          street: "12 de Abril",
          streetNumber: "118",
          postalCode: "E3280",
        },
      },
    },
  });

  const existingAssignment = await prisma.employeeAssignment.findFirst({
    where: { employeeId: employee.id, userId: cargaHorariaUser.id, type: "TIME_RESPONSIBLE" },
  });

  if (!existingAssignment) {
    await prisma.employeeAssignment.create({
      data: {
        employeeId: employee.id,
        userId: cargaHorariaUser.id,
        personName: cargaHorariaUser.name,
        type: "TIME_RESPONSIBLE",
      },
    });
  }

  const existingMovement = await prisma.laborMovement.findFirst({
    where: { employeeId: employee.id, type: "ALTA", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
  });

  if (!existingMovement) {
    await prisma.laborMovement.create({
      data: {
        employeeId: employee.id,
        type: "ALTA",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        reason: "Alta inicial demo",
        createdByUserId: admin.id,
      },
    });
  }

  const existingNovelty = await prisma.novelty.findFirst({
    where: {
      employeeId: employee.id,
      noveltyTypeId: noveltyType.id,
      fromDate: new Date("2026-06-01T00:00:00.000Z"),
    },
  });

  if (!existingNovelty) {
    await prisma.novelty.create({
      data: {
        employeeId: employee.id,
        noveltyTypeId: noveltyType.id,
        targetHourConceptId: hourNormal.id,
        status: "APROBADO",
        fromDate: new Date("2026-06-01T00:00:00.000Z"),
        quantityHours: "1",
        observation: "Seed inicial para validar novedad horaria.",
        createdByUserId: admin.id,
        approvedByUserId: admin.id,
        approvedAt: new Date(),
      },
    });
  }

  const shiftTemplate = await prisma.shiftTemplate.upsert({
    where: { code: "TURNO-MANIANA" },
    update: {},
    create: {
      code: "TURNO-MANIANA",
      name: "Turno Mañana",
      categoryName: "Administrativo",
      description: "Turno de referencia para jornada administrativa estandar.",
      startTime: "08:00",
      endTime: "16:00",
      crossesMidnight: false,
      expectedMinutes: 480,
      entryToleranceBeforeMinutes: 10,
      entryToleranceAfterMinutes: 10,
      exitToleranceBeforeMinutes: 20,
      exitToleranceAfterMinutes: 20,
      minimumMinutesForCompliance: 420,
      maximumInformativeMinutes: 540,
      missingOutAlertAfterMinutes: 60,
      absoluteOpenShiftLimitMinutes: 1200,
      createdByUserId: admin.id,
      updatedByUserId: admin.id,
    },
  });

  const existingShiftAssignment = await prisma.shiftAssignment.findUnique({
    where: { employeeId_shiftTemplateId: { employeeId: employee.id, shiftTemplateId: shiftTemplate.id } },
  });

  if (!existingShiftAssignment) {
    await prisma.shiftAssignment.create({
      data: {
        employeeId: employee.id,
        shiftTemplateId: shiftTemplate.id,
        status: "HABILITADO",
        assignedByUserId: admin.id,
        observation: "Asignacion inicial demo.",
      },
    });
  }

  console.info("Seed completed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
