# Etapa 8C — QA integral de Horas Especiales

Fecha: 2026-08-26
Estado: QA completo, correcciones puntuales implementadas, pendiente de aprobación para commitear
Continúa: `docs/decisions/HORAS_ESPECIALES_AUDITORIA_8A.md`, `docs/decisions/HORAS_ESPECIALES_8B.md`, `docs/decisions/HORAS_ESPECIALES_8F.md`

## 1. Resumen ejecutivo

QA de punta a punta del módulo Horas Especiales (motor de reglas, API, migración, frontend, integración con fichador/exportaciones/cierres/dashboard, permisos). Los docs de 8A/8B/8F ya afirmaban cobertura extensa — esta etapa tomó esas afirmaciones como hipótesis a verificar leyendo el código actual, no como hechos. Resultado: el diseño y la implementación de 8B/8F son sólidos. Se encontraron y corrigieron un bug de validación puntual, seis huecos de cobertura de test backend, y tres gaps menores de frontend (uno de UX, uno visual, uno de copy defensivo). No se encontró ninguna regresión en fichador, Conceptos Horarios, Turnos, dashboard ni cierres. No se cambió ninguna regla de negocio, no se tocó el schema de forma destructiva, no se commiteó nada.

## 2. Qué se revisó

**Backend:**
- Motor de matching puro (`doubleHourRuleMatching.ts`): `ruleMatchesDate`, `resolveWinningRules`, `scopesCouldOverlap` — leído completo.
- Los dos únicos puntos de escritura real (`timeEntries.repository.ts`: `createFromWorkShift`, `closeOpenWorkShift`, `doubleHourRuleScopeWhere`) — leídos completos, línea por línea.
- CRUD y calendario de reglas (`workforce.service.ts`, `workforce.schemas.ts`, `workforce.routes.ts`, `workforce.controller.ts`) — leídos completos.
- Exportación (`timeEntries.service.ts:exportByPerson`) — leída completa, columnas y cálculo verificados a mano.
- Cierres (`workforce.service.ts:submitClosures`) — verificado que es pass-through puro de `TimeEntry.hours`.
- Migración `20260826120000_special_hour_rules_scope_calendar_priority` — SQL leído completo (no sólo el doc).
- Schema (`schema.prisma`): modelos `DoubleHourRule`, `SpecialHourRuleDate`, `SpecialHourRuleApplication` y sus FKs.
- Permisos: `workforce.routes.ts` (roles por endpoint), `shared/security/roles.ts` (roles existentes en el sistema).
- Los 681 tests backend existentes (58 archivos) fueron ejecutados y mapeados manualmente contra los 20 casos de motor y 12 casos de API pedidos.

**Frontend** (vía agente de investigación, sin edición — sólo lectura de código y tests, sin navegador real disponible en el repo):
- `WorkScheduleSettingsPage.tsx` + `WorkScheduleSettingsPage.test.tsx` completos.
- `SpecialHourRulesCalendarMonth.tsx` completo.
- `workforceApiService.ts` (tipos/métodos usados por la pantalla).

**Integración/regresión** (mismo agente):
- Fichador (`TimeClockPage.tsx`, `timeClockApiService.ts`).
- Conceptos Horarios (`git log` sobre el módulo desde 2026-08-01, comparado contra el rango exacto de commits 8A/8B/8F).
- Turnos (referencias cruzadas en `workShiftEvaluation.service.ts`/`shiftAssignment.schemas.ts`).
- Dashboard (`dashboard.repository.ts:sumLoadedHours`, leído directo, no sólo el doc de 8F).
- Blast radius completo: `git diff --stat` sobre el rango de commits 8A→8F→8B (`20f77e5^..4b9f3b4`), archivo por archivo.

**Validaciones ejecutadas** (todas, backend y frontend): `prisma validate`, `prisma generate`, `prisma migrate status`, `npm run typecheck` (backend), `npx tsc -b` (frontend), `npx vitest run` (ambos), `npm run build` (ambos), `git status`, `git diff --check`, `git diff --stat`.

