# Etapa 15G.2 — Crear Novedad desde Notificación/Alerta

## 1. Contexto

15G/15G.1 dejaron establecido que Novedades es justificación
administrativa: nunca crea, modifica ni pone en 0 un `TimeEntry`; el
fichador y la carga horaria manual son la única fuente de verdad de horas
reales (`docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md`).

15G.2 conecta el otro extremo del flujo: cuando el sistema detecta una
anomalía horaria (llegada tarde, salida anticipada, turno no identificado,
falta de fichada, ausencia/posible no asistencia), debe poder iniciarse
desde ahí mismo la carga de una novedad administrativa para ese empleado,
sin que eso implique ningún cálculo ni ajuste de horas — sólo un atajo
para no tener que ir a buscar manualmente al empleado y la fecha en
Novedades.

### Auditoría previa (obligatoria antes de implementar)

Antes de tocar código se auditó cómo están implementadas hoy las alertas:

- **Modelos existentes**: `ShiftAlert` (turnos: `INGRESO_TARDE`,
  `SALIDA_ANTICIPADA`, `SALIDA_TARDIA`, `TURNO_NO_IDENTIFICADO`,
  `JORNADA_INSUFICIENTE`/`JORNADA_EXTENDIDA`, `POSIBLE_OLVIDO_SALIDA`,
  etc.), `AttendanceInactivityIncident` (ausencia de toda actividad un
  día completo) y `SystemNotification` (bandeja in-app genérica, "la
  campanita"). **No existen** `AttendanceAlert` ni `InAppNotification`.
- **No existía ningún vínculo** entre estos modelos y `Novelty`/
  `NoveltyType` — ni una columna `noveltyId` en las alertas, ni una
  referencia inversa desde `novelties`. Confirmado por grep exhaustivo.
- El único campo disponible en `Novelty` para anotar de dónde salió, sin
  tocar el schema, es `observation` (texto libre).
- `NoveltyModal.tsx` (frontend) no recibía ningún dato de precarga
  (ni empleado suelto, ni fecha, ni tipo) — sólo un array `employees` ya
  resuelto por el padre.
- No existía en el proyecto ningún patrón de "modal precargado desde otra
  pantalla" (ni route state, ni contexto global, ni query params para
  abrir un modal) — el patrón más cercano era `?period=`/`?observationDate=`
  para precargar un FILTRO de la propia página, no para abrir un modal.
- El campo `NoveltyType.allowedLoadRoles` existe en el modelo y se
  configura desde la UI de tipos, pero **no se aplica hoy en el frontend**
  al elegir el tipo en `NoveltyModal`/`NoveltiesPage` — la única
  protección real de quién puede cargar qué tipo vive en el backend
  (`assertCanLoad`, `novelties.service.ts`). Esto ya era así antes de
  15G.2 y no se tocó (ver §5).

Ver el detalle completo de esta auditoría en el historial de la
conversación de esta etapa; no se generó un documento de auditoría
separado porque el hallazgo central (no hay vínculo, no hay precarga) es
justamente lo que motiva la decisión de abajo.

## 2. Decisión

> **Ajuste de alcance — versión final (antes del commit):** la primera
> versión de esta etapa priorizaba `ShiftAlertsPage` y `AttendancePage`
> como los dos puntos de entrada; un segundo ajuste movió el foco a
> Notificaciones pero dejó `ShiftAlertsPage` con un botón "secundario" y
> "no asistió" sin cubrir en Notificaciones. **Esta es la versión final**:
> **Notificaciones es el único flujo principal**, cubriendo los 4 casos
> pedidos (llegada tarde, salida temprana, falta de fichada/olvido de
> salida y "no asistió") gracias a un enriquecimiento agregado en backend
> para `AttendanceInactivityIncident`. **`ShiftAlertsPage` ya no tiene
> ninguna acción de crear novedad** (se quitó por completo, no quedó como
> secundaria). `AttendancePage → Problemas de fichada` queda como acceso
> **complementario** (útil operativamente, no el punto de entrada
> esperado). Ver §3.2 para el diagnóstico y la decisión completos.

1. Fichador/turnos siguen siendo quienes detectan la anomalía
   (`ShiftAlert`/`AttendanceInactivityIncident`, sin cambios en cómo se
   generan).
2. La alerta/observación se sigue mostrando igual que siempre
   (`ShiftAlertsPage` — sólo consulta, sin acción de novedad —,
   `AttendancePage` → "Problemas de fichada",
   `NotificationsPage` → bandeja agregada de todo lo anterior).
