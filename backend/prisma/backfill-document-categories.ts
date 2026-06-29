import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const rrhh = "Nivel 1 - RRHH";
const supervision = "Nivel 2 - Supervisión / Gestión";
const cargaHoraria = "Nivel 3 - Administrativo de Carga Horaria";

const categories = [
  {
    code: "DOC-001",
    name: "DNI",
    kind: "PERSONAL",
    description: "Documento de identidad del colaborador para alta y legajo.",
    scopes: ["LEGAJO", "ALTA_BAJA"],
    rules: { expires: false, alertBeforeDays: 0, mandatory: true, requiresApproval: true, allowMultipleFiles: false },
    uploadRoles: [rrhh],
    viewRoles: [rrhh],
    approvalRoles: [rrhh],
    externalLinks: [],
  },
  {
    code: "DOC-002",
    name: "Constancia de CUIL",
    kind: "LABORAL",
    description: "Constancia fiscal/laboral requerida para alta.",
    scopes: ["LEGAJO", "ALTA_BAJA"],
    rules: { expires: false, alertBeforeDays: 0, mandatory: true, requiresApproval: true, allowMultipleFiles: false },
    uploadRoles: [rrhh],
    viewRoles: [rrhh],
    approvalRoles: [rrhh],
    externalLinks: [],
  },
  {
    code: "DOC-003",
    name: "Apto medico",
    kind: "MEDICA",
    description: "Certificado medico laboral con vencimiento y alerta previa.",
    scopes: ["LEGAJO", "PUESTO"],
    rules: { expires: true, defaultValidityDays: 365, alertBeforeDays: 30, mandatory: true, requiresApproval: true, allowMultipleFiles: true },
    uploadRoles: [rrhh],
    viewRoles: [rrhh, supervision],
    approvalRoles: [rrhh],
    externalLinks: [],
  },
  {
    code: "DOC-004",
    name: "Certificado de enfermedad",
    kind: "NOVEDAD",
    description: "Documentacion respaldatoria para novedades de enfermedad o licencia medica.",
    scopes: ["NOVEDAD", "LEGAJO"],
    rules: { expires: false, alertBeforeDays: 0, mandatory: false, requiresApproval: true, allowMultipleFiles: true },
    uploadRoles: [rrhh, supervision, cargaHoraria],
    viewRoles: [rrhh, supervision],
    approvalRoles: [rrhh],
    externalLinks: [],
  },
  {
    code: "DOC-005",
    name: "Licencia de conducir",
    kind: "TRANSPORTE",
    description: "Licencia vigente para colaboradores habilitados a manejar vehiculos o colectivos.",
    scopes: ["LEGAJO", "TRANSPORTE"],
    rules: { expires: true, defaultValidityDays: 365, alertBeforeDays: 45, mandatory: false, requiresApproval: true, allowMultipleFiles: true },
    uploadRoles: [rrhh],
    viewRoles: [rrhh, supervision],
    approvalRoles: [rrhh],
    externalLinks: [],
  },
  {
    code: "DOC-006",
    name: "Alta temprana AFIP",
    kind: "LEGAL",
    description: "Constancia de alta laboral requerida para ingreso.",
    scopes: ["LEGAJO", "ALTA_BAJA"],
    rules: { expires: false, alertBeforeDays: 0, mandatory: true, requiresApproval: true, allowMultipleFiles: false },
    uploadRoles: [rrhh],
    viewRoles: [rrhh],
    approvalRoles: [rrhh],
    externalLinks: [],
  },
  {
    code: "DOC-007",
    name: "Contrato laboral",
    kind: "LEGAL",
    description: "Contrato, acuerdo o anexo laboral firmado.",
    scopes: ["LEGAJO", "ALTA_BAJA"],
    rules: { expires: false, alertBeforeDays: 0, mandatory: true, requiresApproval: true, allowMultipleFiles: true },
    uploadRoles: [rrhh],
    viewRoles: [rrhh],
    approvalRoles: [rrhh],
    externalLinks: [],
  },
  {
    code: "DOC-008",
    name: "Capacitacion obligatoria",
    kind: "CAPACITACION",
    description: "Certificado o evidencia de capacitaciones obligatorias por puesto o seguridad.",
    scopes: ["LEGAJO", "PUESTO"],
    rules: { expires: true, defaultValidityDays: 730, alertBeforeDays: 60, mandatory: false, requiresApproval: false, allowMultipleFiles: true },
    uploadRoles: [rrhh, supervision],
    viewRoles: [rrhh, supervision],
    approvalRoles: [rrhh],
    externalLinks: [],
  },
] as const;

async function main() {
  let created = 0;
  let updated = 0;

  for (const category of categories) {
    const existing = await prisma.documentCategory.findUnique({ where: { code: category.code } });
    await prisma.documentCategory.upsert({
      where: { code: category.code },
      update: {
        name: category.name,
        kind: category.kind,
        status: "ACTIVO",
        description: category.description,
        scopes: [...category.scopes],
        rules: category.rules,
        uploadRoles: [...category.uploadRoles],
        viewRoles: [...category.viewRoles],
        approvalRoles: [...category.approvalRoles],
        externalLinks: [...category.externalLinks],
      },
      create: {
        code: category.code,
        name: category.name,
        kind: category.kind,
        status: "ACTIVO",
        description: category.description,
        scopes: [...category.scopes],
        rules: category.rules,
        uploadRoles: [...category.uploadRoles],
        viewRoles: [...category.viewRoles],
        approvalRoles: [...category.approvalRoles],
        externalLinks: [...category.externalLinks],
      },
    });
    if (existing) updated += 1;
    else created += 1;
  }

  console.log(`Document categories backfill complete. Created: ${created}. Updated: ${updated}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
