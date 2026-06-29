CREATE TABLE "AuditParameter" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO',
  "description" TEXT NOT NULL,
  "trackCreate" BOOLEAN NOT NULL DEFAULT true,
  "trackUpdate" BOOLEAN NOT NULL DEFAULT true,
  "trackDeleteOrDeactivate" BOOLEAN NOT NULL DEFAULT false,
  "trackApproval" BOOLEAN NOT NULL DEFAULT false,
  "trackExport" BOOLEAN NOT NULL DEFAULT false,
  "requiresReason" BOOLEAN NOT NULL DEFAULT false,
  "requiresEffectiveDate" BOOLEAN NOT NULL DEFAULT false,
  "visibleToRoles" JSONB NOT NULL DEFAULT '[]',
  "notification" JSONB NOT NULL DEFAULT '{}',
  "retention" JSONB NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "history" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AuditParameter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditParameter_code_key" ON "AuditParameter"("code");
CREATE INDEX "AuditParameter_scope_idx" ON "AuditParameter"("scope");
CREATE INDEX "AuditParameter_severity_idx" ON "AuditParameter"("severity");
CREATE INDEX "AuditParameter_status_idx" ON "AuditParameter"("status");