3. Desde Notificaciones (principal) o AttendancePage (complementario), un
   botón **"Crear novedad"** abre el mismo
   `NoveltyModal` de siempre, pero con los datos de la alerta ya
   precargados (empleado, fecha, cantidad de horas si aplica, observación
   de contexto, tipo sugerido si se puede determinar con certeza).
4. El usuario revisa/corrige lo que haga falta y guarda con el mismo botón
   "Guardar novedad" — mismo endpoint (`POST /novelties`), mismas reglas de
   backend (`assertCanLoad`, alcance por empleado, `allowsHours`, etc.).
5. RRHH aprueba/rechaza esa novedad exactamente igual que cualquier otra
   (no hay ningún endpoint ni campo nuevo de aprobación).
6. Novedades sigue sin modificar horas: crear la novedad desde una alerta
   no crea, modifica ni pone en 0 ningún `TimeEntry` (mismo código de
   15G.1, no tocado en esta etapa).

## 3. Flujo implementado

**Backend: un cambio puntual y justificado (versión final).** El endpoint
`POST /api/novelties` ya aceptaba todos los campos necesarios
(`employeeIds`, `noveltyTypeId`, `fromDate`, `quantityHours`,
`observation`) — no hizo falta ningún endpoint nuevo para *crear* la
novedad, ni tocar `schema.prisma`/migraciones/DB. Sí se tocó
`GET /workforce/notifications` (`workforce.service.ts::notifications`):
se agregó `AttendanceInactivityIncident` a la lista de `entityType` que
el backend enriquece con `employee` (mismo patrón exacto ya usado para
`ShiftAlert`/`WorkShift`/`Employee` — un `select` mínimo
`{id, legajo, firstName, lastName}` sobre el o los incidentes de la
página actual, nunca un `getById` ni el legajo completo). Sin este cambio,
Notificaciones no podía cubrir "no asistió" sin datos suficientes — ver
§3.2 para la justificación completa de por qué era indispensable tocar
este archivo puntual.

**Frontend (nuevo):**

- `frontend/src/utils/argentinaDateKey.ts` — dos helpers de fecha:
  `argentinaDateKey` (instante real `@db.Timestamptz` → fecha calendario
  Argentina) y `calendarDateKey` (fecha `@db.Date` ya normalizada → se lee
  tal cual, sin conversión de timezone, mismo criterio que
  `dayOfMonthFromCalendarDate` en el backend). `AttendancePage.tsx::todayKey()`
  se refactorizó para reusar el primero en vez de duplicar la lógica.
- `frontend/src/utils/noveltyFromAlert.ts` (nuevo) — funciones puras que
  arman el contexto de precarga: `buildNoveltyPrefillFromInactivityIncident`
  (`AttendanceInactivityIncident`, usada por `AttendancePage`),
  `buildNoveltyPrefillFromAttendanceShiftProblem` (`AttendanceShift`, ídem)
  y `buildNoveltyPrefillFromNotification` (`SystemNotification`, usada por
  `NotificationsPage` — flujo principal). Ninguna hace llamadas de red.
  (`buildNoveltyPrefillFromShiftAlert` existió brevemente para
  `ShiftAlertsPage` y se eliminó junto con esa acción — ver §3.2.)
- `frontend/src/components/novelties/NoveltyFromContextModal.tsx` (nuevo) —
  puente entre el contexto de la alerta y `NoveltyModal`. **Versión final
  (ver §3.1): sin fetch** — monta `NoveltyModal` directo con los datos
  mínimos que ya trae la alerta, sin resolver ningún legajo por red.
- `frontend/src/components/novelties/NoveltyModal.tsx` — se le agregaron
  props **opcionales** y aditivos: `initialFromDate`, `initialQuantityHours`,
  `initialObservation`, `suggestedNoveltyTypeCode`, `contextNote`. Sin
  ninguno de estos props, el comportamiento es idéntico al de antes de
  15G.2 (carga manual sin cambios, verificado con test).
- `frontend/src/pages/ShiftAlertsPage.tsx` — **sin ninguna acción de
  crear novedad** (versión final). Tuvo brevemente un botón "Crear
  novedad" en una iteración intermedia; se quitó por completo (botón,
  estado, modal, toast, helper exclusivo) porque el usuario decidió que
  no es el punto operativo correcto — queda como consulta/análisis
  técnico de alertas de turno solamente. `TYPE_LABELS` volvió a ser un
  `const` interno (ya no se exporta — nada externo lo necesita).