## 3. Qué bugs se encontraron

1. **[Backend, real, corregido]** `updateDoubleRuleSchema` (`workforce.schemas.ts`) no exigía `dates` al cambiar `recurrenceType` a `FECHA` vía `PATCH` — sólo `doubleRuleSchema` (creación) tenía ese `superRefine`. Un `PATCH` directo a la API que cambiara el tipo a `FECHA` sin mandar fechas dejaba la regla activa pero sin ninguna fecha que pudiera matchear jamás (`ruleMatchesDate` siempre `false` para esa regla). El frontend nunca dispara este caso (siempre manda `dates` junto con `recurrenceType=FECHA`, con guardia propia en el cliente) — el hueco sólo era explotable por un caller directo de la API.
2. **[Backend, cobertura, corregido]** Seis casos del checklist de 20 no tenían test explícito: regla sólo por centro de costo, regla sólo por puesto, combinación real de empleados-específicos + empresa + sector en el mismo `AND`, filtro `status: "ACTIVO"` asertado explícitamente, una regla `FECHA` (feriado) cruzando medianoche hacia un día normal, y la rama "inactivar en vez de borrar" de `removeDoubleRule` específica para `DoubleHourRule` (existía para `ShiftTemplate`, no para reglas de horas especiales).
3. **[Frontend, UX, corregido]** Los 3 botones de acción de cada fila de la tabla (Editar/Activar-Inactivar/Eliminar) no se deshabilitaban durante una mutación en curso — sólo el botón de guardar del formulario lo hacía, pese a que el estado `working` ya existía y ya era compartido por las 3 acciones. Permitía disparar mutaciones superpuestas sobre la misma regla haciendo doble clic. Patrón preexistente en toda la app (confirmado idéntico en `HourConceptsPage.tsx`, fuera de alcance tocar) — acá se corrigió sólo en esta pantalla.
4. **[Frontend, visual, corregido]** El calendario mensual podía recortarse sin scroll en viewports muy angostos (~320-360px): `.schedule-settings-section .panel-body{overflow-x:hidden}` (agregado en un commit anterior para evitar que la tabla ancha generara scroll horizontal de página) recortaba silenciosamente la grilla del calendario de 7 columnas cuando no entraba en el ancho disponible, sin ninguna forma de verla completa. La regla está scopeada únicamente a esta pantalla (3 usos, los 3 en `WorkScheduleSettingsPage.tsx`), así que el fix no tiene impacto en el resto de la app.
5. **[Frontend, copy defensivo, corregido]** El mapa `fieldLabels` de `apiClient.ts` (usado para traducir nombres de campo en errores de validación del backend) no tenía entradas para `recurrenceType`, `weekdays`, `multiplier`, `companyId`, `dates`, `employeeIds` — si alguna vez un error de Zod del backend llegara con uno de esos nombres (el frontend ya bloquea todos esos casos antes de enviar, así que es infrecuente en uso normal), se mostraría el nombre técnico en inglés en vez de una etiqueta en español. Cambio puramente aditivo a un mapa compartido, sin riesgo para otros módulos.

Ningún otro hallazgo llegó al nivel de bug — RBAC, forma del payload, contención de errores dentro de la card, y estados de loading/empty/refresh quedaron todos verificados como correctos y con test.

## 4. Qué bugs se corrigieron

Los 5 de la sección anterior. Ver diffs en `backend/src/modules/workforce-management/workforce.schemas.ts`, `frontend/src/pages/WorkScheduleSettingsPage.tsx`, `frontend/src/styles.css`, `frontend/src/services/api/apiClient.ts`.

## 5. Qué quedó sin tocar (a propósito)

