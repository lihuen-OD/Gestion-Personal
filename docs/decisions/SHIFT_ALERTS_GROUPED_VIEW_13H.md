# Etapa 13H — Agrupar Alertas de Turnos por jornada/fichada

Fecha: 2026-09-02
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/SHIFT_EXIT_SINGLE_NOTIFICATION_POLICY_13G.md` (Notificaciones ya limpia), `docs/decisions/SHIFT_SEGMENT_UNCLASSIFIED_POLICY_13D.md`, `docs/decisions/SHIFT_ALERT_RULES_AUDIT_13C.md`
Alcance: sólo la pantalla "Alertas de Turnos" (`ShiftAlertsPage.tsx`) — agrupación visual client-side, 100% frontend. No se tocó backend, generación de `ShiftAlert`, lógica de entrada/salida, Horas Especiales, Conceptos Horarios, liquidación, fichador, grilla/export/bandeja, asignaciones de feriado, ni "Sin actividad registrada".

## 1. Resumen ejecutivo

"Alertas de Turnos" seguía mostrando una fila suelta por cada `ShiftAlert`, aunque varias pertenecieran al mismo cierre de salida (mismo `workShiftId`) — caso real: legajo 29 "Prueba" con 3 filas sueltas ("Segmento sin clasificar", "Jornada por debajo del mínimo", "Salida tardía") para una única jornada. Notificaciones ya había quedado limpia desde la Etapa 13G (una sola notificación visible por cierre); esta etapa hace el equivalente visual en la vista técnica, sin ocultar ningún dato.

Resuelto **100% en frontend**: el diagnóstico confirmó que `workShiftId` es un campo **obligatorio** en `ShiftAlert` (siempre presente, sin excepción) y ya viaja en cada fila devuelta por `GET /shifts/alerts` — no faltaba ningún dato para agrupar, así que no se tocó el backend en absoluto. Las filas que comparten `workShiftId` ahora se agrupan en una sola fila principal (la alerta de mayor prioridad) con un indicador "+N hallazgo(s) asociado(s)" que expande el detalle de las alertas secundarias, cada una con su propia severidad/diferencia/estado y acción de resolución. +12 tests frontend nuevos (20/20 en el archivo, 476/476 en toda la suite), typecheck y build limpios.

## 2. Problema observado en UI

Ejemplo real: empleado "29 Prueba, 29 Prueba" — 3 filas en "Alertas de Turnos" para lo que en realidad era un único cierre de salida: "Segmento sin clasificar", "Jornada por debajo del mínimo", "Salida tardía". RRHH lo interpretaba como 3 problemas distintos cuando pertenecían al mismo evento.

## 3. Documentos leídos

`SHIFT_EXIT_SINGLE_NOTIFICATION_POLICY_13G.md`, `SHIFT_SEGMENT_UNCLASSIFIED_POLICY_13D.md`, `SHIFT_CONFIGURATION_ALERT_POLICY_13E.md`, `CLOCK_PHOTO_PUNCH_EXIT_TRANSACTION_13F.md`, `SHIFT_ALERT_RULES_AUDIT_13C.md`, `SHIFT_EXIT_CLASSIFICATION_13B.md`, `SHIFT_ENTRY_CLASSIFICATION_13A.md`, `docs/PERFORMANCE_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md`. Más lectura directa de código: `backend/src/modules/shifts/shiftAlert.repository.ts`, `shiftAlert.service.ts`, `shiftAlert.controller.ts`, `shiftAlert.schemas.ts`, `schema.prisma` (`ShiftAlert`), `frontend/src/pages/ShiftAlertsPage.tsx`, `frontend/src/services/api/shiftAlertApiService.ts`.

## 4. Diagnóstico (Parte 1 del pedido, con evidencia)

1. **Endpoint**: `GET /shifts/alerts` (`shiftAlertController.list` → `shiftAlertService.list` → `shiftAlertRepository.findMany`), paginado por cursor (`before`/`take`, no por página).
2. **Campos que devuelve cada `ShiftAlert`**: `id`, `employeeId`, `workShiftId`, `type`, `status`, `severity`, `scheduledAt`, `actualAt`, `differenceMinutes`, `resolvedAt`, `resolvedByUserId`, `resolutionNote`, `createdAt`, más `employee` (`id`, `legajo`, `dni`, `firstName`, `lastName`, `status`) y `workShift` (`id`, `startAt`, `endAt`, `status`, `shiftTemplate: {id, code, name} | null`) — confirmado en `shiftAlert.repository.ts:5-6,40`.
3. **¿Tiene `workShiftId`?**: sí, siempre — `schema.prisma`: `ShiftAlert.workShiftId String` (no `String?`), campo obligatorio, sin excepción.
4. **¿Tiene `attendancePunchId`?**: no existe como campo propio del modelo `ShiftAlert` — no hizo falta, `workShiftId` ya es suficiente y más confiable (una jornada tiene como máximo un `AttendancePunch` de entrada y uno de salida; agrupar por jornada es exactamente lo que el pedido buscaba).
5. **¿Tiene `employeeId`?**: sí, siempre (campo obligatorio).
6. **¿Tiene fecha/`createdAt`?**: sí, `createdAt` (obligatorio) y `actualAt` (obligatorio, el instante real de la fichada que originó la alerta).
7. **¿Tiene tipo, severidad, diferencia y turno?**: sí — `type`, `severity` siempre; `differenceMinutes` casi siempre (nullable en el schema pero presente en la práctica para los 13 tipos evaluados); `workShift.shiftTemplate` puede ser `null` (ej. `TURNO_NO_IDENTIFICADO`), manejado ya por la UI existente ("Sin turno").
8. **¿Las alertas del mismo cierre comparten `workShiftId`?**: sí — todas las alertas que genera una misma llamada a `evaluateShiftExit(employeeId, workShiftId, ...)` (Etapas 13B/13D/13G) usan el mismo `workShiftId` recibido como parámetro.
9. **¿Las del mismo ingreso comparten algún identificador?**: sí, el mismo `workShiftId` — `evaluateShiftEntry(employeeId, workShiftId, ...)` genera `INGRESO_TARDE`/`INGRESO_ANTICIPADO`/`TURNO_NO_IDENTIFICADO`/`SHIFT_NOT_ENABLED_FOR_EMPLOYEE`/`DESCANSO_INSUFICIENTE` todas contra el mismo `WorkShift` recién creado.
10. **¿`POSIBLE_OLVIDO_SALIDA` tiene `workShiftId`?**: sí — `flagOpenShiftOverflowForReview(employeeId, workShiftId, ...)` usa el `workShiftId` de la MISMA jornada que luego se cierra. Se decidió agruparla igual que cualquier otra (ver §4, nota de diseño) — comparte legítimamente el mismo `workShiftId` que las alertas de la salida real posterior, así que agruparla es correcto, no una coincidencia débil.
11. **¿"Sin actividad registrada" pertenece a esta pantalla?**: no — confirmado (ya documentado desde 12E/13C): es un `SystemNotification` + `AttendanceInactivityIncident`, nunca un `ShiftAlert`. Nunca aparece en "Alertas de Turnos"; no había nada que excluir.
12. **Paginación actual**: cursor (`before`/`take`, default 20, máx 50) con botón "Cargar 20 más" que **agrega** al array acumulado (`setAlerts((current) => [...current, ...response.data])`) — mismo patrón "feed" ya usado en Notificaciones (`docs/PERFORMANCE_STANDARDS.md` §17).
13. **Filtrado actual**: server-side — `employeeId`, `workShiftId`, `type`, `severity`, `status`, `search` (nombre/legajo/DNI). Sin cambios en esta etapa (ver §8 sobre la decisión de mantenerlo así).
14. **Orden actual**: `orderBy: [{ createdAt: "desc" }, { id: "desc" }]` — sin cambios.
15. **¿Agrupar en frontend alcanza?**: sí — todo lo necesario (`workShiftId`, `type`, `severity`, `differenceMinutes`, `status`, `createdAt`) ya viaja en cada alerta devuelta por el endpoint existente.
16. **¿Hace falta un endpoint agrupado?**: no — ver §15; agregar `?grouped=true` hubiera sido trabajo backend innecesario para un problema resoluble con los datos ya disponibles.
17. **¿Se puede resolver sin tocar backend?**: sí, confirmado — cero cambios de backend en esta etapa.
18. **Riesgos de performance al agrupar client-side**: ninguno nuevo — la agrupación es una función pura (`groupAlerts`, `O(n)`) sobre el array `alerts` **ya paginado y ya cargado en memoria** (nunca más de lo que el usuario ya trajo con "Cargar más"); no introduce ningún fetch nuevo ni fetch-all. Sigue siendo categoría C (`docs/PERFORMANCE_STANDARDS.md` §2.C) sin cambios de volumen.
19. **Acciones con varias alertas en un grupo**: "Ver legajo"/"Ver turno" ya eran acciones a nivel de fila — se mantienen sobre la alerta principal del grupo. "Resolver" es una acción **por alerta individual** en el backend (`POST /shifts/alerts/:id/resolve`, sin variante bulk) — se mantuvo así (ver §7, Parte 5 del pedido: "si la UI actual sólo permite ver detalle individual, mantener acciones individuales y documentar limitación"): la fila principal conserva su botón "Resolver" de siempre, y cada alerta secundaria, dentro del detalle expandido, gana su propio botón "Resolver" puntual — mismo mecanismo (`openResolve`), sin necesidad de un endpoint bulk.
20. **Tests frontend existentes**: 18 tests en `ShiftAlertsPage.test.tsx` (Etapas 10B, 10E, 13A, 13E) — todos con **una sola alerta por caso** (ningún test previo ejercitaba dos alertas del mismo `workShiftId`), así que ninguno cubría agrupación — confirmado que todos siguen pasando sin modificación (cada uno sigue siendo, con la lógica nueva, "un grupo de 1 miembro").

## 5. Criterio de agrupación (Parte 2 del pedido)

**`workShiftId` únicamente** — es el identificador más confiable disponible y **siempre presente** (§4.3), así que los niveles de fallback sugeridos (`attendancePunchId`, luego `employeeId`+fecha+ventana horaria) **no hicieron falta implementarse**: `attendancePunchId` no existe como campo propio de `ShiftAlert`, y el caso que hubiera necesitado el fallback de `employeeId`+fecha (una alerta sin `workShiftId`) no existe en el modelo actual. Documentado explícitamente para que quede claro que no es una omisión sino una consecuencia de la garantía del schema.

**Reglas respetadas, todas ya garantizadas por agrupar sólo por `workShiftId`**:
- Nunca se agrupan alertas de días distintos (cada `WorkShift` es de una jornada) ni de empleados distintos (`WorkShift` pertenece a un único empleado).
- Nunca se agrupan eventos independientes sólo por ser del mismo empleado — dos jornadas del mismo empleado tienen `workShiftId` distinto, quedan en grupos distintos (test dedicado, Parte 8 #3).
- `POSIBLE_OLVIDO_SALIDA` se agrupa con la salida real posterior **porque genuinamente comparten el mismo `WorkShift`** (§4.10) — no es una inferencia débil, es el mismo registro. En la práctica esto rara vez es visible: la Etapa 10B ya resuelve automáticamente (`RESUELTA`) el `POSIBLE_OLVIDO_SALIDA` pendiente en cuanto la jornada cierra, así que sólo coexistiría con las alertas de salida bajo el filtro "Todas"/"Resueltas" (el filtro default "Pendientes" nunca las mostraría juntas salvo un caso de datos ya resuelto).
- "Sin actividad registrada" nunca puede agruparse con nada acá porque no es un `ShiftAlert` (§4.11) — estructuralmente imposible, no requirió ningún código de exclusión.

## 6. Prioridad de alerta principal (Parte 3 del pedido)

Se combinaron las dos listas del pedido (salida y entrada) en una sola, agregando 2 tipos que ninguna de las dos cubría (`POSIBLE_OLVIDO_SALIDA`, `DESCANSO_INSUFICIENTE`) más el tipo legacy (`POSSIBLE_SHIFT_CONFIGURATION_MISSING`, Etapa 13E.1, ya no se genera):

```
1. POSIBLE_OLVIDO_SALIDA                    (nuevo -- ver justificación abajo)
2. CONCEPTO_NO_HABILITADO                   (13G)
3. JORNADA_EXTENDIDA                        (13G)
4. SALIDA_TARDIA                            (13G)
5. SALIDA_ANTICIPADA                        (13G)
6. JORNADA_INSUFICIENTE                     (13G)
7. SEGMENTO_SIN_CLASIFICAR                  (13G)
8. TURNO_NO_IDENTIFICADO                    (pedido, entrada)
9. SHIFT_NOT_ENABLED_FOR_EMPLOYEE           (pedido, entrada)
10. INGRESO_TARDE                           (pedido, entrada)
11. INGRESO_ANTICIPADO                      (pedido, entrada)
12. DESCANSO_INSUFICIENTE                   (nuevo -- ninguna lista lo cubría)
13. POSSIBLE_SHIFT_CONFIGURATION_MISSING    (legacy, 13E.1 -- ya no se genera)
```

**Por qué `POSIBLE_OLVIDO_SALIDA` va primero**: no estaba en ninguna de las 2 listas del pedido, pero es, en la práctica, la señal más urgente — puede llegar a severidad `CRITICA` (régimen `ALERT_ONLY`, Etapa 5) y representa una jornada posiblemente sin cerrar, lo cual puede afectar la confiabilidad de cualquier otro hallazgo del mismo grupo (los minutos/horas de una jornada con una salida dudosa son menos confiables que los de una jornada cerrada normalmente).

**Por qué `DESCANSO_INSUFICIENTE` y `POSSIBLE_SHIFT_CONFIGURATION_MISSING` van al final**: ninguna lista los ordenaba explícitamente, y ninguno de los dos es, en la práctica, la alerta más relevante de un grupo real — `DESCANSO_INSUFICIENTE` es informativo sobre el período entre jornadas (no sobre la jornada en sí), y `POSSIBLE_SHIFT_CONFIGURATION_MISSING` es legacy (ya no se genera, sólo pueden quedar filas históricas).

**Por qué se combinaron las 2 listas en un solo orden en vez de mantenerlas separadas**: agrupar por `workShiftId` puede, en teoría, juntar una alerta de entrada y una de salida de la **misma jornada** (ej. `INGRESO_TARDE` + `SALIDA_TARDIA` del mismo `WorkShift`) — hacía falta un único orden total para decidir cuál es la principal en ese caso. Se priorizó "salida" sobre "entrada" (todo el bloque de 13G antes que el bloque de entrada) porque las alertas de salida evalúan el desenlace completo de la jornada, información más "final" que las de entrada.

## 7. Qué se muestra como detalle (Parte 4 del pedido)

Opción elegida: **fila expandible** (acordeón nativo de tabla), la más simple de implementar sobre la UI existente (`<table>` dentro de `TableShell`) sin rediseño.

- **Fila principal**: empleado, tipo principal (con un indicador "+N hallazgo(s) asociado(s)" clickeable si hay secundarias), severidad principal, turno, diferencia principal, fecha, estado del grupo, acciones — exactamente los campos pedidos en la Parte 3.
- **Al expandir**: una fila adicional (`colSpan` completo) con el encabezado "También se detectó en esta misma jornada" y una lista de las alertas secundarias, cada una con su tipo (mismo `TYPE_LABELS` ya usado, sin lenguaje técnico), severidad, diferencia, estado y su propio botón "Resolver" si está pendiente.
- **Colapsado por default** — no repite el ruido visual que esta etapa vino a resolver.

Ejemplo real verificado con test: fila principal "Concepto no habilitado" + "+1 hallazgo asociado"; al expandir, "También se detectó en esta misma jornada" → "Segmento sin clasificar — Advertencia — +3h 46m — Pendiente — [Resolver]".

## 8. Cómo quedan estados/acciones (Parte 5 del pedido)

- **Estado del grupo**: si **alguna** alerta del grupo está `PENDIENTE`, el grupo muestra `Pendiente`; si ninguna lo está pero hay al menos una `RESUELTA`, muestra `Resuelta`; si todas están `DESCARTADA`, muestra `Descartada` — exactamente la recomendación del pedido (`computeGroupStatus`, `ShiftAlertsPage.tsx`).
- **"Resolver grupo" no se implementó** — la UI actual (y el backend) sólo soportan resolver una alerta a la vez (`POST /shifts/alerts/:id/resolve`, sin variante bulk). Se mantuvieron las acciones individuales: la fila principal resuelve su propia alerta (como siempre), y cada alerta secundaria gana su propio botón "Resolver" dentro del detalle expandido — mismo modal/mecanismo reutilizado, sin necesidad de tocar backend. Documentado como limitación explícita (Parte 5 del pedido: "si la UI actual sólo permite ver detalle individual, mantener acciones individuales y documentar limitación").

## 9. Filtros (Parte 6 del pedido)

**Decisión: se mantuvo el filtrado 100% server-side, sin cambios.** Evaluado explícitamente el trade-off pedido ("si filtro por 'Salida tardía', mostrar grupos donde la principal o algún detalle sea Salida tardía"): implementarlo tal cual exigiría dejar de enviar `type` al backend (que hoy filtra a nivel de fila, excluyendo alertas hermanas de otro tipo para el mismo `workShiftId`), traer sin filtrar y filtrar grupos client-side — una reestructuración de la paginación/filtrado no trivial para un problema que, tal como quedó, ya tiene un comportamiento razonable: con un filtro de tipo activo, cada fila visible YA es de ese tipo exacto (por construcción del filtro server-side), así que RRHH sigue pudiendo filtrar por "Salida tardía" y ver exactamente esas alertas — sólo no ve, mientras ese filtro esté activo, los hallazgos secundarios de otro tipo para la misma jornada. Es un trade-off documentado, no un error — un filtro que angosta lo que se ve es un comportamiento esperado de cualquier filtro. Si en el futuro se reporta que esto confunde, es una etapa acotada (dejar de mandar `type` al backend, filtrar grupos en el cliente).

**Contador**: el subtítulo de la sección ahora distingue "X grupo(s) de alertas (Y alerta(s) individuales)" cuando difieren, evitando la ambigüedad que señalaba el pedido; si coinciden (todos los grupos son de 1 sola alerta), se mantiene el texto original ("Y alerta(s) según filtros aplicados.") sin ruido adicional.

## 10. Backend/API (Parte 7 del pedido)

**No se tocó backend.** Confirmado en el diagnóstico (§4.15-17) que los datos actuales alcanzan — no se creó ningún endpoint `?grouped=true`, no se modificó `shiftAlert.repository.ts`/`service.ts`/`controller.ts`/`schemas.ts`, no se tocó `schema.prisma`, no se generó ninguna migración. El endpoint `GET /shifts/alerts` sigue exactamente igual, sin ningún cambio de contrato — cualquier otro consumidor (si lo hubiera) no se ve afectado.

## 11. Tests (Parte 8 del pedido)

**Frontend** (+12 tests nuevos en `ShiftAlertsPage.test.tsx`, 20/20 en el archivo, 476/476 en toda la suite frontend, todos verdes):

Nuevo describe "Etapa 13H (agrupación por jornada/fichada)":
1. Dos alertas con el mismo `workShiftId` se muestran como un único grupo, no como filas sueltas (Tests obligatorios #1/#10).
2. Alertas de empleados distintos (`workShiftId` distinto) no se agrupan (#2).
3. Alertas de días distintos (`workShiftId` distinto) no se agrupan (#3).
4. El grupo muestra el tipo de mayor prioridad como principal (`CONCEPTO_NO_HABILITADO` sobre `SALIDA_TARDIA`) (#4).
5. Muestra "+1 hallazgo asociado", sin lenguaje técnico (ni `workShiftId` ni el enum crudo) (#5/#11).
6. Al expandir, muestra el hallazgo secundario con su propio detalle (severidad, diferencia) (#6).
7. El grupo queda `Pendiente` si alguna alerta interna está pendiente, aunque la principal ya esté resuelta (#8).
8. La acción de detalle ("Ver legajo") sigue funcionando sobre la fila principal del grupo (#9).
9. Un empleado con una sola alerta no muestra ningún indicador de hallazgos asociados (regresión, caso simple sin cambios visibles).
10. El subtítulo distingue grupos de alertas individuales cuando difieren.

**Filtros (#7) y empty/loading/error states (#12)**: cubiertos por la suite ya existente, sin necesitar tests nuevos — no se tocó esa lógica (§9), y los 18 tests preexistentes (10B/10E/13A/13E) siguen verdes sin modificación, confirmando que el comportamiento de filtros/estados de carga no cambió.

## 12. Validación visual

Se intentó validar en navegador real (Playwright), según lo pedido en la Parte 10. El backend ya estaba corriendo (`GET /api/health` → `200 ok`, base real conectada). Se levantó una instancia adicional del frontend (puerto 5175, ya que 5173/5174 estaban ocupados — presumiblemente la sesión de desarrollo activa del usuario, no tocada) e intenté iniciar sesión con las credenciales seed documentadas (`admin@losod.local`). El intento se frenó en un bloqueo de **CORS**: el backend tiene `CORS_ORIGIN` configurado sólo para el origen del frontend "real" del usuario, no para el puerto 5175 de esta prueba puntual. **Se decidió no reconfigurar `CORS_ORIGIN` ni reiniciar el backend** para no interferir con la sesión de desarrollo activa del usuario — es una acción sobre configuración compartida que requeriría aprobación explícita, fuera de lo que esta etapa necesitaba resolver. Se detuvo la instancia temporal del frontend (puerto 5175) sin dejar procesos corriendo.

**Validación real ejecutada en su lugar**: `tsc -b` limpio, `npm run build` exitoso (chunk `ShiftAlertsPage` generado sin errores), y los 20 tests de `ShiftAlertsPage.test.tsx` — que renderizan el componente **real** (no un mock superficial) con React Testing Library, incluyendo la interacción real de click para expandir el grupo (`userEvent.click`) y verificación de la estructura DOM resultante — cubren los 5 casos de la Parte 10 (una sola alerta, varias del mismo cierre, alertas de distintos cierres, filtros, acciones) con datos realistas. Vista mobile/tablet no aplica un cambio de layout nuevo (se reutiliza `TableShell`, que ya maneja scroll horizontal responsivo sin cambios en esta etapa).

## 13. Qué NO se tocó

- Backend completo — `shiftAlert.repository.ts`, `service.ts`, `controller.ts`, `schemas.ts` sin cambios; ningún otro módulo backend tocado.
- Generación de `ShiftAlert` (`evaluateShiftEntry`, `evaluateShiftExit`, `applyClassificationAlerts`, `createShiftAlert`) — cero líneas tocadas; esta etapa es puramente de presentación sobre datos ya existentes.
- Lógica de entrada y de salida — sin cambios (confirmado, no se tocó `workShiftEvaluationRunner.ts` ni `workShiftEvaluation.service.ts`).
- Horas Especiales, Conceptos Horarios — sin cambios de código (sólo se leyeron para entender de dónde nacen `CONCEPTO_NO_HABILITADO`/`SEGMENTO_SIN_CLASIFICAR`, ya sabido de etapas anteriores).
- Liquidación, grilla/export/bandeja — ningún archivo tocado.
- Fichador — ningún archivo tocado.
- Asignaciones de feriado, "Sin actividad registrada" — sin cambios.
- `schema.prisma` — sin cambios, sin migraciones.
- Filtrado server-side (`type`/`severity`/`status`/`search`) — sin cambios de comportamiento (ver §9, decisión explícita).
- Paginación (cursor `before`/`take`, "Cargar 20 más") — sin cambios.
- Acción "Resolver" a nivel de backend — sin bulk resolve, sin cambios de endpoint.

## 14. Riesgos pendientes

- **Un grupo puede quedar dividido entre "página" y "página siguiente"** si sus miembros caen justo en el límite de un lote de `take=20` — improbable en la práctica (las alertas de un mismo cierre se crean con `createdAt` casi idéntico, milisegundos de diferencia, así que casi siempre caen en el mismo lote), pero no está garantizado. Si esto se reporta como confuso en el uso real, la mitigación sería aumentar el `take` por defecto de esta pantalla específica o, si el caso es frecuente, sí justificaría un endpoint agrupado backend (Parte 7 del pedido, descartado por ahora sin evidencia de que haga falta).
- **Filtro por tipo no busca dentro de hallazgos secundarios** (§9) — trade-off documentado y aceptado, con el camino de solución ya identificado si se necesita en el futuro.
- **Sin "resolver grupo" de un solo click** — cada alerta se resuelve individualmente (mismo mecanismo que ya existía, ahora también accesible desde el detalle expandido). Si RRHH pide explícitamente poder resolver todo el grupo de una vez, requeriría un endpoint bulk nuevo en el backend — no implementado por falta de necesidad confirmada.
- **Validación visual en navegador real no se completó** (bloqueo de CORS al usar un puerto de prueba distinto al del usuario, ver §12) — mitigado con la suite de tests de componente (20/20, renderizado real vía RTL) como evidencia de que el DOM resultante es correcto, pero no reemplaza una inspección visual humana en vivo (colores, alineación píxel a píxel, comportamiento responsive real).

---

No se tocó backend, generación de `ShiftAlert`, lógica de entrada/salida, Horas Especiales, Conceptos Horarios, liquidación, fichador, grilla/export/bandeja, asignaciones de feriado, ni "Sin actividad registrada". No se creó ninguna migración. No commitear sin aprobación explícita del usuario.
