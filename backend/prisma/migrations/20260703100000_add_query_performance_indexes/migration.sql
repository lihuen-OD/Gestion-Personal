-- Query performance indexes for dashboard, employee lists, audit timelines and paginated modules.

CREATE INDEX IF NOT EXISTS "Employee_status_lastName_firstName_idx" ON "Employee"("status", "lastName", "firstName");
CREATE INDEX IF NOT EXISTS "Employee_status_sectorId_idx" ON "Employee"("status", "sectorId");
CREATE INDEX IF NOT EXISTS "Employee_status_costCenterId_idx" ON "Employee"("status", "costCenterId");

CREATE INDEX IF NOT EXISTS "EmployeeCompany_companyId_idx" ON "EmployeeCompany"("companyId");
CREATE INDEX IF NOT EXISTS "EmployeeCompany_companyId_employeeId_idx" ON "EmployeeCompany"("companyId", "employeeId");

CREATE INDEX IF NOT EXISTS "EmployeeTransport_usesCompanyTransport_idx" ON "EmployeeTransport"("usesCompanyTransport");

CREATE INDEX IF NOT EXISTS "Novelty_employeeId_status_fromDate_idx" ON "Novelty"("employeeId", "status", "fromDate");
CREATE INDEX IF NOT EXISTS "Novelty_status_fromDate_idx" ON "Novelty"("status", "fromDate");
CREATE INDEX IF NOT EXISTS "Novelty_fromDate_toDate_idx" ON "Novelty"("fromDate", "toDate");

CREATE INDEX IF NOT EXISTS "TimeEntry_employeeId_hourConceptId_date_idx" ON "TimeEntry"("employeeId", "hourConceptId", "date");
CREATE INDEX IF NOT EXISTS "TimeEntry_period_employeeId_idx" ON "TimeEntry"("period", "employeeId");
CREATE INDEX IF NOT EXISTS "TimeEntry_period_status_idx" ON "TimeEntry"("period", "status");

CREATE INDEX IF NOT EXISTS "EmployeeDocument_employeeId_createdAt_idx" ON "EmployeeDocument"("employeeId", "createdAt");
CREATE INDEX IF NOT EXISTS "EmployeeDocument_status_expiresAt_idx" ON "EmployeeDocument"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "EmployeeDocument_createdAt_idx" ON "EmployeeDocument"("createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");
