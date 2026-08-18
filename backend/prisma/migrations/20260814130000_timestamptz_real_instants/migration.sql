-- Etapa 3 (2026-08-14): migrar a TIMESTAMPTZ(3) las columnas que representan
-- instantes reales (fichadas, turnos, revisiones, notificaciones, auditoria, etc.).
--
-- Esta migracion NO borra datos, NO cambia nombres de columnas y NO toca
-- fechas-calendario: TimeEntry.date, TimeSegment.date, ShiftTemplate.startTime/
-- endTime, AttendanceInactivityIncident.operationalDate, LaborMovement.effectiveFrom,
-- EmployeeAssignment.effectiveFrom/effectiveTo, EmployeeFieldHistory.effectiveFrom,
-- EmployeeBlockHistory.effectiveFrom, Novelty.fromDate/toDate, DoubleHourRule.fromDate/
-- toDate, EmployeeDocument.issuedAt/expiresAt y Employee.birthDate quedan sin cambios,
-- a la espera de una etapa separada para @db.Date.
--
-- Todo lo que se convierte aqui ya se escribe hoy como un instante UTC verdadero
-- (siempre via new Date() en el backend), asi que "USING columna AT TIME ZONE 'UTC'"
-- es una reinterpretacion del valor ya guardado, no una conversion con perdida ni
-- corrimiento de los datos existentes.

-- User
ALTER TABLE "User" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "User" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- Company
ALTER TABLE "Company" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Company" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- BusinessUnit
ALTER TABLE "BusinessUnit" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "BusinessUnit" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- Establishment
ALTER TABLE "Establishment" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Establishment" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- Area
ALTER TABLE "Area" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Area" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- Sector
ALTER TABLE "Sector" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Sector" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- CostCenter
ALTER TABLE "CostCenter" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "CostCenter" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- SalaryCategory
ALTER TABLE "SalaryCategory" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "SalaryCategory" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- Position
ALTER TABLE "Position" ALTER COLUMN "lastUpdatedAt" TYPE TIMESTAMPTZ(3) USING "lastUpdatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "Position" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Position" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- Employee
ALTER TABLE "Employee" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Employee" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- EmployeeAddress
ALTER TABLE "EmployeeAddress" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "EmployeeAddress" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- EmployeeTransport
ALTER TABLE "EmployeeTransport" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "EmployeeTransport" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- LaborMovement
ALTER TABLE "LaborMovement" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- EmployeeAssignment
ALTER TABLE "EmployeeAssignment" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- HourConcept
ALTER TABLE "HourConcept" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "HourConcept" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- EmployeeFieldHistory
ALTER TABLE "EmployeeFieldHistory" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- EmployeeBlockHistory
ALTER TABLE "EmployeeBlockHistory" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- NoveltyType
ALTER TABLE "NoveltyType" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "NoveltyType" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- Novelty
ALTER TABLE "Novelty" ALTER COLUMN "approvedAt" TYPE TIMESTAMPTZ(3) USING "approvedAt" AT TIME ZONE 'UTC';
ALTER TABLE "Novelty" ALTER COLUMN "rejectedAt" TYPE TIMESTAMPTZ(3) USING "rejectedAt" AT TIME ZONE 'UTC';
ALTER TABLE "Novelty" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Novelty" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- TimeEntry
ALTER TABLE "TimeEntry" ALTER COLUMN "segmentStartAt" TYPE TIMESTAMPTZ(3) USING "segmentStartAt" AT TIME ZONE 'UTC';
ALTER TABLE "TimeEntry" ALTER COLUMN "segmentEndAt" TYPE TIMESTAMPTZ(3) USING "segmentEndAt" AT TIME ZONE 'UTC';
ALTER TABLE "TimeEntry" ALTER COLUMN "approvedAt" TYPE TIMESTAMPTZ(3) USING "approvedAt" AT TIME ZONE 'UTC';
ALTER TABLE "TimeEntry" ALTER COLUMN "rejectedAt" TYPE TIMESTAMPTZ(3) USING "rejectedAt" AT TIME ZONE 'UTC';
ALTER TABLE "TimeEntry" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "TimeEntry" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- WorkShift
ALTER TABLE "WorkShift" ALTER COLUMN "startAt" TYPE TIMESTAMPTZ(3) USING "startAt" AT TIME ZONE 'UTC';
ALTER TABLE "WorkShift" ALTER COLUMN "endAt" TYPE TIMESTAMPTZ(3) USING "endAt" AT TIME ZONE 'UTC';
ALTER TABLE "WorkShift" ALTER COLUMN "reviewedAt" TYPE TIMESTAMPTZ(3) USING "reviewedAt" AT TIME ZONE 'UTC';
ALTER TABLE "WorkShift" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "WorkShift" ALTER COLUMN "closedAt" TYPE TIMESTAMPTZ(3) USING "closedAt" AT TIME ZONE 'UTC';
ALTER TABLE "WorkShift" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- MonthlyTimeClosure
ALTER TABLE "MonthlyTimeClosure" ALTER COLUMN "submittedAt" TYPE TIMESTAMPTZ(3) USING "submittedAt" AT TIME ZONE 'UTC';
ALTER TABLE "MonthlyTimeClosure" ALTER COLUMN "reviewedAt" TYPE TIMESTAMPTZ(3) USING "reviewedAt" AT TIME ZONE 'UTC';
ALTER TABLE "MonthlyTimeClosure" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "MonthlyTimeClosure" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- TimeCorrectionRequest
ALTER TABLE "TimeCorrectionRequest" ALTER COLUMN "reviewedAt" TYPE TIMESTAMPTZ(3) USING "reviewedAt" AT TIME ZONE 'UTC';
ALTER TABLE "TimeCorrectionRequest" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- SystemNotification
ALTER TABLE "SystemNotification" ALTER COLUMN "readAt" TYPE TIMESTAMPTZ(3) USING "readAt" AT TIME ZONE 'UTC';
ALTER TABLE "SystemNotification" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- ShiftTemplate
ALTER TABLE "ShiftTemplate" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "ShiftTemplate" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- ShiftAssignment
ALTER TABLE "ShiftAssignment" ALTER COLUMN "assignedAt" TYPE TIMESTAMPTZ(3) USING "assignedAt" AT TIME ZONE 'UTC';
ALTER TABLE "ShiftAssignment" ALTER COLUMN "disabledAt" TYPE TIMESTAMPTZ(3) USING "disabledAt" AT TIME ZONE 'UTC';
ALTER TABLE "ShiftAssignment" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "ShiftAssignment" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- ShiftAlert
ALTER TABLE "ShiftAlert" ALTER COLUMN "scheduledAt" TYPE TIMESTAMPTZ(3) USING "scheduledAt" AT TIME ZONE 'UTC';
ALTER TABLE "ShiftAlert" ALTER COLUMN "actualAt" TYPE TIMESTAMPTZ(3) USING "actualAt" AT TIME ZONE 'UTC';
ALTER TABLE "ShiftAlert" ALTER COLUMN "resolvedAt" TYPE TIMESTAMPTZ(3) USING "resolvedAt" AT TIME ZONE 'UTC';
ALTER TABLE "ShiftAlert" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- AttendanceInactivityIncident
ALTER TABLE "AttendanceInactivityIncident" ALTER COLUMN "detectedAt" TYPE TIMESTAMPTZ(3) USING "detectedAt" AT TIME ZONE 'UTC';
ALTER TABLE "AttendanceInactivityIncident" ALTER COLUMN "notifiedAt" TYPE TIMESTAMPTZ(3) USING "notifiedAt" AT TIME ZONE 'UTC';
ALTER TABLE "AttendanceInactivityIncident" ALTER COLUMN "reviewedAt" TYPE TIMESTAMPTZ(3) USING "reviewedAt" AT TIME ZONE 'UTC';