- `frontend/src/pages/AttendancePage.tsx` — botón "Crear novedad" en la
  bandeja "Problemas de fichada", para observaciones de tipo `INACTIVITY`
  (ausencia/posible no asistencia) y `SHIFT` (falta de fichada:
  `FALTA_SALIDA`/`FALTA_INGRESO`/`OBSERVADO`/`INVALIDO`). **No** se agregó
  para `PUNCH` (intentos de fichada individuales rechazados/observados) —
  ver §6. **Acceso complementario** (ver §3.2) — útil operativamente para
  quien ya está en esa bandeja, pero Notificaciones es el punto de
  entrada esperado.
- `frontend/src/pages/NotificationsPage.tsx` — botón "Crear novedad"
  (ver §3.2). **Flujo principal**, cubre los 4 casos pedidos: llegada
  tarde/salida temprana (`ALERTA_FICHADA`), falta de fichada/olvido de
  salida (`FALTA_SALIDA`) y **"no asistió"** (`SIN_ACTIVIDAD_REGISTRADA`,
  cubierto gracias al enriquecimiento de backend de esta versión final) —
  sólo se muestra cuando la notificación ya trae `employee` resuelto.

### 3.1 Ajuste posterior (antes del commit) — evitar over-fetching

La primera versión de `NoveltyFromContextModal` resolvía el legajo
completo con `employeeApiService.getById(employeeId)` antes de poder
montar el modal (mismo servicio que usa la ficha de legajo). Revisado
contra la regla transversal del proyecto ("no reutilizar `getById` cuando
el caso de uso necesita sólo pocos campos"), se auditó qué usa realmente
`NoveltyModal` de cada `Employee`:

- Cuando `employees.length === 1` (el único caso que este flujo ejercita
  — siempre pasa exactamente un empleado), sólo lee `id`, `legajo`/
  `legajoInterno`/`legajoFinnegans` (vía `displayLegajo`) y `firstName`/
  `lastName` (vía `fullName`) para el texto fijo del legajo, más
  `enabledHours` (opcional, con `|| []` si falta) para las opciones de
  "Aplica sobre hora".
- `EmployeeRemoteSelector` (que sí exige el `Employee` completo) sólo se
  monta cuando `employees.length !== 1` — nunca en este flujo.
- `ShiftAlert.employee`, `AttendanceInactivityIncident.employee` y
  `AttendanceShift.employee` **ya traen** `id`, `legajo`, `firstName`,
  `lastName` (y `dni`/`status`) en la respuesta que la página ya cargó —
  sin ningún fetch adicional.
- El backend (`POST /novelties`) sólo necesita `employeeIds: string[]` —
  nunca leyó legajo/nombre para crear la novedad.

**Se eliminó `employeeApiService.getById` de este flujo por completo**
(opción "eliminarlo" del punto 3 de la tarea, no la de mantenerlo como
deuda): `noveltyFromAlert.ts` ahora arma `NoveltyPrefillContext.employee`
como un tipo mínimo propio (`NoveltyPrefillEmployee = { id, legajo,
firstName, lastName }`), leyendo esos 4 campos directo del sub-objeto
`employee` que ya trae cada alerta/incidente/jornada. `NoveltyFromContextModal`
monta `NoveltyModal` de forma síncrona con ese objeto (sin `useState`/
`useEffect`, sin estado de carga/error) — como efecto secundario, también
desaparece el pequeño spinner que existía entre el click y la apertura
del modal.

**Compromiso de tipos, documentado y acotado:** `NoveltyModal.tsx` no se
tocó — su prop `employees` sigue tipado como `Employee[]` (no se ensanchó
ni se redujo, para no arrastrar el conflicto con `EmployeeRemoteSelector`,
que sí exige `Employee` completo y es un componente compartido por otras
4 pantallas fuera de alcance de esta etapa). `NoveltyFromContextModal`
pasa el objeto mínimo con un cast acotado (`context.employee as Employee`),
justificado en un comentario en el propio archivo: es seguro porque (a)
se probó por código qué campos lee `NoveltyModal` en el camino de un solo
empleado, y (b) este componente siempre pasa exactamente un empleado, por
lo que `EmployeeRemoteSelector` nunca se monta. Un test dedicado en
`NoveltyModal.test.tsx` monta el componente con ese mismo objeto mínimo
(sin el cast, vía un test-only) y confirma que funciona de punta a punta.

Si en el futuro `NoveltyModal` empezara a leer otro campo de `Employee`,
o si `NoveltyFromContextModal` alguna vez pasara más de un empleado, este
adaptador queda invalidado y hay que revisarlo (y ahí sí, recién ahí,
volver a considerar un fetch o un `EmployeeSummary` real).

### 3.2 Ajuste de alcance — versión final: Notificaciones como único flujo principal

**Diagnóstico.** `SystemNotification` (`backend/src/modules/workforce-management/workforce.service.ts::notifications`)
es la bandeja que agrega **todas** las notificaciones que genera el
sistema: alertas de turno (`ALERTA_FICHADA`, disparadas por `ShiftAlert`),
falta de salida/olvido (`FALTA_SALIDA`, disparada desde `time-entries` al
expirar una jornada abierta), intento de ingreso con jornada abierta
(`INTENTO_INGRESO_JORNADA_ABIERTA`), sin actividad registrada
(`SIN_ACTIVIDAD_REGISTRADA`, disparada por `AttendanceInactivityIncident`
= "no asistió"), más cierres mensuales, correcciones y novedades
pendientes. Es, en efecto, "donde llegan todas las notificaciones del
fichador" — más amplia que `ShiftAlertsPage` (sólo `ShiftAlert`) y que
`AttendancePage → Problemas de fichada` (sólo `WorkShift`/`AttendancePunch`/
`AttendanceInactivityIncident`, sin `ShiftAlert`).

Antes de este ajuste final, traía **menos estructura** por notificación
que la alerta de origen: el backend sólo resolvía y adjuntaba
`employee: {id, legajo, firstName, lastName}` cuando `entityType` era
`"ShiftAlert"`, `"WorkShift"` o `"Employee"` — **`AttendanceInactivityIncident`
("no asistió") no estaba en esa lista**, así que esas notificaciones
(`SIN_ACTIVIDAD_REGISTRADA`) llegaban sin `employee`, y Notificaciones no
podía ofrecer "Crear novedad" para ese caso.

**Cambio de backend (indispensable y acotado):** se agregó
`AttendanceInactivityIncident` a la lista de `entityType` enriquecidos en
`notifications()` (`backend/src/modules/workforce-management/workforce.service.ts`),
con el mismo patrón exacto ya usado para los otros tres: filtrar los
`entityId` de la página actual con ese `entityType`, y sólo si hay alguno,
una única query `prisma.attendanceInactivityIncident.findMany({ where:
{ id: { in: [...] } }, select: { id: true, employee: { select:
{ id, legajo, firstName, lastName } } } })` — el mismo `select` mínimo que
ya usan `shiftAlert.findMany`/`workShift.findMany`/`employee.findMany` en
esa misma función. **No** se agregó un `getById`, no se trae el legajo
completo, no se toca `schema.prisma`/migraciones/DB, y el resto del
enriquecimiento (`ShiftAlert`/`WorkShift`/`Employee`) queda intacto
(cubierto por test, ver §8). Se justificó tocar backend acá porque sin
este dato la decisión "Notificaciones es el flujo principal para los 4
casos" era imposible de cumplir sin inventar un patrón nuevo (parsear
texto, u otro fetch) — el cambio real es una línea de filtro + un `case`
más en el `.map()` de enriquecimiento, exactamente simétrico a lo que ya
existía.

