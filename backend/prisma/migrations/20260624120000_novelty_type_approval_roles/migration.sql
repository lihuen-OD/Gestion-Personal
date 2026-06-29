ALTER TABLE "NoveltyType"
  ADD COLUMN IF NOT EXISTS "allowedLoadRoles" JSONB NOT NULL DEFAULT '["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"]',
  ADD COLUMN IF NOT EXISTS "approvalRoles" JSONB NOT NULL DEFAULT '["Nivel 1 - RRHH"]';

UPDATE "NoveltyType"
SET "allowedLoadRoles" = '["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"]'
WHERE "allowedLoadRoles" = '[]'::jsonb;

UPDATE "NoveltyType"
SET "approvalRoles" = '["Nivel 1 - RRHH"]'
WHERE "approvalRoles" = '[]'::jsonb;