-- DoubleHourRule
ALTER TABLE "DoubleHourRule" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "DoubleHourRule" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- AttendancePunch
ALTER TABLE "AttendancePunch" ALTER COLUMN "timestamp" TYPE TIMESTAMPTZ(3) USING "timestamp" AT TIME ZONE 'UTC';
ALTER TABLE "AttendancePunch" ALTER COLUMN "reviewedAt" TYPE TIMESTAMPTZ(3) USING "reviewedAt" AT TIME ZONE 'UTC';
ALTER TABLE "AttendancePunch" ALTER COLUMN "importedAt" TYPE TIMESTAMPTZ(3) USING "importedAt" AT TIME ZONE 'UTC';
ALTER TABLE "AttendancePunch" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- ClockPunchAttempt
ALTER TABLE "ClockPunchAttempt" ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3) USING "startedAt" AT TIME ZONE 'UTC';
ALTER TABLE "ClockPunchAttempt" ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(3) USING "completedAt" AT TIME ZONE 'UTC';
ALTER TABLE "ClockPunchAttempt" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- TimeSegment
ALTER TABLE "TimeSegment" ALTER COLUMN "fromDateTime" TYPE TIMESTAMPTZ(3) USING "fromDateTime" AT TIME ZONE 'UTC';
ALTER TABLE "TimeSegment" ALTER COLUMN "toDateTime" TYPE TIMESTAMPTZ(3) USING "toDateTime" AT TIME ZONE 'UTC';
ALTER TABLE "TimeSegment" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- DocumentCategory
ALTER TABLE "DocumentCategory" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "DocumentCategory" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- AuditParameter
ALTER TABLE "AuditParameter" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "AuditParameter" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- EmployeeDocument
ALTER TABLE "EmployeeDocument" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "EmployeeDocument" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- StorageFile
ALTER TABLE "StorageFile" ALTER COLUMN "uploadedAt" TYPE TIMESTAMPTZ(3) USING "uploadedAt" AT TIME ZONE 'UTC';
ALTER TABLE "StorageFile" ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(3) USING "deletedAt" AT TIME ZONE 'UTC';
ALTER TABLE "StorageFile" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "StorageFile" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- AuditLog
ALTER TABLE "AuditLog" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

