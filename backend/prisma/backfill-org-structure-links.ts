import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function backfillBusinessUnits() {
  const items = await prisma.businessUnit.findMany({ select: { id: true, companyId: true } });
  for (const item of items) {
    await prisma.businessUnitCompany.upsert({
      where: { businessUnitId_companyId: { businessUnitId: item.id, companyId: item.companyId } },
      update: {},
      create: { businessUnitId: item.id, companyId: item.companyId },
    });
  }
  return items.length;
}

async function backfillEstablishments() {
  const items = await prisma.establishment.findMany({ select: { id: true, companyId: true, businessUnitId: true } });
  for (const item of items) {
    await prisma.establishmentCompany.upsert({
      where: { establishmentId_companyId: { establishmentId: item.id, companyId: item.companyId } },
      update: {},
      create: { establishmentId: item.id, companyId: item.companyId },
    });
    if (item.businessUnitId) {
      await prisma.establishmentBusinessUnit.upsert({
        where: { establishmentId_businessUnitId: { establishmentId: item.id, businessUnitId: item.businessUnitId } },
        update: {},
        create: { establishmentId: item.id, businessUnitId: item.businessUnitId },
      });
    }
  }
  return items.length;
}

async function backfillAreas() {
  const items = await prisma.area.findMany({
    select: {
      id: true,
      establishmentId: true,
      establishment: { select: { businessUnitId: true } },
    },
  });
  for (const item of items) {
    if (item.establishmentId) {
      await prisma.areaEstablishment.upsert({
        where: { areaId_establishmentId: { areaId: item.id, establishmentId: item.establishmentId } },
        update: {},
        create: { areaId: item.id, establishmentId: item.establishmentId },
      });
    }
    if (item.establishment?.businessUnitId) {
      await prisma.areaBusinessUnit.upsert({
        where: { areaId_businessUnitId: { areaId: item.id, businessUnitId: item.establishment.businessUnitId } },
        update: {},
        create: { areaId: item.id, businessUnitId: item.establishment.businessUnitId },
      });
    }
  }
  return items.length;
}

async function backfillSectors() {
  const items = await prisma.sector.findMany({
    select: {
      id: true,
      areaId: true,
      area: { select: { establishmentId: true } },
    },
  });
  for (const item of items) {
    if (item.areaId) {
      await prisma.sectorArea.upsert({
        where: { sectorId_areaId: { sectorId: item.id, areaId: item.areaId } },
        update: {},
        create: { sectorId: item.id, areaId: item.areaId },
      });
    }
    if (item.area?.establishmentId) {
      await prisma.sectorEstablishment.upsert({
        where: { sectorId_establishmentId: { sectorId: item.id, establishmentId: item.area.establishmentId } },
        update: {},
        create: { sectorId: item.id, establishmentId: item.area.establishmentId },
      });
    }
  }
  return items.length;
}

async function backfillCostCenters() {
  const items = await prisma.costCenter.findMany({ select: { id: true } });
  const employees = await prisma.employee.findMany({
    select: {
      costCenterId: true,
      sectorId: true,
      companies: { select: { companyId: true } },
      sector: {
        select: {
          areaId: true,
          area: {
            select: {
              establishmentId: true,
              establishment: { select: { businessUnitId: true, companyId: true } },
            },
          },
        },
      },
    },
    where: { costCenterId: { not: null } },
  });

  for (const center of items) {
    const relatedEmployees = employees.filter((employee) => employee.costCenterId === center.id);
    const companyIds = new Set<string>();
    const businessUnitIds = new Set<string>();
    const establishmentIds = new Set<string>();
    const areaIds = new Set<string>();
    const sectorIds = new Set<string>();

    for (const employee of relatedEmployees) {
      employee.companies.forEach((company) => companyIds.add(company.companyId));
      if (employee.sectorId) sectorIds.add(employee.sectorId);
      if (employee.sector?.areaId) areaIds.add(employee.sector.areaId);
      if (employee.sector?.area?.establishmentId) establishmentIds.add(employee.sector.area.establishmentId);
      if (employee.sector?.area?.establishment?.businessUnitId) businessUnitIds.add(employee.sector.area.establishment.businessUnitId);
      if (employee.sector?.area?.establishment?.companyId) companyIds.add(employee.sector.area.establishment.companyId);
    }

    for (const companyId of companyIds) {
      await prisma.costCenterCompany.upsert({
        where: { costCenterId_companyId: { costCenterId: center.id, companyId } },
        update: {},
        create: { costCenterId: center.id, companyId },
      });
    }
    for (const businessUnitId of businessUnitIds) {
      await prisma.costCenterBusinessUnit.upsert({
        where: { costCenterId_businessUnitId: { costCenterId: center.id, businessUnitId } },
        update: {},
        create: { costCenterId: center.id, businessUnitId },
      });
    }
    for (const establishmentId of establishmentIds) {
      await prisma.costCenterEstablishment.upsert({
        where: { costCenterId_establishmentId: { costCenterId: center.id, establishmentId } },
        update: {},
        create: { costCenterId: center.id, establishmentId },
      });
    }
    for (const areaId of areaIds) {
      await prisma.costCenterArea.upsert({
        where: { costCenterId_areaId: { costCenterId: center.id, areaId } },
        update: {},
        create: { costCenterId: center.id, areaId },
      });
    }
    for (const sectorId of sectorIds) {
      await prisma.costCenterSector.upsert({
        where: { costCenterId_sectorId: { costCenterId: center.id, sectorId } },
        update: {},
        create: { costCenterId: center.id, sectorId },
      });
    }
  }

  return items.length;
}

async function main() {
  const [businessUnits, establishments, areas, sectors, costCenters] = await Promise.all([
    backfillBusinessUnits(),
    backfillEstablishments(),
    backfillAreas(),
    backfillSectors(),
    backfillCostCenters(),
  ]);

  console.info("Org structure backfill completed", {
    businessUnits,
    establishments,
    areas,
    sectors,
    costCenters,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
