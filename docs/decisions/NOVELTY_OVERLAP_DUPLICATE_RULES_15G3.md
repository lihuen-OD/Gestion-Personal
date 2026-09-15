# Etapa 15G.3 — Duplicados y solapamientos entre Novedades

## 1. Contexto

Las etapas 15G/15G.1/15G.2 dejaron cerrado que Novedades es sólo
justificación administrativa (nunca crea/modifica `TimeEntry`, ver
`NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md`) y que Notificaciones
es el flujo principal para crear una novedad desde una anomalía del
fichador (`ALERT_TO_NOVELTY_FLOW_15G2.md`). Ambas etapas dejaron
explícitamente documentado el mismo gap, sin resolverlo:

> "El tratamiento de solapamientos de novedades continúa pendiente de
> definición de negocio." (`docs/PROJECT_CONTEXT.md`)
>
> "Deduplicación robusta. No se agregó ninguna validación de 'ya existe
> una novedad para este empleado/fecha/tipo' [...] Queda para 15G.3."
> (`ALERT_TO_NOVELTY_FLOW_15G2.md`, §6)

Un test dedicado (`novelties.service.test.ts`) documentaba el gap a
propósito: creaba dos novedades del mismo tipo, mismo empleado y rangos
de fecha solapados, y afirmaba que **ambas se creaban sin ningún error**
— ese test se reemplazó en esta etapa por la suite que fija la regla
nueva (ver §8).

Esta etapa primero audita el modelo actual (`Novelty`/`NoveltyType`) para
decidir qué se puede resolver con seguridad, y sólo implementa lo que esa
auditoría respalda — no inventa una matriz de compatibilidad entre tipos
que el modelo no tiene.

## 2. Diferencia entre duplicado y solapamiento

Se definen dos niveles, ambos acotados a **la misma persona + el mismo
`NoveltyType`** (nunca se compara contra un tipo distinto — ver §5):

- **Duplicado (`NOVELTY_DUPLICATE`)**: existe otra novedad activa del
  mismo tipo, para el mismo empleado, con el **mismo rango de fechas**
  (comparando `fromDate`/`toDate` normalizados — `toDate` nulo se trata
  como si fuera igual a `fromDate`, de los dos lados de la comparación).
  Es literalmente cargar dos veces la misma justificación.
- **Solapamiento (`NOVELTY_OVERLAP`)**: existe otra novedad activa del
  mismo tipo, para el mismo empleado, cuyo rango se superpone
  **parcialmente** con el nuevo (no son el mismo rango, pero comparten al
  menos un día). Ejemplo: "Vacaciones 10-15" ya cargada y se intenta
  cargar "Vacaciones 13-20" para la misma persona.

Los dos bloquean la creación (409), sólo cambia el código de error y el
texto del mensaje — ver §7.

## 3. Estados que cuentan/no cuentan

`Novelty.status` usa el enum compartido `ApprovalStatus` (7 valores:
`BORRADOR, PENDIENTE, EN_REVISION, APROBADO, RECHAZADO, DEVUELTO,
CERRADO`), pero el flujo real de `novelties.service.ts` sólo asigna
`PENDIENTE`, `APROBADO` y `RECHAZADO` — los otros 4 valores nunca se
escriben hoy sobre una `Novelty` (son valores del enum compartido con
`TimeEntry.status`, no alcanzables desde este módulo).

Regla adoptada: **todo estado cuenta como activo para el chequeo, excepto
`RECHAZADO`**. Es decir, `PENDIENTE` y `APROBADO` siempre bloquean; una
novedad `RECHAZADA` nunca bloquea. Justificación:

- `RECHAZADO` es un rechazo firme de RRHH — no tiene sentido que una
  justificación denegada impida volver a intentarla.
- `PENDIENTE` y `APROBADO` representan una justificación vigente (todavía
  en revisión o ya confirmada) — ambas deben impedir un duplicado o un
  solapamiento del mismo tipo.
- `BORRADOR`/`EN_REVISION`/`DEVUELTO`/`CERRADO` son inalcanzables hoy; se
  incluyen en el lado "bloquea" por ser la opción conservadora (evita que,
  si alguna vez se usan, coexistan silenciosamente con un duplicado) y no
  cambia ningún comportamiento observable actual.

## 4. Reglas implementadas

- **Alcance**: sólo compara contra el **mismo `noveltyTypeId`**, para el
  **mismo `employeeId`**. Nunca compara contra un tipo distinto.
- **Condición de solapamiento** (`novelties.repository.ts::findOverlapping`):
  `existente.fromDate <= nuevo.rangeEnd` Y
  (`existente.toDate` es null y `existente.fromDate >= nuevo.fromDate`,
  O `existente.toDate >= nuevo.fromDate`) — donde `nuevo.rangeEnd` es
  `nuevo.toDate` si existe, sino `nuevo.fromDate` (mismo criterio para el
  lado existente).