Sigue siendo cierto que ninguna notificación trae la metadata fina de la
alerta original (`differenceMinutes`, el `ShiftAlertType` exacto) — sólo
`title`/`message` en texto libre, y el `type` de la notificación no
distingue subtipos (`"ALERTA_FICHADA"` es el mismo para llegada tarde,
salida anticipada, turno no identificado, etc.). Parsear `title` por
texto para recuperar el tipo real seguiría siendo frágil — no se hizo.
Por eso `buildNoveltyPrefillFromNotification()` nunca sugiere
`quantityHours` ni `suggestedNoveltyTypeCode`, para ningún `type` de
notificación (tampoco para "no asistió": no hay un `NoveltyType` de
"Ausencia" garantizado en todos los entornos y no se crea uno nuevo para
esto — el usuario elige el tipo en el modal, como ya pasaba con salida
anticipada/turno no identificado).

**Decisión de alcance final:**

- `buildNoveltyPrefillFromNotification()` (`noveltyFromAlert.ts`) y el
  botón "Crear novedad" en `NotificationsPage.tsx` — condicionado a que
  `notification.employee` exista — ahora cubren los **4 casos pedidos**:
  llegada tarde, salida temprana (`ALERTA_FICHADA`), falta de
  fichada/olvido de salida (`FALTA_SALIDA`) y **"no asistió"**
  (`SIN_ACTIVIDAD_REGISTRADA`, recién cubierto gracias al enriquecimiento
  de backend de esta versión). Precarga: empleado (de la propia
  notificación, sin fetch), fecha (`createdAt` de la notificación, como
  aproximación), observación (el propio `message`, ya descriptivo). Sin
  cantidad de horas ni tipo sugerido (ver diagnóstico).
