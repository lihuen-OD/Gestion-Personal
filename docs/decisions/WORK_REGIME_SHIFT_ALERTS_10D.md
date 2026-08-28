# Etapa 10D — Contrato Turno/Régimen para alertas y jornada extendida

Fecha: 2026-08-28
Estado: implementada, validada, pendiente de aprobación para commitear
Alcance: cierra la brecha central detectada en 10A/10C — el régimen laboral no podía ajustar el umbral de `JORNADA_EXTENDIDA`

## 1. Resumen ejecutivo

`evaluateWorkedDuration` decidía `JORNADA_EXTENDIDA` comparando `totalMinutes` reales contra `ShiftTemplate.maximumInformativeMinutes` (o `600` min por defecto sin turno), sin consultar nunca al régimen laboral. Se agregó `WorkRegime.extendedShiftAlertMinutes` (Int, nullable, sin default) que, cuando está seteado, gana por sobre el umbral del turno — nunca lo reemplaza como fuente de horario, sólo ajusta cuándo alertar por duración. Prioridad implementada: **Régimen → Turno → Default (600 min)**. Migración aditiva de una columna, sin backfill, sin riesgo de datos. Todo régimen existente queda con el campo en `null` y comportamiento idéntico al de antes de esta etapa.

## 2. Contrato Turno vs. Régimen

| Caso | Qué manda | Umbral de jornada extendida | Alertas de turno |
|---|---|---|---|
| Turno, sin régimen | Turno define horario y tolerancias | `ShiftTemplate.maximumInformativeMinutes` (o ninguna si `null`) | Estándar, sin supresión |
| Turno + régimen | Turno sigue definiendo horario — el régimen nunca lo reemplaza | Si el régimen define un umbral: **gana el régimen**. Si no: el del turno | Régimen decide si se suprimen (sin cambios, ya implementado en 10A) |
| Sin turno, con régimen | Régimen define el comportamiento general | Umbral del régimen si está seteado; si no, default 600 | Se suprimen si `alertOnOutOfShift=false` (sin cambios) |
| Sin turno, sin régimen | Comportamiento mínimo seguro actual | Default fijo, 600 min | Normales (conservador) |

El régimen sigue sin ser obligatorio para nadie.

## 3. Prioridad del umbral

```
umbral = régimen?.extendedShiftAlertMinutes ?? turno?.maximumInformativeMinutes ?? 600
```

Implementada en `evaluateWorkedDuration` (`backend/src/modules/shifts/workShiftEvaluation.service.ts`), con `regimeMaximumMinutes` como nuevo parámetro opcional que gana incondicionalmente cuando está presente — mismo criterio ya usado por `alertOnOutOfShift`/`openShiftOverflowAction` (nunca se combinan con el turno, sólo anulan el default).

## 4. Decisión de modelo

- **Campo**: `WorkRegime.extendedShiftAlertMinutes Int?` — sin `@default`, sin backfill.
- **Rango backend**: `.int().min(0).max(1440)` (Zod, `workRegimes.schemas.ts`).
- **Rango UI**: 0 a 24 horas enteras.
- **Unidad**: minutos en backend/DB (consistencia con `ShiftTemplate.maximumInformativeMinutes`, comparación directa contra `totalMinutes` sin conversión en la lógica de negocio); **horas enteras en la UI** (más natural para RRHH), con la conversión (`×60`/`÷60`) resuelta en `frontend/src/services/api/workRegimeApiService.ts` (`extendedShiftAlertHoursToMinutes`/`extendedShiftAlertMinutesToHours`), no en el componente de página.
- **`null`** = el régimen no opina, comportamiento idéntico al actual.

## 5. Migración aplicada

`backend/prisma/migrations/20260828111324_add_work_regime_extended_shift_alert_minutes/migration.sql`:
```sql
ALTER TABLE "WorkRegime" ADD COLUMN     "extendedShiftAlertMinutes" INTEGER;
```

**Nota sobre cómo se aplicó**: `npx prisma migrate dev` falló con `P3006` al intentar validar contra una shadow database vacía — no por esta migración, sino por una **preexistente e independiente**: `20260824170000_normalize_hour_concepts` asume datos de seed (`HC-NORMAL`) que sólo existen en la base real (poblados por `prisma/seed.ts`, no por ninguna migración), así que una shadow DB vacía siempre va a fallar esa migración vieja al reproducir el historial completo desde cero. No se tocó esa migración (fuera de alcance, riesgo de romper el checksum de una migración ya aplicada). En su lugar, se escribió el archivo de migración manualmente (mismo SQL que `migrate dev` habría generado) y se aplicó con `npx prisma migrate deploy` — que aplica sólo migraciones pendientes contra la base real ya migrada/seedeada, sin usar shadow database. Confirmado con `prisma validate`/`migrate status` después: 46 migraciones, schema al día.

## 6. Compatibilidad hacia atrás

- Campo opcional en Zod (`.optional().nullable()`) — omitirlo en un POST/PATCH existente sigue funcionando igual que antes.
- Todo régimen existente quedó en `null` tras la migración (sin backfill) — comportamiento idéntico al de antes de esta etapa, verificado con tests dedicados (§9).
- El frontend anterior (si no supiera de este campo) seguiría funcionando: el backend no lo exige.

## 7. Qué se tocó

**Backend**: `schema.prisma` (campo nuevo), `workRegimes.schemas.ts` (validación Zod), `workRegimes.service.ts` (`ActiveWorkRegime` + `resolveActiveWorkRegime`), `workShiftEvaluation.service.ts` (`evaluateWorkedDuration`), `workShiftEvaluationRunner.ts` (`evaluateShiftExit` resuelve régimen y pasa el umbral).