- **Exclusión**: `status != RECHAZADO` (ver §3).
- **Dónde corre**: dentro de `noveltiesService.create()`, después de
  `assertCanLoad` (para no revelar el conflicto antes de confirmar
  permisos) y antes de `createMany` — si hay conflicto, no se crea nada.
- **Carga masiva** (`employeeIds` con más de un legajo): la consulta se
  hace para todos los empleados del payload en una sola query
  (`findOverlapping(employeeIds, ...)`). Si **cualquiera** tiene un
  conflicto, se rechaza **todo el lote** — nunca se crea parcialmente el
  resto en silencio.
- **Distinción de código**: si el rango del conflicto es exactamente
  igual al nuevo → `NOVELTY_DUPLICATE`; si sólo se superpone →
  `NOVELTY_OVERLAP`. Ambos, 409.

## 5. Reglas NO implementadas por falta de semántica suficiente

`NoveltyType` no tiene ningún campo que exprese incompatibilidad entre
dos tipos distintos (no existe `excludesTypeId`, ni una matriz
kind↔kind, ni nada equivalente). `kind` es una clasificación libre de 7
valores (`AUSENCIA, LICENCIA, HORARIA, ACCIDENTE, VACACIONES, SANCION,
OTRO`) sin reglas de convivencia definidas en ningún lado del código ni
de la documentación previa.

Por eso, **esta etapa no bloquea nada entre tipos distintos**, aunque se
superpongan en fecha:

- Ausencia (día completo) + Llegada tarde (horaria) el mismo día.
- Vacaciones + Licencia médica con rangos superpuestos.
- Cualquier combinación de dos `NoveltyType` distintos.