- **`ShiftAlertsPage` ya no tiene ninguna acción de crear novedad** — se
  quitó por completo (no quedó como "acceso secundario", se eliminó
  directamente): botón, estado (`noveltyContext`/`noveltyNotice`), modal,
  toast, y el `import`/uso de `NoveltyFromContextModal`/
  `buildNoveltyPrefillFromShiftAlert`. Ese builder (y sus helpers
  exclusivos `formatMinutes`/`formatTime`/`SUGGESTED_TYPE_CODE_BY_ALERT_TYPE`)
  se eliminaron de `noveltyFromAlert.ts` por estar sin ningún otro uso.
  `TYPE_LABELS` volvió a ser un `const` interno de `ShiftAlertsPage.tsx`
  (dejó de exportarse). Confirmado con test: ningún texto "Crear novedad"
  aparece en esa página, ni en la fila principal ni en los hallazgos
  secundarios de un grupo.
- **`AttendancePage → Problemas de fichada` queda como acceso
  complementario** (sin cambios de código) — sigue siendo útil
  operativamente para quien ya está resolviendo un problema de fichada
  ahí mismo, pero no es el flujo principal ni se documenta como tal.
- Crear la novedad desde Notificaciones **no marca la notificación como
  leída ni cambia su estado** — "Marcar leída" sigue siendo la única
  acción que hace eso, sin relación con Novedades (mismo criterio que
  "Ver detalle", que tampoco marca como leída desde la Etapa 14G.6). Igual
  para `AttendancePage`: crear la novedad no dispara `resolveObservation`.

### 3.3 Ajuste UX (previo al commit) — sin IDs técnicos en observaciones visibles

**Problema detectado.** La observación autogenerada por
`buildNoveltyPrefillFromNotification()` interpolaba el `id` (UUID) de la
`SystemNotification` de origen, por ejemplo: *"Generado desde notificación
de fichador (notificación 204bd1dc-ea7c-4b7b-a029-264faf5796ac): La
fichada requiere seguimiento."* Los otros dos builders de este mismo
archivo (`buildNoveltyPrefillFromInactivityIncident`,
`buildNoveltyPrefillFromAttendanceShiftProblem`, usados desde
`AttendancePage`) tenían el mismo problema con el `id` del incidente/la
jornada. Un UUID/id técnico en un campo operativo (`Novelty.observation`,
visible para RRHH al revisar la novedad) es una filtración de detalle de
implementación al usuario final — nunca debe aparecer ahí.

**Regla adoptada:** ningún texto visible de operación diaria (observación,
label, mensaje, formulario) muestra un id/UUID técnico, ni el nombre
técnico de un `entityType`/modelo (`ShiftAlert`, `WorkShift`,
`AttendanceInactivityIncident`, etc.). Los ids técnicos pueden seguir
existiendo internamente (en el objeto que viaja por la app, en la base de
datos), simplemente no se imprimen en un string que el usuario lee.

**Corrección aplicada.** Las tres funciones de `noveltyFromAlert.ts`
arman ahora una observación puramente humana, con la misma estructura:
"Origen: alerta del fichador (contexto humano si aplica). Detalle
detectado: {mensaje/observación ya descriptiva de la alerta}. Las horas
reales se mantienen según fichador/carga horaria." — sin ningún id
interpolado. La referencia a la notificación/incidente/jornada de origen
sigue existiendo sólo como **contexto humano** (qué pasó, no qué fila de
qué tabla lo generó).

**Consecuencia sobre trazabilidad (sin cambios de fondo):** como ya
estaba documentado en §6, no existe un vínculo estructurado en base de
datos entre la alerta/notificación y la `Novelty` resultante — la única
trazabilidad siempre fue textual. Este ajuste no la degrada, la hace
correcta: antes esa trazabilidad textual exponía un id técnico al
usuario (mal, ver arriba); ahora es un texto legible sin id, y por lo
tanto **ya no sirve ni siquiera informalmente para reconstruir qué fila
de origen generó la novedad** — si en el futuro se necesita esa
trazabilidad técnica (auditoría, soporte), debe resolverse con una
relación real en base de datos (deuda futura, sin fecha asignada), no
volviendo a pegar un id en un campo de texto visible.

