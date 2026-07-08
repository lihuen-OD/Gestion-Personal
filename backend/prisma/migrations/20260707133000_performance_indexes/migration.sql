CREATE INDEX IF NOT EXISTS "LaborMovement_type_effectiveFrom_employeeId_idx"
  ON "LaborMovement"("type", "effectiveFrom", "employeeId");

CREATE INDEX IF NOT EXISTS "TimeEntry_period_status_employeeId_idx"
  ON "TimeEntry"("period", "status", "employeeId");

CREATE INDEX IF NOT EXISTS "TimeEntry_period_status_date_createdAt_idx"
  ON "TimeEntry"("period", "status", "date", "createdAt");

CREATE INDEX IF NOT EXISTS "WorkShift_status_startAt_idx"
  ON "WorkShift"("status", "startAt");

CREATE INDEX IF NOT EXISTS "WorkShift_startAt_endAt_idx"
  ON "WorkShift"("startAt", "endAt");

CREATE INDEX IF NOT EXISTS "AttendancePunch_status_timestamp_idx"
  ON "AttendancePunch"("status", "timestamp");

CREATE INDEX IF NOT EXISTS "EmployeeDocument_status_createdAt_idx"
  ON "EmployeeDocument"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_userId_createdAt_idx"
  ON "AuditLog"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx"
  ON "AuditLog"("action", "createdAt");
