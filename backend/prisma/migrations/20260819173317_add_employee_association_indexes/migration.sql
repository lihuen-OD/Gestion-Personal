-- CreateIndex
CREATE INDEX "EmployeeHourConcept_hourConceptId_idx" ON "EmployeeHourConcept"("hourConceptId");

-- CreateIndex
CREATE INDEX "EmployeeWorkRegime_workRegimeId_effectiveFrom_idx" ON "EmployeeWorkRegime"("workRegimeId", "effectiveFrom");