## 4. Qué datos se precargan

| Origen | Empleado | Fecha | Cantidad de horas | Observación | Tipo sugerido |
|---|---|---|---|---|---|
| `AttendanceInactivityIncident` (vía `AttendancePage`, acceso complementario) | sí (ídem, sin fetch) | fecha calendario del incidente | — | texto humano ("Origen: alerta del fichador...") + la observación que ya arma el backend, **sin id técnico del incidente** | ninguno |
| `AttendanceShift` con problema (`FALTA_SALIDA`/etc., vía `AttendancePage`) | sí (ídem, sin fetch) | fecha de inicio de la jornada | — | texto humano + etiqueta del problema + observación de la jornada si existe, **sin id técnico de la jornada** | ninguno |
| `SystemNotification` con `employee` — `ALERTA_FICHADA` (llegada tarde/salida temprana), `FALTA_SALIDA` (falta de fichada) o `SIN_ACTIVIDAD_REGISTRADA` ("no asistió") — **flujo principal** | sí (resuelto por el backend, sin fetch en el frontend) | `createdAt` de la notificación (aproximado) | — | texto humano + el propio `message` de la notificación, **sin el `id`/UUID de la notificación** (ver §3.3) | ninguno (ver diagnóstico §3.2) |
| `SystemNotification` sin `employee` (cierres, correcciones, novedades pendientes) | — | — | — | — | no se ofrece "Crear novedad" acá |

`ShiftAlertsPage` no aparece en esta tabla: ya no ofrece "Crear novedad"
(ver §3.2).

Todo lo anterior es **editable** antes de guardar — el modal no envía nada
automáticamente. Si el tipo sugerido existe y está activo, se preselecciona;
si no existe (código inexistente o tipo dado de baja), cae al primer tipo
activo — el mismo comportamiento de siempre, sin romper nada.

Hallazgo corregido durante la implementación: la observación precargada
sólo era visible en el formulario cuando el tipo tenía
`requiresDocumentation = true` (el campo de observación vivía dentro de la
tarjeta de "Documentación requerida"). Para "Llegada tarde"
(`requiresDocumentation = false`) esto habría hecho que el texto viajara
en el payload sin que el usuario pudiera verlo ni corregirlo. Se agregó un
campo "Observación" visible siempre que el modal traiga un `contextNote`
(es decir, siempre que se abra desde una alerta), sin afectar el
formulario de carga manual.

## 5. Permisos

Sin cambios: la creación pasa por el mismo `POST /novelties` y las mismas
reglas de siempre (`assertCanLoad`/`allowedLoadRoles` por tipo, alcance de
empleado vía `employeeAccessWhere`, `ensureNoveltyTypeReady`). El botón
"Crear novedad" está disponible en las mismas condiciones que ya tienen
`NotificationsPage`/`AttendancePage` hoy (los 3 roles operativos pueden
verlas) — no se agregó ningún filtro de rol nuevo en el frontend porque
tampoco existe uno hoy para la carga manual (`allowedLoadRoles` no se
aplica en el cliente, sólo en el backend); replicar ese mismo criterio acá
es "usar el flujo normal", no una regresión ni una ampliación de permisos.
Un usuario no puede crear desde una notificación/alerta nada que no
pudiera crear manualmente — si el backend rechaza por rol
(`403 NOVELTY_LOAD_FORBIDDEN`), el modal muestra el mismo error genérico
que ya muestra hoy para la carga manual.

## 6. Qué NO se implementó

- **Vínculo en base de datos entre la alerta y la `Novelty` resultante.**
  No se agregó ninguna columna (`noveltyId`, `sourceAlertId`, etc.) a
  `ShiftAlert`/`AttendanceInactivityIncident`/`Novelty`. La única
  trazabilidad es textual, dentro de `Novelty.observation`, y (ajuste UX,
  ver §3.3) es puramente humana — **no incluye el id/UUID técnico** de la
  alerta/incidente/jornada/notificación de origen, sólo una descripción
  legible de qué pasó. Como no hay vínculo estructurado ni id textual, no
  es posible reconstruir de forma confiable qué fila de origen generó una
  `Novelty` dada más allá de lo que el texto describe. Queda documentado
  como deuda futura si se necesitara reportar/auditar esa relación de
  forma estructurada (una FK real, no un id pegado en un texto visible).
