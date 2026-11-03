# Rollback manual de `20261103180000_add_shift_alert_manual_hours_conflict`

Sólo si hay que volver atrás **después** de aplicarla. Prisma no genera "down"
migrations. Orden obligatorio:

1. Desplegar primero el backend/frontend anterior (sin
   `ACTIVIDAD_SOBRE_CARGA_MANUAL`). Con el código nuevo corriendo, el valor del
   enum sigue en uso.
2. Antes de borrar alertas, decidir cada conflicto pendiente: con el código
   anterior, las jornadas `OBSERVADO` retenidas por una carga manual no vuelven
   a computar solas (las horas manuales siguen computando). Listarlas con
   `SELECT "workShiftId" FROM "ShiftAlert" WHERE "type" = 'ACTIVIDAD_SOBRE_CARGA_MANUAL' AND "status" = 'PENDIENTE';`
3. Respaldo verificable (`pg_dump -Fc` + SHA-256) antes de escribir.
4. En una transacción:

```sql
BEGIN;

-- Alertas del tipo nuevo: son derivadas (la jornada, las fichadas, los tramos
-- y las horas quedan intactos). Sus notificaciones son texto libre y pueden
-- quedar. La decisión tomada sigue en AuditLog.
DELETE FROM "ShiftAlert" WHERE "type" = 'ACTIVIDAD_SOBRE_CARGA_MANUAL';

-- PostgreSQL no permite quitar un valor de un enum: se recrea el tipo.
ALTER TYPE "ShiftAlertType" RENAME TO "ShiftAlertType_old";
CREATE TYPE "ShiftAlertType" AS ENUM (
  'INGRESO_TARDE', 'SALIDA_ANTICIPADA', 'SALIDA_TARDIA', 'TURNO_NO_IDENTIFICADO',
  'SHIFT_NOT_ENABLED_FOR_EMPLOYEE', 'POSSIBLE_SHIFT_CONFIGURATION_MISSING',
  'JORNADA_INSUFICIENTE', 'JORNADA_EXTENDIDA', 'DESCANSO_INSUFICIENTE',
  'POSIBLE_OLVIDO_SALIDA', 'CONCEPTO_NO_HABILITADO', 'SEGMENTO_SIN_CLASIFICAR',
  'INGRESO_ANTICIPADO', 'JORNADA_FUERA_DE_TURNO', 'ACTIVIDAD_EN_FRANCO'
);
ALTER TABLE "ShiftAlert" ALTER COLUMN "type" TYPE "ShiftAlertType" USING ("type"::text::"ShiftAlertType");
DROP TYPE "ShiftAlertType_old";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261103180000_add_shift_alert_manual_hours_conflict';

COMMIT;
```

5. Verificar: `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel <schema anterior> --script` debe quedar vacío.