- El patrón de botones de tabla sin `disabled` durante guardado en otras pantallas (ej. `HourConceptsPage.tsx`) — es preexistente y compartido por toda la app; corregirlo ahí es un cambio de alcance mayor al de esta etapa ("no rediseñar toda la app").
- La ruta `/configuracion/turnos-horas-especiales` (`App.tsx`) no está envuelta en el helper compartido `<RoleRoute>` como sí lo están `/legajos`/`/documentacion` — es una inconsistencia menor de implementación, no un hueco de seguridad real: la propia página ya redirige si `roleLevel(user.role) !== 1`, y el ítem de navegación a "Configuración" sólo existe en el menú del rol Nivel 1. Se deja documentado como riesgo pendiente de bajo impacto, no corregido, para no tocar el sistema de ruteo compartido en una etapa de QA puntual.
- Conceptos Horarios: no se tocó ningún archivo del módulo, sólo se verificó (vía `git log`) que ningún commit 8A/8B/8F lo modificó.
- Fichador: no se tocó nada — se confirmó que sigue sin ningún selector de "domingo"/"feriado"/"hora especial".
- Reglas de negocio: ninguna cambió. No se implementó acumulación de multiplicadores ni resolución manual de conflictos (ambos explícitamente fuera de alcance).
- Schema: no hubo ningún cambio destructivo ni nueva migración en esta etapa — sólo se leyó y verificó la migración 8B existente.
- No se ejecutó QA visual con navegador real: no hay Playwright ni ninguna herramienta de automatización de navegador disponible en este entorno, y `backend/.env` apunta a la base Neon compartida de staging (mismo motivo documentado en 8B/8F para no ejecutar contra esa base). La verificación de UI se hizo 100% por lectura de código fuente y de los tests existentes (incluyendo los que ya renderizan la pantalla completa con Testing Library/jsdom).

## 6. Confirmación de reglas críticas

- **Horas reales no infladas**: confirmado leyendo `createFromWorkShift`/`closeOpenWorkShift` — `hours`/`totalMinutes`/`actualMinutes` se calculan siempre desde minutos reales del segmento, nunca multiplicados; `appliedMultiplier` es el único campo que cambia. Casos I, K, Q, R, Y (nuevo) lo verifican con test.
- **Reglas generales sin empleados obligatorios**: confirmado — `employeeIds` es opcional en el schema (`.default([])`), y `doubleHourRuleScopeWhere` matchea "sin empleados cargados O este empleado está en la lista". Casos L, O.
- **Feriados con múltiples fechas**: confirmado — una sola regla `FECHA` con N filas en `SpecialHourRuleDate`, cada una togglable. Caso S (7 fechas), Caso T (fecha inactiva no matchea).
- **Prioridad**: confirmado — `resolveWinningRules` hace ganar a la de mayor `priority`. Caso Q.
- **Conflicto por empate**: confirmado — empate en la prioridad máxima marca `isWinner=true`/`wasConflicting=true` en todas las empatadas, sin romper el pipeline. Caso R.
- **Alcance AND**: confirmado — `doubleHourRuleScopeWhere` arma un array `AND` de 5 condiciones independientes (empleados, empresa, sector, centro de costo, puesto), cada una "sin restricción O coincide". Casos L, L.2, M, N, U, V (nuevos), W (nuevo, combinación real de las 3 dimensiones a la vez).
- **Calendario actualizado**: confirmado — `refreshToken` conecta las 3 mutaciones (crear/editar, activar/inactivar, eliminar) del listado con un refetch silencioso del calendario visible, sin skeleton de carga completo en el refresh. Verificado por 6 tests existentes de la etapa 8B.

## 7. Tests agregados/modificados

