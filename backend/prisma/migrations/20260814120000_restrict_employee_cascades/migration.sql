-- Etapa 1 / Bloque 3 (2026-08-14): proteger el historial de un legajo contra
-- borrado en cascada.
--
-- Esta migracion NO borra ni modifica ninguna fila existente. Unicamente
-- endurece la accion ON DELETE de las foreign keys que apuntan a Employee,
-- pasandolas de CASCADE a RESTRICT. Hoy no existe ningun endpoint ni codigo
-- que ejecute `prisma.employee.delete()` (la baja de un legajo es siempre un
-- cambio de estado via LaborMovement, nunca un borrado fisico), asi que este
-- cambio no altera ningun comportamiento actual de la aplicacion.
--
-- Efecto: si en el futuro alguien intenta borrar un Employee (via Prisma
-- Studio, un script o un endpoint nuevo) mientras existan registros
-- relacionados (fichadas, horas, novedades, documentos, historial, etc.),
-- Postgres rechaza el borrado en vez de arrastrar todo ese historial.
--
-- Reversible: una migracion futura puede volver a poner ON DELETE CASCADE en
-- cualquiera de estas relaciones si hiciera falta.

ALTER TABLE "EmployeeCompany" DROP CONSTRAINT "EmployeeCompany_employeeId_fkey";
ALTER TABLE "EmployeeCompany" ADD CONSTRAINT "EmployeeCompany_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeAddress" DROP CONSTRAINT "EmployeeAddress_employeeId_fkey";
ALTER TABLE "EmployeeAddress" ADD CONSTRAINT "EmployeeAddress_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeTransport" DROP CONSTRAINT "EmployeeTransport_employeeId_fkey";
ALTER TABLE "EmployeeTransport" ADD CONSTRAINT "EmployeeTransport_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LaborMovement" DROP CONSTRAINT "LaborMovement_employeeId_fkey";
ALTER TABLE "LaborMovement" ADD CONSTRAINT "LaborMovement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeAssignment" DROP CONSTRAINT "EmployeeAssignment_employeeId_fkey";
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeHourConcept" DROP CONSTRAINT "EmployeeHourConcept_employeeId_fkey";
ALTER TABLE "EmployeeHourConcept" ADD CONSTRAINT "EmployeeHourConcept_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeFieldHistory" DROP CONSTRAINT "EmployeeFieldHistory_employeeId_fkey";
ALTER TABLE "EmployeeFieldHistory" ADD CONSTRAINT "EmployeeFieldHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeBlockHistory" DROP CONSTRAINT "EmployeeBlockHistory_employeeId_fkey";
ALTER TABLE "EmployeeBlockHistory" ADD CONSTRAINT "EmployeeBlockHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Novelty" DROP CONSTRAINT "Novelty_employeeId_fkey";
ALTER TABLE "Novelty" ADD CONSTRAINT "Novelty_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimeEntry" DROP CONSTRAINT "TimeEntry_employeeId_fkey";
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkShift" DROP CONSTRAINT "WorkShift_employeeId_fkey";
ALTER TABLE "WorkShift" ADD CONSTRAINT "WorkShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MonthlyTimeClosure" DROP CONSTRAINT "MonthlyTimeClosure_employeeId_fkey";
ALTER TABLE "MonthlyTimeClosure" ADD CONSTRAINT "MonthlyTimeClosure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimeCorrectionRequest" DROP CONSTRAINT "TimeCorrectionRequest_employeeId_fkey";
ALTER TABLE "TimeCorrectionRequest" ADD CONSTRAINT "TimeCorrectionRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShiftAssignment" DROP CONSTRAINT "ShiftAssignment_employeeId_fkey";
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShiftAlert" DROP CONSTRAINT "ShiftAlert_employeeId_fkey";
ALTER TABLE "ShiftAlert" ADD CONSTRAINT "ShiftAlert_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttendanceInactivityIncident" DROP CONSTRAINT "AttendanceInactivityIncident_employeeId_fkey";
ALTER TABLE "AttendanceInactivityIncident" ADD CONSTRAINT "AttendanceInactivityIncident_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DoubleHourRuleEmployee" DROP CONSTRAINT "DoubleHourRuleEmployee_employeeId_fkey";
ALTER TABLE "DoubleHourRuleEmployee" ADD CONSTRAINT "DoubleHourRuleEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttendancePunch" DROP CONSTRAINT "AttendancePunch_employeeId_fkey";
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClockPunchAttempt" DROP CONSTRAINT "ClockPunchAttempt_employeeId_fkey";
ALTER TABLE "ClockPunchAttempt" ADD CONSTRAINT "ClockPunchAttempt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TimeSegment" DROP CONSTRAINT "TimeSegment_employeeId_fkey";
ALTER TABLE "TimeSegment" ADD CONSTRAINT "TimeSegment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeDocument" DROP CONSTRAINT "EmployeeDocument_employeeId_fkey";
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
