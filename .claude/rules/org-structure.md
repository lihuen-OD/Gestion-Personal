---
paths:
  - "backend/prisma/schema.prisma"
  - "backend/prisma/migrations/**/*"
  - "backend/src/modules/org-structure/**/*"
  - "backend/src/modules/employees/**/*"
  - "backend/src/modules/positions/**/*"
  - "backend/src/modules/users/**/*"
  - "backend/src/modules/workforce-management/**/*"
  - "backend/src/modules/clock-devices/**/*"
  - "backend/src/modules/labor-history/**/*"
  - "backend/scripts/org-reorg*"
  - "backend/scripts/org-reorg/**/*"
  - "backend/scripts/dev-org-wipe.ts"
---
# Organizational structure rules

Read this whole file before any task on the organizational models listed in AGENTS.md "Specialized rules", wherever the first file is. The trigger rule, the destructive-data rule, the authorship rule and the `DoubleHourRule` scope rule stay in AGENTS.md "Critical project rules".

  - **Model in effect:** independent single-parent trees Organization `Company → BusinessUnit → Sector → Area` (`Sector.businessUnitId`, `Area.sectorId`) and Locations `Province → Zone → Establishment → EstablishmentUnit` (`Zone.provinceId`, nullable only for zones pending reload; `Establishment.zoneId`; `EstablishmentUnit.establishmentId`; work locations cover a whole establishment or explicit units via `EmployeeWorkLocationEstablishment.coverage` + `EmployeeWorkLocationUnit`); position scope via `PositionOrgScope`; employee work locations via `EmployeeWorkLocation`. `Employee.sectorId`, `User.sectorId` and `ClockDevice.sectorId` no longer exist (M2).
  - **Legacy columns kept only as the shape of archived rows:** `Sector.areaId`, `Area.establishmentId`, `Establishment.companyId/businessUnitId`, `Position.sectorId` and `@@unique([companyId, code])`. Row CHECKs enforce archived ⇒ no new parent, active ⇒ new parent. Do not add new readers or writers of them for active rows, and do not add a second parent FK.
  - `CostCenter` stays the only approved many-to-many against the structure. `PositionSalaryCategory` stays the only source of a position's salary category/categories. Do not reintroduce denormalized area/establishment/business-unit/company name fields or a single "suggested category" field on `Position`, and do not copy a position's scope into editable employee fields.
