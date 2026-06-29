-- CreateTable
CREATE TABLE "EmployeeTransport" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "usesCompanyTransport" BOOLEAN NOT NULL DEFAULT false,
    "locality" TEXT,
    "pickupAddress" TEXT,
    "pickupReference" TEXT,
    "busLine" TEXT,
    "schedule" TEXT,
    "observation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeTransport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeTransport_employeeId_key" ON "EmployeeTransport"("employeeId");

-- AddForeignKey
ALTER TABLE "EmployeeTransport"
ADD CONSTRAINT "EmployeeTransport_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
