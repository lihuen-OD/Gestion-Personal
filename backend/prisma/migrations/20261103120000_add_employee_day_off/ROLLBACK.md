# Rollback manual de `20261103120000_add_employee_day_off`

Sólo si hay que volver atrás **después** de aplicarla. Prisma no genera "down"
migrations. Orden obligatorio:

1. Desplegar primero el backend/frontend anterior (sin `EmployeeDayOff` ni
   `ACTIVIDAD_EN_FRANCO`). Con el código nuevo corriendo, la tabla y el valor
   del enum siguen en uso.
2. Respaldo verificable (`pg_dump -Fc` + SHA-256) antes de escribir.
3. En una transacción:

```sql
BEGIN;

-- Alertas del tipo nuevo: son derivadas (la jornada, las fichadas y las horas
-- quedan intactas). Sus notificaciones son texto libre y pueden quedar.
DELETE FROM "ShiftAlert" WHERE "type" = 'ACTIVIDAD_EN_FRANCO';

-- PostgreSQL no permite quitar un valor de un enum: se recrea el tipo.
ALTER TYPE "ShiftAlertType" RENAME TO "ShiftAlertType_old";
CREATE TYPE "ShiftAlertType" AS ENUM (
  'INGRESO_TARDE', 'SALIDA_ANTICIPADA', 'SALIDA_TARDIA', 'TURNO_NO_IDENTIFICADO',
  'SHIFT_NOT_ENABLED_FOR_EMPLOYEE', 'POSSIBLE_SHIFT_CONFIGURATION_MISSING',
  'JORNADA_INSUFICIENTE', 'JORNADA_EXTENDIDA', 'DESCANSO_INSUFICIENTE',
  'POSIBLE_OLVIDO_SALIDA', 'CONCEPTO_NO_HABILITADO', 'SEGMENTO_SIN_CLASIFICAR',
  'INGRESO_ANTICIPADO', 'JORNADA_FUERA_DE_TURNO'
);
ALTER TABLE "ShiftAlert" ALTER COLUMN "type" TYPE "ShiftAlertType" USING ("type"::text::"ShiftAlertType");
DROP TYPE "ShiftAlertType_old";

DROP TABLE "EmployeeDayOff";
DROP TYPE "EmployeeDayOffStatus";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261103120000_add_employee_day_off';

COMMIT;
```

4. Verificar: `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel <schema anterior> --script` debe quedar vacío.

Efectos que **no** se revierten (y no hace falta):

- Filas `TimeEntry` corregidas a mano después del deploy quedan con
  `source = 'ADMIN'` (`EMPLOYEE_DAY_OFF.md` §7.1). Sin francos no cambian
  ninguna cifra: nadie más lee ese campo con fines de negocio.
- Incidentes de inactividad resueltos automáticamente por un franco quedan
  `RESUELTA` con su nota.
- La auditoría (`AuditLog` con `entity = 'EmployeeDayOff'`) se conserva: es
  historia.