**Frontend**: `workRegime.types.ts` (`WorkRegime.extendedShiftAlertMinutes`), `workRegimeApiService.ts` (`ApiWorkRegime`, `mapWorkRegimeFromApi`, `mapToApi`, tipo `WorkRegimeInput` compartido para `create`/`update`, helpers de conversión horas↔minutos), `WorkRegimesPage.tsx` (campo nuevo en el modal de creación/edición, con label y helper aprobados), `EmployeeWorkRegimePanel.tsx` (línea de lectura adicional en el bloque "Régimen vigente", sólo si el valor está configurado).

**Corrección de accesibilidad encontrada durante los tests**: el helper text se agregó inicialmente *dentro* del mismo `<label>` que el input — eso hace que el nombre accesible del campo (lo que anunciaría un lector de pantalla, y lo que usan los tests de Testing Library para ubicar el campo) incluya todo el párrafo de ayuda concatenado, no sólo "Alerta de jornada extendida". Se corrigió moviendo el `<small>` fuera del `<label>`, como hermano dentro del mismo `.form-stack` — visualmente igual, nombre accesible correcto.

## 8. Qué NO se tocó

Cálculo de horas reales del fichador; `POSIBLE_OLVIDO_SALIDA`/`evaluateOpenShiftRisk` (el parámetro nuevo es exclusivo de `evaluateWorkedDuration`); Conceptos Horarios/Horas Especiales (ningún archivo de `hour-concepts`/`workforce-management` tocado — se corrió su suite de tests como parte de la corrida completa, sin regresiones); significado de `alertOnOutOfShift`/`openShiftOverflowAction`; `kind`; el listado de `WorkRegimesPage.tsx` (el campo no aparece como columna, sólo en el modal y en la lectura del legajo); permisos.

## 9. Tests agregados

**Backend** (+37 tests, total 781):
- `workShiftEvaluation.service.test.ts` (+7): sin régimen mantiene comportamiento actual; régimen `null` mantiene comportamiento actual; régimen con umbral mayor evita alerta prematura; régimen con umbral menor genera alerta antes; sin turno + régimen usa el umbral del régimen; sin turno ni régimen usa el default 600; el umbral de régimen nunca afecta `insufficientHours`.
- `workShiftEvaluationRunner.test.ts` (+5, nuevo describe "Etapa 10D"): turno nocturno + régimen con umbral mayor evita la alerta (cruce de medianoche respetado); turno nocturno + régimen con umbral menor genera la alerta antes de lo que el turno solo hubiera generado; régimen sin el campo (`null`) no altera el umbral del turno; `JORNADA_EXTENDIDA` nunca modifica horas reales (`workShift.update` no se llama); `POSIBLE_OLVIDO_SALIDA` sigue completamente separado del nuevo umbral.
- `workRegimes.service.test.ts` (+2): `resolveActiveWorkRegime` devuelve `extendedShiftAlertMinutes` correctamente (valor real y `null`).
- `workRegimes.schemas.test.ts` (+12, archivo nuevo): acepta ausente/`null`/rango válido/`0` explícito/máximo permitido; rechaza negativo, fuera de rango, no entero; coerciona string numérico; `updateWorkRegimeSchema` permite actualización parcial y volver a `null`.

**Frontend** (+18 tests, total 399):
- `workRegimeApiService.test.ts` (+8): preserva/normaliza `extendedShiftAlertMinutes` desde la API; conversión horas↔minutos (redondeo, `null`↔vacío, `0` explícito, round-trip).
- `WorkRegimesPage.test.tsx` (+5, archivo nuevo — no existía cobertura de componente para esta página): campo visible con label/helper claros sin lenguaje técnico; guardar vacío envía `null`; guardar con horas cargadas convierte a minutos; editar precarga el valor en horas; editar sin tocar el campo conserva el valor (no lo resetea).
- `WorkRegimesPage.filters.test.ts` / `EmployeeWorkRegimePanel.test.ts` (fixtures actualizados, +0 tests nuevos — se agregó el campo requerido a los fixtures existentes para que seguir compilando).

## 10. Validaciones ejecutadas

Backend: `npx prisma validate` ✅, `npx prisma generate` ✅, `npx prisma migrate status` ✅ (46 migraciones, al día), `npm run typecheck` ✅, `npx vitest run` ✅ 781/781, `npm run build` ✅.
Frontend: `npx tsc -b` ✅, `npx vitest run` ✅ 399/399, `npm run build` ✅.
General: `git diff --check` sin errores de espacios en blanco.

## 11. Riesgos

- Doble consulta a régimen por jornada (`evaluateShiftEntry` ya lo hacía; `evaluateShiftExit` ahora también) — costo de performance despreciable, aceptado explícitamente en el plan aprobado.
- La conversión horas↔minutos en el frontend es un patrón nuevo en el proyecto (no existía en ningún otro campo) — mitigado con 8 tests dedicados a la conversión, incluyendo el caso round-trip.
- El campo no aparece en el listado de `WorkRegimesPage.tsx` (sólo en el modal y en el legajo) — decisión deliberada del plan aprobado para no saturar la tabla; si en el futuro se vuelve un dato de consulta frecuente, agregarlo como columna es un cambio acotado.
- Migración aplicada vía `migrate deploy` en vez de `migrate dev` por la incompatibilidad preexistente ya documentada (§5) — no introduce riesgo nuevo, pero cualquier futura migración en este proyecto va a tropezar con la misma limitación de shadow database mientras no se resuelva (fuera de alcance de esta etapa).