**Backend** (+13 tests, 668 → 681, todos verdes):
- Nuevo `workforce.schemas.test.ts` (7 tests): `doubleRuleSchema` (general sin empleados, FECHA sin fechas falla, FECHA con fechas pasa) y `updateDoubleRuleSchema` (payload vacío falla, cambiar sólo `priority` pasa, cambiar a FECHA sin fechas ahora falla — cierra el bug #1, cambiar a FECHA con fechas pasa).
- `timeEntries.repository.test.ts` — 5 casos nuevos: Caso U (centro de costo), Caso V (puesto), Caso W (empleados + empresa + sector combinados en el mismo `AND`), Caso X (filtro `status: "ACTIVO"` asertado), Caso Y (regla FECHA cruzando medianoche hacia un día normal, sólo el tramo del feriado recibe la regla).
- `workforce.service.test.ts` — 1 caso nuevo: `removeDoubleRule` inactiva (no borra) una regla cuya vigencia ya comenzó, específicamente para `DoubleHourRule`.

**Frontend** (+1 test, 330 → 331, todos verdes):
- `WorkScheduleSettingsPage.test.tsx` — nuevo describe "Etapa 8C": los 3 botones de acción de una fila quedan deshabilitados mientras una mutación está en curso y se rehabilitan al terminar (cierra el bug #3).

## 8. Validación manual o Playwright realizada

No se ejecutó contra un navegador real ni contra la base compartida — mismo motivo que 8B/8F (sin Playwright configurado en el repo, `backend/.env` apunta a Neon staging real). La verificación de frontend se hizo por lectura completa del código fuente (JSX, CSS, aria-labels, manejo de errores) contra el checklist pedido, más los 331 tests de Testing Library/jsdom existentes que ya renderizan la pantalla completa (incluye interacción real de usuario simulada con `@testing-library/user-event`, no shallow rendering).

## 9. Resultado de validaciones

Todas verdes, backend y frontend, corridas después de aplicar las correcciones:

| Validación | Resultado |
| --- | --- |
| `npx prisma validate` | ✅ schema válido |
| `npx prisma generate` | ✅ |
| `npx prisma migrate status` | ✅ "Database schema is up to date!" (45 migraciones) |
| `npm run typecheck` (backend) | ✅ sin errores |
| `npx vitest run` (backend) | ✅ 681/681 tests, 58 archivos |
| `npm run build` (backend) | ✅ |
| `npx tsc -b` (frontend) | ✅ sin errores |
| `npx vitest run` (frontend) | ✅ 331/331 tests, 43 archivos |
| `npm run build` (frontend) | ✅ |
| `git diff --check` | ✅ sin errores de espacios en blanco |

## 10. Riesgos pendientes

- Inconsistencia menor de implementación en el ruteo de `/configuracion/turnos-horas-especiales` (no usa el helper `<RoleRoute>` compartido, aunque el resultado de seguridad es equivalente) — ver §5.
- Los riesgos ya documentados en 8B §16 siguen vigentes sin cambios: no hay bandeja de resolución de conflictos, no hay política `ACUMULAR` configurable, no hay integración con Conceptos Horarios, el heurístico de superposición del calendario sigue siendo advisorio (puede marcar "posible superposición" en casos donde para un empleado concreto sólo una regla termina aplicando).
- El patrón de botones de tabla sin deshabilitar durante guardado sigue existiendo en el resto de la app (ver §5) — riesgo de UX menor y preexistente, no introducido ni corregido de forma global en esta etapa.
- No se validó con navegador real (ver §8) — la cobertura de tests automatizados + lectura de código es sólida, pero no reemplaza una corrida end-to-end visual si se quiere el nivel de confianza más alto antes de aprobar.

## 11. git status

Ver output de `git status` al cierre de esta etapa — 7 archivos modificados, 1 nuevo, ningún archivo eliminado, working tree limpio de cualquier otra cosa. No se hizo ningún commit.

## 12. git diff --stat

7 files changed, 179 insertions(+), 5 deletions(-) — desglose por archivo en el mensaje de cierre de esta etapa.

## 13. Commit

No se commiteó nada en esta etapa, tal como se pidió explícitamente. Todos los cambios quedan en el working tree para revisión y aprobación.