- **Cierre/resolución automática de la alerta al crear la novedad.**
  Crear la novedad no cambia `ShiftAlert.status` ni
  `AttendanceInactivityIncident.status` — "Resolver" sigue siendo una
  acción manual aparte, sin relación con Novedades.
- **Deduplicación robusta.** No se agregó ninguna validación de "ya existe
  una novedad para este empleado/fecha/tipo" — sigue siendo el mismo gap
  ya documentado en `docs/PROJECT_CONTEXT.md` (solapamiento de novedades
  pendiente de definición de negocio). Queda para 15G.3.
- **Descuento parcial de horas.** Sin cambios — sigue sin existir ningún
  mecanismo de descuento (ni todo-o-nada ni parcial).
- **Nuevos tipos de novedades.** No se creó ningún `NoveltyType` nuevo ni
  se tocó el seed — el único código sugerido (`NOV-LLEGADA-TARDE`) es el
  que ya existía.
- **Botón "Crear novedad" sobre intentos de fichada individuales (`PUNCH`).**
  Se limitó a `SHIFT`/`INACTIVITY` en `AttendancePage` — un intento de
  fichada rechazado/observado no mapea tan directamente a "falta de
  fichada de todo el día" como para justificar el mismo atajo en esta
  etapa; queda fuera de alcance.
- **"Crear novedad" sobre notificaciones sin `employee` en general**
  (cierres mensuales, correcciones, novedades pendientes, intento de
  ingreso con jornada abierta como `Employee`-sin-más-contexto). No aplica
  el mismo patrón de "justificar una anomalía horaria con una novedad".
- **Suggested type / quantityHours desde Notificaciones.** Ningún `type`
  de notificación (tampoco "no asistió") sugiere cantidad de horas ni tipo
  de novedad — esa granularidad no está disponible a nivel de
  `SystemNotification` (`type` genérico, sin `differenceMinutes`) y no se
  creó un `NoveltyType` nuevo de "Ausencia" para forzar una sugerencia —
  se documentó como limitación aceptada, no como bug.
- **"Crear novedad" sobre intentos de fichada individuales (`PUNCH`) en
  Notificaciones/AttendancePage.** Mismo criterio que en la versión
  anterior — no mapea tan directamente a una anomalía de día completo.

## 7. Riesgo residual

- `allowedLoadRoles` sigue sin aplicarse en el frontend (gap preexistente,
  no introducido ni agravado por esta etapa — el backend ya protege la
  creación real).
- Sin vínculo estructurado alerta↔novedad, un reporte futuro de "¿esta
  novedad vino de una alerta?" tendría que parsear `observation` por texto.
- Sin deduplicación, un usuario podría crear más de una novedad desde la
  misma alerta haciendo doble click en "Crear novedad" en dos sesiones
  distintas del modal — mismo riesgo que ya existe hoy para la carga
  manual repetida, no agravado por esta etapa.
- `NoveltyFromContextModal` pasa un objeto `Employee` incompleto a
  `NoveltyModal` vía un cast acotado (`as Employee`, ver §3.1) en vez de
  ensanchar el tipo de `NoveltyModal`. Es seguro hoy (probado por código y
  por test), pero es un acoplamiento implícito: si `NoveltyModal` cambia
  qué campos lee de `Employee`, este adaptador puede quedar desactualizado
  sin que el compilador lo detecte (el cast lo oculta a propósito). Cambio
  mínimo aceptado para no tocar `NoveltyModal`/`EmployeeRemoteSelector`
  fuera de alcance de esta etapa; documentado para que quien toque
  `NoveltyModal` en el futuro sepa que este flujo depende de ese contrato
  implícito.
- Desde Notificaciones, el usuario no ve qué tipo de anomalía exacta
  originó la alerta (todo `ALERTA_FICHADA` se ve igual, sea llegada tarde
  o salida anticipada) — puede llevar a elegir el tipo de novedad
  manualmente con menos contexto puntual del que daba el detalle técnico
  de `ShiftAlertsPage`. Se prioriza cobertura amplia (todas las
  notificaciones, un único flujo) por sobre precisión de sugerencia en
  este punto de entrada — decisión explícita del usuario al quitar
  `ShiftAlertsPage` como alternativa.
- El enriquecimiento de `AttendanceInactivityIncident` en `notifications()`
  agrega una query condicional más (sólo corre si hay al menos una
  notificación de ese `entityType` en la página actual — mismo patrón que
  las otras 3, no cambia el conteo de queries en el caso común sin
  incidentes).

## 8. Tests

**Backend (ajuste, `workforce.service.test.ts`):**