Inventar esa regla a partir del nombre o del `kind` del tipo (por
ejemplo, "todo lo que tenga `kind=AUSENCIA` bloquea cualquier otra cosa
ese día") sería una decisión de negocio nueva sin respaldo en el modelo
actual — exactamente lo que esta etapa tiene prohibido hacer. Ver §10
para cómo desbloquear esto en una etapa futura.

## 6. Ejemplos

- **Llegada tarde duplicada** (mismo tipo, mismo día, dos veces): la
  segunda carga de "Llegada tarde" para el mismo empleado el mismo día
  se bloquea con `NOVELTY_DUPLICATE` — sin importar si la cantidad de
  horas declarada es distinta (1h vs. 2h): sigue siendo el mismo tipo, el
  mismo día, para la misma persona.
- **Ausencia (día completo) + Llegada tarde**: **no se bloquea** — son
  dos `NoveltyType` distintos y el modelo no permite decidir con
  seguridad si son incompatibles (ver §5). Queda como caso a resolver en
  una etapa futura si se define una matriz de compatibilidad real.
- **Vacaciones 10-15 + Licencia médica 13-14**: **no se bloquea** — mismo
  motivo que el caso anterior (tipos distintos). Si en cambio fuera
  "Vacaciones 10-15" + "Vacaciones 13-20" (mismo tipo), sí se bloquea con
  `NOVELTY_OVERLAP`.
- **Rechazada + nueva**: si la única novedad previa de ese
  tipo/empleado/rango está `RECHAZADA`, la nueva carga se permite sin
  ningún error — el rechazo no deja rastro bloqueante.

## 7. Mensajes UX

Sin IDs técnicos, UUIDs, `entityId`/`entityType` ni el `id` de la
`Novelty` en conflicto — sólo el nombre del tipo y el/los legajo(s)
afectados (el legajo es el identificador humano que ya se muestra en
toda la app, no un id técnico):

- Duplicado: `Ya existe una novedad "{tipo}" para el legajo {legajo} en
  la fecha seleccionada.`
- Solapamiento: `Ya existe una novedad "{tipo}" para el legajo {legajo}
  que se superpone con el rango de fechas seleccionado.`
- Con varios legajos en conflicto en una carga masiva, se listan todos:
  `... para los legajos {legajo1}, {legajo2} ...`.

El backend (`AppError.message`) ya arma este texto completo — el
frontend no lo reconstruye. En `frontend/src/services/api/apiClient.ts`,
`NOVELTY_DUPLICATE`/`NOVELTY_OVERLAP` se dejan **deliberadamente afuera**
de `errorMessagesByCode` (ese mapa tiene prioridad sobre el mensaje crudo
del backend en `formatApiErrorMessage`) para no pisar el texto específico
con uno genérico. En `NoveltyModal.tsx`, el `catch` de guardado detecta
estos dos códigos (`apiError instanceof ApiError && ...`) y muestra
`apiError.message` tal cual, sin reimplementar la regla en el cliente.

## 8. Tests

**Backend:**

- `novelties.repository.test.ts` — nuevo describe
  `findOverlapping`: verifica el `where` (`employeeId: {in}`,
  `noveltyTypeId`, `status: {not: "RECHAZADO"}`, la condición de rango
  con `toDate` nulo tratado como `fromDate`) y el `select` mínimo
  (`id, fromDate, toDate, employee.legajo` — nunca DNI/CUIL ni el
  empleado completo).
- `novelties.service.test.ts` — reemplaza el test que documentaba el gap
  por un nuevo describe (`Etapa 15G.3`) con los casos: mismo
  empleado/tipo/día PENDIENTE bloquea; mismo caso APROBADO bloquea;
  RECHAZADO permite; mismo tipo/distinto empleado permite; mismo
  empleado/distinto tipo permite; rango idéntico bloquea
  (`NOVELTY_DUPLICATE`); rango solapado no idéntico bloquea
  (`NOVELTY_OVERLAP`, código distinto del anterior); rangos no
  solapados permite; carga masiva con un empleado en conflicto bloquea
  todo el lote sin crear nada; el mensaje incluye legajo(s) y nombre del
  tipo y nunca un id/UUID técnico; el chequeo de scope de empleado corre
  antes que el de overlap (no se filtra información a quien no tiene
  acceso al legajo). Los tests preexistentes de 15G.1/15G.2
  (`allowedLoadRoles`, `approvalRoles`, "Novedades no toca TimeEntry")
  no se tocaron y siguen en verde.

**Frontend:**

- `NoveltyModal.test.tsx` — nuevo describe (`Etapa 15G.3`): confirma que
  `NOVELTY_DUPLICATE`/`NOVELTY_OVERLAP` muestran el mensaje específico
  del backend (no el genérico), que ese mensaje no contiene ningún
  id/UUID técnico, y que el resto de los códigos de error siguen
  mostrando el mensaje genérico existente (sin regresión).

Validaciones: backend `npx prisma validate` + `npm run typecheck` +
`npm test` (105 archivos, 1556 tests) + `npm run build`, todos sin
errores. Frontend `npm test` (85 archivos, 842 tests), `tsc` (app y e2e)
y `npm run build`, todos sin errores.

## 9. Riesgo residual

- **Incompatibilidad semántica entre tipos distintos sin resolver** (ver
  §5) — sigue siendo posible cargar, para el mismo empleado y el mismo
  día, dos novedades de tipos diferentes que en la práctica son
  incompatibles (p. ej. una ausencia de día completo y una llegada
  tarde). No es un bug de esta etapa: es la deuda que esta etapa acota y
  documenta en vez de resolver con una regla inventada.
- **Condición de carrera de baja probabilidad**: `findOverlapping` corre
  fuera de la transacción de `createMany` — dos requests concurrentes
  para el mismo empleado/tipo/rango, ambos pasando la validación antes de
  que cualquiera termine de insertar, podrían crear un duplicado real en
  una ventana muy angosta. Es el mismo patrón de riesgo que ya existe en
  el resto del proyecto para checks de "no duplicado" (p. ej.
  `TIME_ENTRY_DUPLICATED` en `time-entries`), no una regresión introducida
  por esta etapa ni algo que se resuelva agregando un `@@unique` sin
  antes decidir la semántica de "duplicado" a nivel base de datos
  (`toDate` nulo, `RECHAZADO` excluido, etc. no son expresables en una
  constraint simple).
- **`employeeIds` repetido dentro del mismo payload**: si el propio
  request incluye el mismo `employeeId` dos veces, `findOverlapping` no
  lo detecta (todavía no existe ninguna fila en la base al momento de la
  consulta) y `createMany` seguiría creando dos filas idénticas en la
  misma llamada — comportamiento preexistente, no introducido ni agravado
  por esta etapa, fuera de alcance (el frontend ya envía `employeeIds`
  sin duplicados vía selección múltiple).

## 10. Próxima etapa sugerida

Si en el futuro se necesita bloquear combinaciones entre tipos distintos
(caso "Ausencia + Llegada tarde" o "Vacaciones + Licencia"), la etapa
siguiente debería primero **definir una matriz de compatibilidad real**
(por ejemplo, un campo explícito en `NoveltyType` — algo como un flag de
"exclusivo del día" o una tabla de exclusión tipo↔tipo) con la decisión
de negocio correspondiente, y sólo después extender `ensureNoOverlap`
para consultarla — nunca inferirla del `kind` o del nombre del tipo.