- Nuevo test: una notificación `entityType = "AttendanceInactivityIncident"`
  se enriquece con `employee` mínimo (`id`/`legajo`/`firstName`/`lastName`)
  — asserción exacta del `where`/`select` de la query nueva, y que no se
  llama a `prisma.employee.findMany` (no hay un segundo fetch para
  "completar" el empleado).
- Nuevo test: el enriquecimiento nuevo convive con `ShiftAlert`/`WorkShift`/
  `Employee` en la misma página de notificaciones sin interferir entre sí
  (4 notificaciones, 4 `entityType` distintos, cada una con su propio
  `employee` resuelto correctamente).
- Test existente actualizado: "no dispara ninguna query de enriquecimiento
  cuando ninguna notificación tiene entityId" ahora también afirma que
  `attendanceInactivityIncident.findMany` no se llama.
- Los tests preexistentes de paginación/orden/filtro/scope por usuario y
  del enriquecimiento de `ShiftAlert` no se tocaron y siguen en verde.

**Frontend:**

- `frontend/src/utils/noveltyFromAlert.test.ts` — se quitó el describe de
  `buildNoveltyPrefillFromShiftAlert` (función eliminada, ver §3.2); se
  agregó un describe para `buildNoveltyPrefillFromNotification` (precarga
  de empleado/fecha/observación; nunca sugiere tipo ni horas, ni siquiera
  para "no asistió"); quedan los describe de
  `buildNoveltyPrefillFromInactivityIncident`/`buildNoveltyPrefillFromAttendanceShiftProblem`
  (usados por `AttendancePage`), incluida la regresión de timezone
  encontrada en una iteración previa (`calendarDateKey` vs.
  `argentinaDateKey` según el campo sea fecha calendario o instante real).
  **Ajuste UX (§3.3):** se agregó un test dedicado por builder que
  confirma que la observación no contiene el id/UUID de origen ni
  palabras técnicas ("id", "uuid", "entityId", "entityType", "código",
  nombres de modelo), y los tests existentes se actualizaron para
  esperar el nuevo copy ("Origen: alerta del fichador...", "Las horas
  reales se mantienen según fichador/carga horaria.") en vez del texto
  con id técnico.
- `frontend/src/components/novelties/NoveltyModal.test.tsx` — sin cambios
  en esta vuelta (ya cubría precarga, fallback de tipo sugerido, y
  funcionamiento con empleado mínimo).
- `frontend/src/pages/NotificationsPage.test.tsx` (ampliado) — una
  notificación `ALERTA_FICHADA` con `employee` muestra "Crear novedad";
  **una notificación `SIN_ACTIVIDAD_REGISTRADA` ("no asistió") con
  `employee` también la muestra** (test nuevo, prueba directamente el
  enriquecimiento de backend de esta versión); una notificación sin
  `employee` (`CIERRE_MENSUAL`) no la muestra; el click en cada caso
  precarga empleado/fecha/observación sin sugerir tipo y sin llamar a
  `employeeApiService.getById`; guardar usa el flujo normal
  (`noveltyApiService.create`) y no marca la notificación como leída.
  **Ajuste UX (§3.3):** los tests de click-through ahora usan un `id` de
  notificación con forma de UUID real y afirman explícitamente que ese
  UUID no aparece en el modal.
- `frontend/src/pages/ShiftAlertsPage.test.tsx` (ajustado) — se quitó por
  completo el describe de "Crear novedad" (4 tests) y se reemplazó por uno
  nuevo que confirma la ausencia: ningún texto "Crear novedad" en la fila
  principal ni en los hallazgos secundarios de un grupo, y que el resto de
  las acciones (Ver legajo, Ver turno, Resolver) siguen intactas.
- `frontend/src/pages/AttendancePage.test.tsx` — **ajuste UX (§3.3):** los
  dos tests que verificaban la observación precargada (ausencia y falta de
  fichada) ahora esperan el nuevo copy humano y afirman que el id técnico
  del incidente/jornada (`incident-1`, `shift-falta-salida`) ya no aparece
  en el modal.

Validaciones: backend `npx prisma validate` + `npm run typecheck` +
`npm test` (105 archivos, 1541 tests) + `npm run build`, todos sin
errores (backend no se tocó en el ajuste UX de este apartado, se
revalidó igual por prudencia en la etapa previa). Frontend `npm test`
(85 archivos, 839 tests tras el ajuste UX, todos en verde),
`npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.e2e.json --noEmit`
y `npm run build`, todos sin errores.
