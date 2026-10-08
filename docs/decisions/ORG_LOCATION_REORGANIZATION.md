# Reorganización — Organización, Ubicaciones, Puestos y Legajos

Fecha: 2026-10-07
Estado: **plan aprobado como base; en desarrollo en la rama `feat/org-location-reorg`, sin aplicar a ninguna base ni desplegar.** Avance por etapa en §11. Mientras §11 no indique otra cosa, el modelo vigente en las bases (development, producción) es el de §2.
Reemplaza, cuando se implemente: las secciones "Organizational hierarchy" y "Position: sectorId…" de `docs/DATABASE_STANDARDS.md` (hoy marcadas como modelo actual en transición).

Marcas usadas: **[H]** = hecho comprobado en código o esquema · **[P]** = propuesta aprobada como plan, no implementada · **[D-n]** = decisión pendiente.

## 1. Problema

El modelo actual encadena organización y lugar físico (`Company → BusinessUnit → Establishment → Area → Sector`) y ubica cada puesto con un único `Position.sectorId`. Eso no representa al negocio:
- Un director puede abarcar varias empresas y no tener un sector.
- Un gerente puede abarcar varias unidades de negocio.
- Una persona puede trabajar en varias zonas y establecimientos.

El objetivo es separar cuatro conceptos:
1. **Organización:** Empresa → Unidad de negocio → Sector → Área.
2. **Ubicación:** Zona → Establecimiento.
3. **Puestos:** definen función y alcance organizativo.
4. **Legajos:** asignan el puesto a una persona y registran sus ubicaciones de trabajo.

El encargado directo sigue definiendo la dependencia entre personas.

## 2. Modelo actual — vigente en código y base [H]

| Modelo | Padre(s) | Nota |
|---|---|---|
| Company | — | `name`, `code` únicos |
| BusinessUnit | `companyId` (obligatorio) | `@@unique([companyId, code])` |
| Establishment | `companyId` (obligatorio) **y** `businessUnitId?` | Dos padres. Tiene domicilio |
| Area | `establishmentId?` | `code` único global |
| Sector | `areaId?` | `code` único global |
| Position | `sectorId?` | Misión, descripción, 7 columnas JSON, `PositionSalaryCategory` |
| Employee | `positionId?`, `sectorId?`, `costCenterId?` | Categoría interna/recibo, convenio y obra social en texto libre |
| EmployeeCompany | employee `Restrict`, company **`Cascade`** | Empresa empleadora + `isPrimary` |
| EmployeeAssignment | — | `DIRECT_MANAGER` / `TIME_RESPONSIBLE`, varios por tipo, `personName` y/o `userId` |
| CostCenter + `CostCenterCompany/BusinessUnit/Establishment/Area/Sector` | M:N contra los 5 niveles, **`Cascade`** | |

### 2.1 `onDelete` de las FKs hacia la estructura

El SQL de las migraciones coincide con `schema.prisma`.

- **SET NULL** (se pierde el dato sin error):
  - `User.companyId/sectorId`
  - `Employee.positionId/sectorId/costCenterId`
  - `Position.sectorId`, `Area.establishmentId`, `Sector.areaId`, `Establishment.businessUnitId`
  - `ClockDevice.sectorId`
  - **`DoubleHourRule.companyId/sectorId/costCenterId/positionId`**
- **CASCADE:** `EmployeeCompany.companyId`, `PositionSalaryCategory.*`, los 5 `CostCenter*`.
- **RESTRICT:** `BusinessUnit.companyId`, `Establishment.companyId`.

**Sin FK a la estructura:** `TimeEntry`, `WorkShift`, `AttendancePunch`, `Novelty`, `LaborMovement`, documentos y cierres. **Copias en texto** que no siguen renombres ni borrados: `EmployeeFieldHistory`/`EmployeeBlockHistory` (nombres), `AuditLog` (JSON) y `FinnegansExportBatchItem.costCenter`.

### 2.2 Comportamiento relevante

- **Permisos.**
  - No dependen de la estructura. `employeeAccessWhere` (`backend/src/modules/employees/employeeAccess.ts`) limita Supervisión y Carga horaria a legajos con un `EmployeeAssignment` `TIME_RESPONSIBLE` vigente para el usuario.
  - `User.companyId/sectorId` solo se usan en la clave de caché del dashboard.
- **Horas especiales.**
  - `doubleHourRuleScopeWhere` (`backend/src/modules/time-entries/timeEntries.repository.ts`) compara empresa, sector, centro de costo y puesto de la regla con los **actuales** del legajo. `null` en la regla significa "sin restricción".
  - La reinterpretación (`workforce-management/specialHourReinterpretation.ts`) recalcula horas pasadas y reconstruye snapshots de cierres con ese alcance actual.
- **Auditoría.** `auditService.register` escribe con el cliente global, fuera de cualquier transacción. Si falla, solo loguea y sigue (no relanza el error), y limpia cachés en memoria.
- **Historial de datos laborales.** Lo escribe el cliente en una segunda llamada, de forma no atómica.
- **Borrado de puestos.** Un puesto sin personas se borra físicamente aunque una `DoubleHourRule` lo referencie, y el SET NULL **amplía** esa regla.
- **Frontend.**
  - Sector, centro de costo y empresa del legajo se resuelven **por nombre** contra el catálogo.
  - El organigrama funcional se arma por `personName` del encargado directo.
  - El filtro de Nivel 2 por sector en el organigrama compara nombre contra ID.

## 3. Modelo objetivo — NO implementado [P]

Cada nodo tiene **un único padre obligatorio**. No se introducen padres múltiples porque no hay una necesidad de negocio comprobada. Todos conservan `code`, `status`, timestamps y auditoría.

```
ORGANIZACIÓN                      UBICACIONES
Company                           Zone (nueva)
 └─ BusinessUnit (companyId)        └─ Establishment (zoneId, domicilio)
     └─ Sector (businessUnitId)
         └─ Area (sectorId)

Position ─ PositionOrgScope[] ─► {Company | BusinessUnit | Sector | Area}
Employee ─ positionId ─► Position        (el alcance se LEE del puesto; no se copia)
Employee ─ EmployeeCompany[] ─► Company  (empresa empleadora; distinta del alcance)
Employee ─ EmployeeWorkLocation[] ─► Zone ─ establishments[] ─► Establishment
Employee ─ EmployeeAssignment[]          (encargado directo / responsable de carga; sin cambios)
Employee ─ costCenterId ─► CostCenter    (sin cambios)
```

### 3.1 Árboles
- **Tablas existentes que se reutilizan con padres nuevos:**
  - Sector: `+businessUnitId`, `−areaId`.
  - Area: `+sectorId`, `−establishmentId`.
  - Establishment: `+zoneId`, `−companyId`, `−businessUnitId`.
  - `Zone` es nueva.
- **Árboles independientes:** cada uno se administra sin depender del otro. Un establecimiento **no tiene empresa**, porque la propiedad legal del lugar no equivale al alcance del puesto [D-10].
- **FKs nuevas `Restrict`:** borrar un nodo con hijos o referencias devuelve 409, sin `SetNull` silencioso.
- **Cambio de padre** de un nodo en uso: se bloquea y se muestra el impacto (D-9, **ratificada** el 2026-10-07). Si hace falta reorganizar nodos en uso, se resolverá con una operación explícita que contemple sus referencias.

### 3.2 Alcance organizativo del puesto
- **`PositionOrgScope`:** `positionId`, `level` (`COMPANY|BUSINESS_UNIT|SECTOR|AREA`) y exactamente una FK no nula, garantizado por un CHECK SQL. Índices únicos parciales y FKs Restrict.
- **Selección por nivel:** se pueden elegir varios alcances, deteniéndose en el nivel que corresponda, sin completar los niveles inferiores.
- **Un nodo abarca a sus descendientes.** La cobertura se calcula al leer y no se materializa, así que un descendiente agregado después queda incluido sin editar el puesto. La UI lo indica.
- **Sin redundancia:** el backend rechaza un par ancestro/descendiente (`POSITION_SCOPE_REDUNDANT`). La UI marca los descendientes como "incluido por X".
- **Nodos no válidos:** no se aceptan zonas ni establecimientos. Los nodos inactivos no se pueden elegir de nuevo.
- **Contenido conservado:** misión, responsabilidades, relaciones, competencias, condiciones, indicadores, criterios y `PositionSalaryCategory`.
- **Ocupantes:** el puesto no guarda nombres de personas; los ocupantes salen de Legajos.
- **Todos los ocupantes de un puesto comparten exactamente su alcance.** No hay alcance individual.
  - Dos personas con la misma función y distinto alcance necesitan **puestos distintos**.
  - Ejemplos: un Director para O'Dwyer + Tropa del litoral y otro para Brasita de Fuegos; gerentes por conjunto de UN; encargados por sector.
  - Qué funciones necesitan variantes es una decisión pendiente [D-6].

### 3.3 Legajo / Datos laborales
Bloques de la pantalla:
- **A. Puesto y alcance:** el alcance se muestra solo lectura, desde el puesto.
- **B. Ubicaciones de trabajo.**
- **C. Categorías y datos laborales:** se conservan.
- **D. Responsables:** encargado directo y responsable de carga horaria siguen como conceptos distintos, con varios por tipo, sin cambios.

Ubicaciones:
- **Estructura:** `EmployeeWorkLocation` (zona, vigencia, motivo) con sus establecimientos (`EmployeeWorkLocationEstablishment`). Cada asignación vincula una zona con establecimientos de esa zona, sin listas independientes.
- **Vigencia:** intervalo cerrado de días `[effectiveFrom, effectiveTo]`, con `effectiveTo` nulo = abierto. Se calcula con `argentinaTime.ts`.
- **Sin superposición por persona y zona, incluidas las futuras:**
  - En base: constraint de exclusión `btree_gist`.
  - En servicio: validación con un error legible.
  - Zonas distintas sí pueden superponerse.
- **Cambio desde la fecha D:** se cierra la vigente en `D − 1` y se abre la nueva en `D`, en una transacción.
- **Escritura:** filas, historial visible y auditoría se escriben en **la misma transacción**.

Se retira `Employee.sectorId`. Se conservan la empresa empleadora (`EmployeeCompany`), las categorías interna y de recibo, el convenio, la obra social, el centro de costo, las fechas desde, los motivos y todo el historial.

### 3.4 Filtros, organigrama y reportes
- **"Ubicado dentro"** de un nodo N: algún alcance del puesto es N o un descendiente de N.
- **"Cubre"** N: algún alcance es N o un ancestro de N. Modo por defecto y su combinación: [D-7].
- **Sin duplicar:** siempre con `some`/EXISTS. Un legajo con varios alcances o ubicaciones aparece una sola vez, y sus horas no se multiplican (`TimeEntry` no tiene ubicación).
- **Organigrama funcional:** sigue por encargado directo. Al filtrar, se proponen como contexto los superiores por línea de encargado y una banda separada "Alcance superior" para quienes cubren el nodo [D-7].
- **Vista por categorías:** es salarial y no reemplaza la jerarquía.
- **Reportes por ubicación:** dotación "no sumable". No se reparten horas ni se generan imputaciones automáticas.

### 3.5 Transacciones y efectos laterales
- **Auditoría transaccional obligatoria** para la limpieza y para los endpoints nuevos, con una variante `auditRepository.create(data, db)`.
  - Si la auditoría falla, la operación se revierte.
  - El código existente no se modifica en este proyecto.
- **Fuera de la transacción, siempre después del commit:** limpieza de cachés en memoria.
- **Nunca dentro de la transacción:** reinterpretación de horas, notificaciones, llamadas externas.

## 4. Estado de las decisiones

**Acordado expresamente:**
- Separar Organización y Ubicaciones. El puesto define el alcance; el legajo asigna puesto y ubicaciones.
- No migrar correspondencias. La información anterior está conservada en PDF/ZIP y se recarga a mano con la organización correcta.
- Alcance de la limpieza en **development**: §5.
- Trabajar y ensayar en una **copia aislada** antes de tocar development.
- No tocar producción.
- **D-9 (2026-10-07):** bloquear el cambio de padre de nodos en uso. Reorganizar nodos en uso requerirá una operación explícita que contemple sus referencias.

**Respuestas preliminares, a ratificar (no vigentes):**
- [D-1] **Empresas:** se respondió "conservar Company".
  - El 2026-10-07 el usuario reiteró que la limpieza **puede incluir** las empresas actuales, porque se recargan.
  - Ambas opciones están autorizadas; falta elegir C1 o C2 (efectos en §5.2). El inventario de A3 cuantifica las dos.
- [D-2] **Ubicaciones:** solo establecimientos explícitos, sin "zona completa".
- [D-3] **Rastro de la limpieza:** solo `AuditLog`, sin filas en el historial visible del legajo.

**Pendientes:**

| Id | Decisión | Bloquea |
|---|---|---|
| D-0 | Identidad de la rama development vía Neon API (credencial de solo lectura); si "staging" en la documentación es la misma base; ventana sin escrituras | Ejecución (B) |
| D-1 | Conservar (C1) o eliminar (C2) Company; confirmar que se eliminan las UN | B |
| D-3 | Rastro visible en historial del legajo | B |
| D-4 | Semántica del sector en `DoubleHourRule` (S1-S5) y tratamiento de cada regla existente (R1-R3). **Se decide con el inventario y el reporte de impacto, nada se adopta automáticamente** | B y A7 |
| D-5 | Recálculo histórico ante cambios de alcance o puesto (H1-H3), con el mismo reporte | B y A7 |
| D-2 | Zona completa en ubicaciones. A6 implementó sólo establecimientos explícitos; una selección vacía se rechaza y nunca significa "todos" | Ampliación de ubicaciones |
| D-6 | Funciones que necesitan puestos distintos por alcance | A5 |
| D-7 | Modo de filtrado por defecto; banda "Alcance superior" en el organigrama. A7 implementó ambos modos sin valor por defecto en Legajos/Organigrama (Puestos usa `WITHIN` inicial); ejemplos en §16.4 | Cierre de A7 |
| D-8 | Reemplazo de "Dotación por sector" (hoy rotulada "por sector anterior"; opciones en §16.4) | Cierre de A7 |
| D-10 | Empresa propietaria de un establecimiento | — |
| D-11 | Múltiples encargados en la vista funcional (hoy se usa el primero; no se cambia en silencio) | — |
| D-12 | Merge y despliegue frente a producción | B5 |
| D-13 | Unicidad del código de establecimiento tras M2: hoy es `@@unique([companyId, code])` y M2 elimina `companyId` (§17.2) | A8/M2 |
| D-14 | Alcance de usuarios (`User.companyId/sectorId`): retirar, conservar sólo la empresa o reemplazarlo por un nodo nuevo. No interviene en permisos hoy (§17.2) | A8/M2 |
| D-15 | Ubicación de dispositivos de fichado: establecimiento del árbol de ubicaciones en lugar de sector (§17.2) | Etapa de fichador, antes de M2 |

## 5. Alcance autorizado de la limpieza y protecciones

### 5.1 Autorización (solo development, solo registros del modelo anterior)

**Autorizado:**
- Eliminar los registros actuales de la estructura organizativa y los puestos actuales.
- Limpiar los vínculos organizativos, de ubicación y de puesto de los legajos que sean incompatibles con el modelo nuevo.

La autorización alcanza **a los registros del modelo anterior** (un inventario de IDs congelado antes de ejecutar), **no** a los registros nuevos que se carguen después.

**No autorizado:**
- Eliminar legajos o cambiar sus IDs.
- Borrar horas, novedades, documentos, movimientos laborales, historiales u otros registros relacionados con las personas.
- Limpiar toda la base.
- Modificar producción.
- Usar CASCADE como atajo.
- Borrar información dependiente fuera de este alcance.
- Borrar una `DoubleHourRule`: eliminaría su traza `SpecialHourRuleApplication` y reinterpretaría horas.

Se conservan los datos laborales compatibles (categorías, convenio, obra social y demás campos independientes) y, cuando sea posible, los encargados y responsables.

### 5.2 Tablas y campos afectados

**Siempre** (sujeto a §6):

| Acción | Tabla.campo |
|---|---|
| UPDATE → NULL | `Employee.positionId`, `Employee.sectorId`, `User.sectorId`, `ClockDevice.sectorId` |
| DELETE | `PositionSalaryCategory`; `CostCenterBusinessUnit/Establishment/Area/Sector` (filas del inventario) |
| DELETE | `Position`, `Sector`, `Area`, `Establishment`, `BusinessUnit` (en ese orden; borrado explícito para que ningún CASCADE/SET NULL se dispare) |
| INSERT | `AuditLog`, en la misma transacción, con actor humano |

**Según [D-1]:**
- **C1 — conservar Company:** se mantienen `Company`, `EmployeeCompany`, `User.companyId`, `CostCenterCompany` y `DoubleHourRule.companyId`.
- **C2 — eliminar Company:** se borran explícitamente `EmployeeCompany` y `CostCenterCompany`, y `User.companyId` pasa a NULL. `DoubleHourRule.companyId` se trata según §6, nunca con NULL. La empresa empleadora queda vacía hasta la recarga.

**Nunca se tocan:**
- Legajos (IDs y demás columnas), `costCenterId`, categorías, convenio, obra social, `EmployeeAssignment`.
- Historiales, horas, desgloses, novedades, documentos, movimientos, fichadas, cierres, exportaciones Finnegans.
- `SalaryCategory`, `CostCenter`.

### 5.3 Compuertas de ejecución

Si alguna falla, el script aborta:
1. **Identidad de rama comprobada vía Neon API** (endpoint del host → `branch_id` → rama esperada). Un flag de confirmación o `APP_ENV` no son evidencia suficiente. Además se rechaza `production`.
2. **Inventario congelado** coincidente. Ningún registro fuera del inventario puede depender de uno a borrar.
3. **Horas especiales:** cada regla que referencie un ID a borrar o a vaciar tiene una decisión R1/R2/R3 aplicada. Si tras el tratamiento queda alguna referencia, se aborta antes de borrar.
4. **Actor humano** y ventana sin escrituras (backend detenido).

### 5.4 Verificación por ID y contenido

- **Manifiesto previo:** `id → hash(contenido)` de todas las tablas. En `Employee` se separa un hash personal/protegido de los valores laborales.
- **V1 — tras la limpieza:** cambian **solo** los campos y registros autorizados.
  - En `Employee` solo cambian `positionId`/`sectorId` de los legajos del inventario, con hash personal idéntico.
  - Borrados: solo IDs del inventario.
  - Reglas: solo lo decidido.
  - `AuditLog`: solo filas nuevas.
  - Toda otra tabla queda idéntica por ID y contenido.
  - Reconciliación de horas especiales en dry-run: 0 cambios.
- **V2 — tras la recarga:**
  - **Permitido:** cambios laborales **explícitos y auditados** (cada cambio con su `AuditLog`) y filas nuevas.
  - **Siempre idéntico por ID y contenido:** datos personales y todo registro protegido preexistente.
  - No se exige igualdad de totales.

## 6. Horas especiales (`DoubleHourRule`)

**La dimensión sector se mantiene**, porque el modelo nuevo sigue teniendo sectores. Falta decidir cómo un legajo "pertenece" a un sector [D-4]:

| Opción | Pertenencia | Efecto en puestos con alcance múltiple |
|---|---|---|
| S1 | El puesto está ubicado dentro del sector | Recibe la regla si cualquiera de sus alcances cae dentro |
| S2 | El puesto cubre el sector | Directores y gerentes reciben las reglas de todo lo que cubren |
| S3 | Ambos | La más amplia |
| S4 | Sector propio en el legajo | Reintroduce un dato por persona |
| S5 | Lista explícita de legajos | Congela la membresía |

**Recálculo histórico** [D-5]. Hoy la reinterpretación usa el alcance actual contra fechas pasadas y reconstruye cierres:
- **H1:** aceptarlo.
- **H2:** evaluación con vigencias.
- **H3:** excluir períodos cerrados.

**Reglas existentes que referencian estructura vieja.** Inactivar una regla **no libera** su referencia, porque M1 lleva estas FKs a `RESTRICT`. Formas válidas:
- **R1 — Reasignar** al destino nuevo, cargado antes de borrar el viejo.
- **R2 — Convertir** a lista explícita de legajos que hoy la cumplen, solo si la lista **no** queda vacía; recién después se quita la dimensión.
- **R3 — Retener** el destino viejo, excluyéndolo de la limpieza; M2 queda bloqueada hasta resolverlo.

La inactivación solo puede **combinarse** con R1, R2 o R3. **Nunca se deja una restricción en NULL**, porque ampliaría la regla.

**Alcance de R1 (aclaración de A8, 2026-10-08):** R1/R2/R3 son tratamientos de **referencias de catálogo** (`DoubleHourRule`). **No aplican a referencias históricas**: una empresa (u otro registro) referenciado por las tablas de vigencias de §19 **conserva su ID**, no se reasigna su FK y no se borra su historia; si el modo de limpieza exige eliminarlo, la limpieza **aborta** (en particular C2 con una empresa referenciada por historia), salvo una redefinición posterior y aprobada que conserve explícitamente esas empresas.

**Inventario previo obligatorio.** Antes de modificar cualquier lógica de cálculo se obtiene, con consultas de solo lectura en la copia aislada, el inventario de reglas afectadas: alcance, legajos alcanzados, horas, desgloses, trazas y cierres donde ganaron. Con él se presenta el impacto concreto de cada S, H y R.

## 7. Migraciones y despliegue

- **M1 — expansión, sin modificar datos.** No es solo aditiva:
  - **Agrega:**
    - tablas `Zone`, `PositionOrgScope`, `EmployeeWorkLocation`, `EmployeeWorkLocationEstablishment`;
    - columnas nulas `Sector.businessUnitId`, `Area.sectorId`, `Establishment.zoneId`, `ClockDevice.establishmentId`, con FKs Restrict;
    - CHECKs, `btree_gist` y la exclusión de superposición de ubicaciones.
  - **Relaja:** `Establishment.companyId` pasa a admitir NULL.
  - **Endurece:** las FKs de `DoubleHourRule` pasan de SET NULL a RESTRICT.
  - El código actual sigue funcionando. El código nuevo (A2-A7) también funciona sobre M1.
- **M2 — contracción, destructiva sobre el esquema.**
  - Elimina las columnas del modelo anterior y vuelve obligatorios los padres nuevos.
  - Empieza con una guarda SQL que aborta antes de cualquier DDL si queda un valor viejo.
  - Solo se revierte restaurando un respaldo.
- **Separación M1/M2:** `prisma migrate deploy` aplica todas las migraciones pendientes y no permite elegir una. Por eso la separación es por versión de código:
  - **`reorg-r1`:** código A2-A7 y migraciones hasta M1. **Sin M2.**
  - **`reorg-r2`:** agrega A8 y M2.
  - Antes de cada `migrate deploy` se ejecuta `prisma migrate status` en solo lectura.
- **Límites:**
  - La guarda de M2 solo comprueba esos valores.
  - Una guarda fallida deja la migración registrada como fallida y bloquea despliegues hasta `prisma migrate resolve`.
  - El código nuevo requiere la estructura reorganizada en cada entorno, así que **producción queda fuera de alcance** sin una autorización propia [D-12].

## 8. Etapas

**A — desarrollo local, contra una copia aislada; nunca contra development.**
- La copia es una rama Neon creada desde development, con la conexión en un archivo local no versionado.
- Antes de cada comando que escriba esquema o datos, se verifica que el host **no** sea el de development.

| Etapa | Contenido |
|---|---|
| A1 | Este ADR y la actualización de normas |
| A2 | M1, backend de árboles, auditoría transaccional, protección del borrado de puestos |
| A3 | Herramientas de datos: manifiesto, verificador V1/V2, inventario de reglas de solo lectura, script de limpieza con compuertas, restauración dirigida |
| A4 | UI Organización y Ubicaciones |
| A5 | Alcance de puestos |
| A6 | Datos laborales y ubicaciones con vigencia |
| A7 | Consumidores. La lógica de horas especiales cambia solo tras decidir [D-4]/[D-5] |
| A8 | M2 y retiro del modelo anterior, preparados y probados en la copia antes de B1 |

**B — ejecución sobre datos; cada paso con aprobación explícita.**

| Paso | Contenido |
|---|---|
| B0 | Identidad, respaldo doble (rama Neon + `pg_dump`) y restauración probada |
| B1 | Ensayo completo en una copia aislada, con reporte revisado por el usuario |
| B2 | Dry-run en development |
| B3 | Ventana en development: respaldo → M1 (`reorg-r1`) → código → destinos R1 → tratamiento de reglas → verificación sin referencias pendientes → limpieza y V1 → M2 (`reorg-r2`) |
| B4 | Recarga manual (Organización → Ubicaciones → Puestos → Legajos) y V2 |
| B5 | Merge según [D-12] |

## 9. Contradicciones de documentación detectadas antes de A1 [H]

- **Establishment con dos padres** (`companyId` y `businessUnitId?`). Contradecía la regla "FK singular".
- **Empresas del legajo.** Vienen del M:N `EmployeeCompany`, no "subiendo desde el sector".
- **Nivel 2.** Los documentos decían "alcance por sector". El código usa asignaciones `TIME_RESPONSIBLE`.
- **Organigrama.** `directManagerId` / `directManagerName` no existen. El organigrama usa `EmployeeAssignment` `DIRECT_MANAGER`.
- **Filtros de puestos.** `GET /positions` acepta `areaId`, `establishmentId` y `businessUnitId`, no documentados.

## 10. Deuda existente que este proyecto no cambia sin decisión

- Encargado directo guardado por `personName`.
- Razón social, CUIT y código Finnegans de la empresa se editan en la UI pero no se guardan.
- Lista fija `salaryOrder` en `employees.service.ts`, distinta del catálogo `SalaryCategory`.
- La auditoría del código existente se escribe fuera de las transacciones.

## 11. Estado de implementación

| Etapa | Estado |
|---|---|
| A1 | Hecha: este ADR y las normas (commit `7918455`) |
| A2 | Código hecho en la rama; **M1 aplicada y verificada sólo en la copia aislada** `org-location-reorg` (ver abajo). Development y producción sin tocar |
| A3 | Herramientas preparadas e inventario de sólo lectura corrido en la copia (§12). **Limpieza y restauración no ejecutadas** |
| A4 | Hecha: UI separada de Organización, Ubicaciones y Centros de costo; QA visual contra la copia aislada (§13) |
| A5 | Hecha en `feat/org-location-reorg`: alcance múltiple de puestos con validación, filtros y QA (§14) |
| A6 | Hecha en `feat/org-location-reorg`: Datos Laborales con puesto y alcance de consulta, ubicaciones con vigencia y transición de legajos anteriores; QA en la copia aislada (§15) |
| A7 | **Cerrada en `feat/org-location-reorg`.** D-4, D-5, D-7, D-8 y D-13 a D-15 están implementadas y verificadas en la copia aislada. D-5 agrega historia temporal normalizada para todas las entradas mutables del motor; no inicializa datos anteriores y mantiene `SPECIAL_HOUR_SCOPE_HISTORY_MISSING` cuando falta evidencia real (§19) |
| A8 | **Preparación en curso (2026-10-08):** diagnóstico y diseño previos a M2 en `docs/decisions/A8_M2_PREPARATION.md`, corregido tras la revisión de Codex sobre `b826dba` (§20). Sin ejecución destructiva ni cambios de código |
| B0–B5 | Pendientes |

### A2 — qué quedó en código

**Esquema M1**
- Archivos: `backend/prisma/schema.prisma` y la migración `backend/prisma/migrations/20261007120000_org_location_expand/migration.sql`.
- Contenido según §7: tablas `Zone`, `PositionOrgScope`, `EmployeeWorkLocation` y `EmployeeWorkLocationEstablishment`; padres nuevos nulos con FKs RESTRICT; `Establishment.companyId` nulo; FKs de `DoubleHourRule` en RESTRICT; CHECKs; `btree_gist` y exclusión de superposición.
- Unicidad de alcances: se resuelve con `@@unique([positionId, <fk>])`, sin índices parciales.
- El SQL se generó con `prisma migrate diff` sin conexión y luego se completó a mano.

**Reversión**
- Script: `backend/prisma/rollbacks/20261007120000_org_location_expand.down.sql`, en una sola transacción.
- Aborta si ya hay datos del modelo nuevo.

**Backend de árboles (`org-structure`)**
- Zonas y padres nuevos obligatorios en el servicio; el padre debe estar activo y pertenecer al modelo objetivo.
- Registros legados: no se reubican.
- Cambio de padre de un nodo en uso: bloqueado (D-9, ratificada).
- Centros de costo: no se vinculan a registros legados.
- Dependencias de borrado: ampliadas a los vínculos nuevos.
- Vínculos de centros de costo: se borran explícitamente.
- Auditoría: dentro de la transacción. Los cachés se limpian después del commit.

**Auditoría transaccional**
- `auditRepository.create(data, db)` y `auditService.registerWithin(tx, input)`, que propaga errores.
- `clearAuditDerivedCaches()`, que se llama después del commit.
- `auditService.register` existente no cambia de comportamiento.

**Puestos**
- `DELETE` inactiva el puesto si tiene personas o reglas de horas especiales.
- Si se borra, primero borra explícitamente sus alcances y categorías.
- Todo en una transacción Serializable, con la auditoría dentro.

**Seed**
- Crea la estructura del modelo objetivo.
- Sólo crea lo que falta: nunca reubica registros existentes.

**Verificado sin base**
- `prisma validate`, typecheck, la suite de tests del backend y build.

**Verificado en la copia aislada** (2026-10-07)
- Rama Neon `org-location-reorg`, creada desde development. Host efectivo `ep-rough-river-aioy7xp9-pooler…`, comprobado antes de cada escritura.
- `migrate status` previo: sólo M1 pendiente.
- `migrate deploy` aplicó sólo M1. Manifiesto por tabla (conteo + hash sobre las columnas originales):
  - 57 de 58 tablas de datos idénticas;
  - `_prisma_migrations` +1;
  - las 4 tablas nuevas, vacías.
- Drift entre la base y `schema.prisma`: vacío. Prisma no intenta eliminar los CHECK ni la exclusión.
- `btree_gist` 1.8 instalada. Las FKs de `DoubleHourRule` quedan en RESTRICT.
- 12 pruebas de constraints en una transacción revertida, todas OK:
  - superposición futura y del mismo día → `23P01`;
  - zonas distintas simultáneas → OK;
  - intervalo inverso → `23514`;
  - alcance duplicado → `23505`;
  - alcance con dos FKs o con `level` incoherente → `23514`;
  - borrado de un padre o una zona en uso → `23001`.
  - Manifiesto posterior idéntico: no quedó nada persistido.
- Reversión probada:
  - el esquema volvió a ser idéntico al previo (diff vacío) y M1 volvió a quedar pendiente;
  - las 58 tablas quedaron idénticas al manifiesto previo.
- M1 re-aplicada: `migrate status` al día y mismas verificaciones.
- Reportes en `../backups/org-location-m1-copy-2026-10-07.*`, fuera del repositorio. Contienen sólo conteos, hashes y nombres de columnas; ninguna credencial.

## 12. A3 — inventario, bloqueos y procedimiento de limpieza

### 12.1 Herramientas (preparadas; la limpieza y la restauración NO se ejecutaron)

**Dónde está cada cosa**
- **Lógica pura con tests**, en `backend/src/modules/org-structure/reorg/`:
  - `targetIdentity.ts`: compuerta de destino.
  - `cleanupPlan.ts`: clasificación de dependencias, decisiones R1/R2/R3, retención de ancestros y plan.
  - `manifest.ts`: verificaciones V1 y V2 por ID y contenido.
- **Scripts de E/S**, en `backend/scripts/`:
  - `org-reorg/lib.ts`
  - `org-reorg-inventory.ts` y `org-reorg-manifest.ts`: sólo lectura.
  - `org-reorg-cleanup.ts` y `org-reorg-restore.ts`: escriben; no ejecutados.

**Conexión.** Siempre explícita: `--env-file` y `--expected-host`. Nunca se toma el `.env` habitual, y `DATABASE_URL` se fija antes de importar la app.

**Dos credenciales, dos comprobaciones distintas**
- **Conexión PostgreSQL** (`DATABASE_URL`): permite consultar datos y su host se compara con el esperado. No prueba qué rama es.
- **Credencial administrativa de Neon** (`NEON_API_KEY` más `--neon-project-id`, `--expected-branch-id`, `--expected-branch-name`): la API de Neon confirma tres cosas:
  - el endpoint pertenece al proyecto y a la rama esperados;
  - el host coincide;
  - la rama no es la rama por defecto.
- **Modos de lectura:** pueden correr con la identidad NO VERIFICADA y lo dejan escrito en su reporte.
- **Limpieza y restauración** (también en dry-run): exigen identidad VERIFICADA. No hay flag para saltearlo.
- **Pendiente:** con la credencial, comprobar en la primera ejecución que la forma de respuesta de la API coincide con la esperada:
  - `GET /projects/{projectId}/endpoints/{endpointId}` → `endpoint.branch_id`, `endpoint.host`;
  - `GET /projects/{projectId}/branches/{branchId}` → `branch.name`, `branch.default`.

**Dependencias.** Se descubren en el catálogo de Postgres, no en una lista escrita a mano. Toda FK hacia la estructura sin tratamiento autorizado bloquea (fail closed).

**Garantías de la limpieza.** Corre en una única transacción Serializable que, antes del commit, verifica:
1. Inventario congelado idéntico.
2. Plan sin bloqueos.
3. Respaldo escrito antes de la primera escritura.
4. Reglas tratadas, ninguna con referencias pendientes.
5. Re-chequeo de todas las FKs.
6. Borrado explícito en orden.
7. **Equivalencia del motor de horas especiales**: el motor real antes y después; cualquier cambio no aceptado aborta.
8. **V1 por fila.**

La auditoría se escribe en la misma transacción, sólo en `AuditLog` según D-3 preliminar.

**Restauración.**
- Reinserta con los mismos IDs, repone sólo valores que sigan vacíos y vuelve a verificar contra el manifiesto previo.
- Sólo es válida antes de M2.

### 12.2 Inventario de la copia `org-location-reorg` (2026-10-07, sólo lectura)

Reporte en `../backups/org-reorg-inventory-copy-2026-10-07.json`. Contiene IDs, códigos, nombres de catálogo y legajos; ninguna credencial.

**Estado general**
- 62 tablas y 5098 filas. M1 aplicada; no hay registros del modelo nuevo.
- La copia quedó idéntica después del inventario: 62 de 62 tablas sin cambios.
- **Legajos:** 32, todos activos. Los 32 tienen:
  - puesto, sector, centro de costo y categorías interna y de recibo;
  - empresa empleadora (33 vínculos, 32 principales).
- **Convenio y obra social:** 3 y 4 legajos. Se conservan.
- **Responsables:** 1 `DIRECT_MANAGER`, guardado sólo por nombre, y 3 `TIME_RESPONSIBLE`. No se tocan.

**Candidatos al inventario**

| Tabla | C1 (conserva empresas) | C2 (elimina empresas) |
|---|---|---|
| Company | 0 | 6 |
| BusinessUnit | 12 | 12 |
| Establishment | 18 | 18 |
| Area | 43 | 43 |
| Sector | 42 | 42 |
| Position | 3 | 3 |

**Dependencias con filas** (todas las demás FKs hacia la estructura tienen 0 filas, incluida `ClockDevice.sectorId`):

| Dependencia | onDelete | Filas | Tratamiento |
|---|---|---|---|
| `Employee.positionId` | SET NULL | 32 | Vaciar (autorizado) |
| `Employee.sectorId` | SET NULL | 32 | Vaciar (autorizado) |
| `User.sectorId` | SET NULL | 1 | Vaciar |
| `User.companyId` | SET NULL | 1 (sólo C2) | Vaciar |
| `EmployeeCompany.companyId` | CASCADE | 33 (sólo C2) | Borrar explícitamente, auditado por legajo; se recarga la empresa empleadora |
| `PositionSalaryCategory.positionId` | CASCADE | 14 | Borrar vínculos |
| `CostCenterArea` / `BusinessUnit` / `Establishment` / `Sector` | CASCADE | 4 / 2 / 2 / 2 | Borrar vínculos (los centros de costo se conservan) |
| `CostCenterCompany.companyId` | CASCADE | 3 (sólo C2) | Borrar vínculos |
| Cadena interna (`Position.sectorId`, `Sector.areaId`, `Area.establishmentId`, `Establishment.businessUnitId` y, en C2, `.companyId` y `BusinessUnit.companyId`) | SET NULL / RESTRICT | 3 / 42 / 43 / 18 / 18 / 12 | Borrado en orden; ningún registro fuera del inventario depende de ellos |
| `DoubleHourRule.companyId` | RESTRICT (M1) | 1 (sólo C2) | **Requiere decisión R1/R2/R3** |

**Copias en texto que se preservan sin cambios**
- `EmployeeFieldHistory`: sector 3, puesto 4, centro de costo 1, empresas 4.
- `AuditLog` de la estructura y los legajos.

**Reglas de horas especiales con alcance de estructura**
- Hay una sola: **"Domingos"**.
  - Tipo OTRO, ACTIVO, semanal, x2, vigente del 2026-01-01 al 2028-12-31.
  - Alcance: empresa LOSOD (Los O'Dwyer). Población actual: los 32 legajos.
  - Sin trazas `SpecialHourRuleApplication`: se aplicó sobre cargas manuales.
- Ninguna regla usa sector ni puesto.

**Impacto en el motor si se limpiara sin tratar reglas** (motor real, lector simulado, 21 legajos con horas, 78 fechas-legajo):
- **C1: 0 cambios.**
- **C2:** 5 fechas-legajo de 4 legajos pasarían de x2 a x1, porque "Domingos" dejaría de alcanzarlos.
  - Filas en esas fechas: 5 `TimeEntry` (40 h) y 2 desgloses (360 min).
  - Incluye un cierre en estado **ENVIADO**.

### 12.3 Bloqueos concretos

1. **Credencial administrativa de Neon** (D-0). Mientras falte, `org-reorg-cleanup` y `org-reorg-restore` no corren, ni siquiera en dry-run. Hace falta:
   - `NEON_API_KEY` en el entorno, de sólo lectura si el plan de Neon lo permite;
   - el `projectId`;
   - los IDs de la rama de ensayo y de `development`.
2. **D-1, C1 o C2.**
   - **C1:** 0 bloqueos y 0 impacto en horas.
   - **C2:** bloqueado por "Domingos" hasta decidir su tratamiento. El inventario muestra los efectos de cada opción:
     - **R1** (reasignarla a la empresa recargada): exige crear la empresa nueva y recargar la empresa empleadora de los 32 legajos **antes** de limpiar. Si no, la verificación de equivalencia aborta por las 5 fechas.
     - **R2** (lista explícita de los 32 legajos): congela la población; los ingresos futuros no reciben "Domingos" solos.
     - **R3** (retener LOSOD): en la práctica conserva esa empresa, igual que C1 para ella.
   - Ninguna opción se adopta sin tu decisión.
3. **D-3** (rastro sólo en `AuditLog`, preliminar). El script lo implementa así. Si se decide historial visible, hay que ampliarlo antes de B1.
4. **Línea base de reconciliación.** `staging:special-hours:reconcile` en dry-run usa una transacción de escritura que se revierte. No se corrió en A3 por la restricción de sólo lectura. Va en B1 si se autoriza.
5. **Actor.** La limpieza exige `--actor-user-id` de un usuario RRHH activo: hay que indicar quién figura en la auditoría.

### 12.4 Procedimiento propuesto (cada paso con aprobación explícita)

1. **B0, en development, sólo lectura salvo los respaldos:**
   - identidad vía Neon API;
   - respaldo doble (rama Neon más `pg_dump`) y restauración probada;
   - `org-reorg-inventory` y `org-reorg-manifest capture` sobre development, comparados con la copia.
2. **Decisiones:**
   - elegir D-1;
   - escribir `decisions.json` con una entrada por regla que requiera decisión. Formato: `[{ "ruleId": "...", "treatment": "R1" | "R2" | "R3", "targets": {...} (sólo R1), "inactivate": false, "approvedBy": "...", "note": "..." }]`. Con C1 sobre los datos actuales es `[]`.
3. **B1 — ensayo en una rama aislada nueva** creada desde el respaldo:
   1. `reorg-r1` → M1.
   2. Inventario (congelado).
   3. Línea base de reconciliación.
   4. `org-reorg-cleanup` en dry-run → revisión del reporte.
   5. `--apply --backup`.
   6. `manifest capture`.
   7. `org-reorg-restore` en dry-run y `--apply` (prueba de reversión) → nueva limpieza.
   8. `reorg-r2` → M2 (A8).
   9. Recarga de muestra.
   10. `manifest verify-v2`.
4. **Revisión del reporte de B1** antes de tocar development.
5. **B2/B3 en development**, con el backend detenido, igual que el ensayo.
6. **B4:** recarga manual y V2.

Comandos (las rutas de reportes y respaldos van siempre fuera del repositorio):

```
npx tsx scripts/org-reorg-inventory.ts --env-file=<env> --expected-host=<host> [--neon-project-id=… --expected-branch-id=… --expected-branch-name=…] --report=<inventario.json>
npx tsx scripts/org-reorg-manifest.ts capture --env-file=<env> --expected-host=<host> --out=<manifiesto.json>
npx tsx scripts/org-reorg-cleanup.ts --env-file=<env> --expected-host=<host> --neon-project-id=… --expected-branch-id=… --expected-branch-name=… --company-mode=C1|C2 --inventory=<inventario.json> --decisions=<decisiones.json> --actor-user-id=<uuid> --report=<reporte.json> [--apply --backup=<respaldo.json>]
npx tsx scripts/org-reorg-restore.ts --env-file=<env> --expected-host=<host> --neon-project-id=… --expected-branch-id=… --expected-branch-name=… --backup=<respaldo.json> --actor-user-id=<uuid> --report=<reporte.json> [--apply]
npx tsx scripts/org-reorg-manifest.ts verify-v2 --baseline=<manifiesto tras limpieza> --current=<manifiesto tras recarga> --report=<v2.json>
```

## 13. A4 — UI y QA visual en la copia aislada (2026-10-07)

### 13.1 Resultado

- La pantalla separa **Organización**, **Ubicaciones** y **Centros de costo**.
- Organización representa `Empresa → Unidad de negocio → Sector → Área`; Ubicaciones representa `Zona → Establecimiento`.
- Árbol, tabla, búsqueda, formularios, estados vacíos y navegación responsive fueron revisados con datos reales de la copia `org-location-reorg`.
- Los 103 nodos del modelo anterior (42 sectores, 43 áreas y 18 establecimientos) aparecen como **Pendiente de recarga**, fuera de los árboles nuevos. No pueden recibir hijos ni elegir un padre nuevo.
- D-9 se muestra antes de guardar cuando la UI conoce dependencias. Por ejemplo, el padre de la unidad `ADM` queda deshabilitado por su vínculo con un centro de costo y explica el impacto. El backend sigue siendo la autoridad para dependencias no contenidas en el catálogo visible y responde 409.
- Los centros de costo conservan sus vínculos anteriores, los identifican y permiten quitarlos, pero no volver a agregarlos una vez removidos.
- Se revisaron 1440×900 y 390×844 sin solapamientos ni desbordes funcionales. Las capturas se adjuntaron al reporte de cierre de la etapa.
- No se crearon nodos ni se guardaron cambios de estructura durante el QA.

### 13.2 Tareas automáticas durante QA

El backend tenía un único arranque automático, `startClockPunchMaintenance()`, que reúne vencimientos, alertas, falta de ingreso, retención y catch-ups. Se agregó la compuerta `AUTOMATIC_JOBS_ENABLED`, activa por default para conservar el comportamiento habitual. Sólo `backend/.env.reorg` (ignorado por Git) la fija en `false`.

La instancia de QA informó `AUTOMATIC_JOBS_DISABLED` antes de escuchar y permaneció activa durante más de un intervalo completo de 60 segundos sin iniciar el mantenimiento ni producir filas nuevas. El test de bootstrap comprueba ambos caminos (apagado no invoca el scheduler; encendido conserva el arranque).

### 13.3 Filas incidentales conservadas

Antes de incorporar la compuerta, el primer arranque de QA ejecutó el chequeo intradía. Estas filas pertenecen exclusivamente a la copia `org-location-reorg`; se conservaron sin borrar ni modificar:

**AttendanceInactivityIncident**
- `6fc49c14-47c0-44d7-9e51-490dc297267b`
- `660c92a9-f8ae-4433-9526-6c9125caddf0`

**SystemNotification** (`FALTA_INGRESO`)
- `2d107ebb-e291-440a-b878-4d4adfe4d59c` → incidente `6fc49c14-47c0-44d7-9e51-490dc297267b`
- `7e844420-41bc-444d-8fc7-e0ad10702a2e` → incidente `6fc49c14-47c0-44d7-9e51-490dc297267b`
- `cb629b88-8504-4643-a904-cbccc3693e63` → incidente `660c92a9-f8ae-4433-9526-6c9125caddf0`

Una consulta final de sólo lectura confirmó las cinco filas y `0` incidencias / `0` notificaciones `FALTA_INGRESO` nuevas después de `2026-10-07T13:33:12Z`.

## 14. A5 — alcance organizacional de puestos (2026-10-07)

### 14.1 Implementación

- `PositionOrgScope` es la fuente de verdad para altas A5. El contrato usa uno o más `{ level, nodeId }`, con niveles `COMPANY`, `BUSINESS_UNIT`, `SECTOR` y `AREA`.
- Cada nodo incluye sus descendientes. Se permiten varios alcances independientes y se rechazan duplicados o combinaciones ancestro/descendiente con `POSITION_SCOPE_REDUNDANT` y un mensaje que identifica qué nodo ya incluye al otro.
- Backend y frontend excluyen zonas, establecimientos, nodos inactivos nuevos y sectores/áreas de la estructura anterior. Un alcance inactivo ya guardado puede conservarse al editar.
- Crear o reemplazar alcances y categorías salariales, junto con la auditoría, corre en una transacción `Serializable`. Las invalidaciones del listado, opciones y auditoría ocurren después del commit.
- El listado muestra los alcances y marca los puestos anteriores como **Pendiente de recarga**. `Position.sectorId` permanece; no se convierte ni se elimina. Editar otros datos de un puesto pendiente omite `orgScopes` y conserva ese estado.
- El formulario advierte que todos los legajos asignados al puesto comparten exactamente el mismo alcance. No crea variantes ni cambia asignaciones.
- La categoría salarial sigue independiente del alcance y de la jerarquía.
- Los filtros son explícitos: **Ubicado dentro de** busca un alcance igual al nodo o descendiente; **Abarca** busca uno igual o ancestro. La UI exige un único nodo y muestra la diferencia; no combina ambos conceptos.

### 14.2 QA integrado en la copia aislada

El backend arrancó con `backend/.env.reorg` e informó `AUTOMATIC_JOBS_DISABLED`. Se autenticó con el acceso rápido de prueba existente de Nivel 1, sin cambiar ni omitir la autenticación.

Se verificó en 1440×900 y 390×844:

- alta con dos empresas independientes (LOSOD y Brasitas);
- rechazo visual y backend de LOSOD + su UN Administración central;
- rechazo backend de un UUID inexistente (`400 POSITION_SCOPE_INVALID`);
- edición del segundo alcance de Brasitas a Tropa y persistencia después de recargar;
- detalle, listado, mensajes, tabla horizontal, selector y advertencia de impacto compartido;
- los tres puestos anteriores continúan pendientes, con su sector legado sin convertir;
- semántica distinta de filtros: para Administración central, `WITHIN` devolvió 0 y `COVERS` devolvió el puesto cubierto por LOSOD.

Durante el recorrido se corrigió el encabezado de detalle, que todavía mostraba “Sin área · Sin sector”, y el corrimiento de un día de `lastUpdatedAt`. Ahora resume alcances A5 y trata esa fecha como día calendario.

### 14.3 Escrituras de QA documentadas

Sólo en `org-location-reorg` se creó el registro identificable `QA-A5-ALCANCE-MULTIPLE`:

- Position `ab2b54d4-3859-480c-994b-ab70e53aa096`, código `PUE-004`, sin `sectorId` y sin legajos asignados.
- Alcances finales de empresa: `63f6211b-6bd3-480b-84d8-97383ac49b91` y `ace7b6b0-6c1d-47a2-81d3-8a9910668bf9` (LOSOD y Tropa).
- AuditLog de creación `3e910a59-dd39-4de1-b5c3-e9c8284a815c` y de edición `c017c3e7-d6db-49c4-ab4d-efe1578fc1c0`.

Los dos POST negativos abortaron antes de escribir. No se ejecutó limpieza, restauración, seed, reconciliación, M2 ni cambios de Datos Laborales. Una lectura final confirmó que las 2 `AttendanceInactivityIncident` y las 3 `SystemNotification` de §13.3 siguen presentes con los mismos identificadores.

### 14.4 Capturas

- `docs/qa/a5-puestos-listado-desktop.png`
- `docs/qa/a5-puestos-listado-mobile.png`
- `docs/qa/a5-puestos-listado-mobile-full.png`
- `docs/qa/a5-puesto-detalle-desktop.png`
- `docs/qa/a5-puesto-detalle-mobile.png`
- `docs/qa/a5-puesto-form-redundancia-desktop.png`
- `docs/qa/a5-puesto-legado-pendiente-desktop.png`

### 14.5 Decisiones que siguen pendientes

- **D-6 sigue abierta:** no se definieron funciones que requieran variantes por alcance. A5 no crea variantes ni reasigna legajos automáticamente.
- **D-7 sigue abierta para A7:** A5 usa `WITHIN` como valor inicial del filtro de puestos y permite cambiarlo explícitamente a `COVERS`; esto no decide la banda “Alcance superior” del organigrama ni el comportamiento futuro de otros filtros.

## 15. A6 — Datos Laborales y ubicaciones con vigencia (2026-10-07)

### 15.1 Implementación

**Puesto y alcance (bloque A)**
- El legajo conserva un único `positionId`. El alcance se lee de `PositionOrgScope` y se muestra como consulta, con la ruta completa de cada alcance (por ejemplo `Los O'Dwyer › Administración central › Agricultura`). No hay campos editables de alcance en el legajo ni se deriva o exige un sector único.
- Asignar un puesto **nuevo** exige que esté `ACTIVO` y tenga al menos un alcance (`EMPLOYEE_POSITION_PENDING_SCOPE` / `EMPLOYEE_POSITION_INACTIVE`). Conservar el puesto actual, aunque sea anterior, no exige nada.
- Validación contra el puesto: con alcance A5 sólo se compara la categoría salarial; un puesto sin alcance conserva las comparaciones anteriores como consulta y queda "Puesto pendiente de recarga".
- No se crearon variantes de puestos ni se reasignaron legajos (D-6 sigue abierta).

**Ubicaciones (bloque B)**
- Backend en el módulo `employees` (`employeeWorkLocations.{rules,repository,service}.ts`) sobre las tablas de M1, sin cambios de esquema.
- Cuatro operaciones distintas: alta, **cambio con nueva vigencia** (cierra la vigente en `D − 1` y abre la nueva en `D`), finalización y **corrección** del mismo registro. No hay borrado.
- Establecimientos explícitos (D-2), validados contra la zona; se rechazan duplicados, establecimientos del modelo anterior y nodos inactivos nuevos.
- Sin superposición por persona y zona, incluidas las futuras: validación legible en el servicio más la exclusión de M1 como respaldo ante concurrencia. Zonas distintas pueden superponerse.
- Fechas como clave de calendario `YYYY-MM-DD` de punta a punta; el estado (vigente/futura/finalizada) se calcula con el día de Argentina (`argentinaTime.ts`, se agregó `previousCalendarDateKey`).
- Filas, historial visible (`EmployeeBlockHistory`, bloque `UBICACIONES_TRABAJO`) y `AuditLog` en una transacción `Serializable` (`auditService.registerWithin`); cachés derivados después del commit. El motivo queda en la fila; el de finalización y el de corrección, en historial y auditoría.
- Contratos: `docs/BACKEND_API_CONTRACTS.md`, sección "Ubicaciones de trabajo (A6)".

**Datos laborales conservados (bloque C)**
- Empresa empleadora (rotulada así, distinta del alcance), centro de costo, categorías de recibo e interna, validación salarial, convenio, obra social, movimientos laborales y responsables, sin cambios de comportamiento. Jornada y responsables siguen en sus pestañas.

**Transición**
- `Employee.sectorId` queda de sólo lectura: la API rechaza cualquier cambio (`EMPLOYEE_LEGACY_SECTOR_READ_ONLY`) y el frontend dejó de enviarlo. Antes lo resolvía por nombre contra el catálogo y podía reasignar en silencio un sector homónimo del árbol nuevo.
- El sector anterior (con su historial), la unidad de negocio y el establecimiento derivados se muestran en "Estructura anterior · sólo consulta". Un aviso "Pendiente de recarga" lista qué falta: puesto sin alcance, ninguna ubicación vigente o futura, y estructura anterior presente.
- Nada se convierte automáticamente; no se borraron datos ni columnas.
- El alta de legajo ya no ofrece unidad de negocio, establecimiento ni sector; ofrece sólo puestos con alcance y muestra el alcance elegido. Las ubicaciones se cargan después, desde el legajo.

### 15.2 QA integrado en la copia aislada

Instancia propia del backend en el puerto 4012 con `backend/.env.reorg` (host `ep-rough-river-aioy7xp9-pooler`, verificado antes de escribir), que informó `AUTOMATIC_JOBS_DISABLED`, más Vite en 5184. Se autenticó con el acceso rápido de prueba existente. El backend de desarrollo que ya corría en 4002 no se usó.

API, 46 verificaciones (todas como se esperaba):
- Varias zonas simultáneas con varios establecimientos; establecimiento de otra zona, del modelo anterior, duplicado y lista vacía rechazados; intervalo inverso y fecha inexistente rechazados.
- Superposición con una vigencia futura de la misma zona → 409. Cambio desde 01/10/2026: la anterior quedó `01/01/2026 → 30/09/2026` (finalizada) y la nueva vigente desde el 01/10/2026. Cambio futuro desde 01/02/2027: vigente hasta 31/01/2027 y futura desde 01/02/2027.
- Corrección que pisaba la futura → 409; corrección sin cambios → 400; corrección de inicio con motivo → auditoría con antes/después y motivo, historial "Corrección ·".
- Finalización y doble finalización (→ 409).
- 5 eventos de auditoría y 5 filas de historial para el legajo de prueba principal, sin IDs técnicos en el texto.
- Editar la categoría interna conserva puesto, centro de costo, empresa, convenio, obra social, categoría de recibo y ubicaciones. Cambiar el sector anterior y asignar un puesto anterior se rechazan.
- Legajo de prueba con puesto y sector anteriores: guarda otros datos conservándolos, recibe una ubicación nueva y no permite vaciar el sector.
- Un legajo existente (legajo `01`, sólo lectura): sin ubicaciones y con su puesto marcado "pendiente de recarga".
- Permisos: Supervisión recibe 404 en un legajo fuera de su alcance y 403 al escribir; Carga horaria, 403 al leer y escribir.
- Una expectativa del guion estaba mal planteada y se corrigió: el legajo anterior mostró `danger` por su categoría interna fuera del rango del puesto. Es la precedencia existente; las tres comparaciones anteriores salieron OK.

Visual (1440×900, 1366×768, 1920×1080, 820×1180 y 390×844): sin desborde horizontal de página. Durante el recorrido se corrigieron dos problemas:
- el modal se partía en dos columnas implícitas en mobile y aplastaba los establecimientos;
- el alcance aparecía dentro de una caja doble en el alta de legajo.

También se alineó el texto del error de superposición con el botón “Cambiar desde…”.

### 15.3 Escrituras de QA documentadas (sólo `org-location-reorg`)

Todas identificables con `QA-A6`, vía API salvo donde se indica:
- Zonas `QA-A6-ZN` `3783619e-d768-43a7-9839-c6bb48bfb7fd` y `QA-A6-ZS` `f33d942d-27bf-47ff-ae06-5be4d1c35ba7`.
- Establecimientos `QA-A6-EN1` `4349bca3-f55c-4ced-890d-c0f0e29e965b`, `QA-A6-EN2` `99368ff7-b04c-46df-b62e-346719238d24`, `QA-A6-ES1` `e78dd245-6616-4cfe-bffe-48ff6824179e` y `QA-A6-ES2` `13d0307d-7148-4f61-9e56-58eff433e834`.
- Sector `QA-A6-AGRO` `2be86792-3a31-4252-8de4-2bf66836b566` (UN Administración central de LOSOD).
- Puesto `PUE-005` "QA-A6 Encargado de Agricultura" `a9a6f458-2fe2-46de-98fa-f0c3c15ba3ba` (alcance: el sector anterior).
- Legajos:
  - `QA-A6-001` `0166af0c-ff0a-4ba5-9f8f-d99da5489749` (puesto PUE-005);
  - `QA-A6-002` `3ad5e85e-c2f5-46a1-9617-4982e070d758` (puesto multiempresa `PUE-004` de A5);
  - `QA-A6-003` `8f39aac6-b141-46ad-abe3-06206417abc4`. Se creó por API y luego, **por script directo sobre la copia** con verificación de host, recibió el puesto `PUE-002` y su sector anterior para reproducir un legajo pendiente de recarga. El script dejó su propia fila de `AuditLog` en la misma transacción.
- 7 `EmployeeWorkLocation` (9 establecimientos vinculados) y 9 filas de historial, todas de legajos `QA-A6`.
- `AuditLog` desde las 15:40 UTC: 41 filas (incluye logins, rechazos de ruta de las pruebas de permisos y la fila del script).

Lectura final:
- los 32 legajos existentes, sin modificaciones;
- 0 incidencias y 0 notificaciones nuevas;
- las 5 filas incidentales de §13.3 siguen presentes.

No se ejecutó M2, seed, limpieza, restauración ni reconciliación; development y producción no se tocaron.

### 15.4 Capturas

`docs/qa/a6-*.png`:
- Datos Laborales: `a6-datos-laborales-desktop` (sección completa), `-1366`, `-1920`, `-tablet`.
- Alcance: `a6-puesto-alcance-sector-desktop`, `a6-puesto-multiempresa-desktop`, `a6-puesto-alcance-mobile`.
- Ubicaciones: `a6-ubicaciones-historial-desktop`, `a6-ubicaciones-mobile`.
- Modales: `a6-modal-alta-superposicion-desktop`, `a6-modal-cambio-desktop`, `a6-modal-correccion-desktop`, `a6-modal-alta-mobile`.
- Transición: `a6-legajo-pendiente-recarga-desktop`, `a6-legajo-pendiente-recarga-mobile`, `a6-alta-legajo-alcance-desktop`.

### 15.5 Pendientes concretos

- **D-2 (zona completa):** sin ratificar. Si se aprueba, hace falta definir cómo se representa (por ejemplo, una marca explícita en la asignación) sin reinterpretar una lista vacía.
- **D-6:** sin definir qué funciones necesitan puestos distintos por alcance.
- **A7 (consumidores):**
  - filtros de Legajos y del organigrama por sector (`sectorId`);
  - la columna sector de listados;
  - "Dotación por sector" (D-8);
  - reglas de horas especiales (D-4/D-5).

  Todos siguen leyendo `Employee.sectorId`; ninguno lee todavía ubicaciones ni alcance.
- **Alta con ubicaciones:** el alta de legajo no carga ubicaciones. Requeriría crear legajo y ubicaciones en una sola transacción.
- **Historial de puesto y de campos:** el historial de puesto, empresa y demás campos de Datos Laborales sigue escribiéndose en una segunda llamada del cliente, no atómica (deuda §10, sin cambios).
- **A8/M2:** retirar `Employee.sectorId` y las vistas "Estructura anterior" cuando la recarga termine.
- **Observado fuera de alcance:**
  - las casillas de "Empresa empleadora" en el alta de legajo se ven sobredimensionadas (estilo previo, no modificado);
  - la tabla de movimientos laborales se desplaza horizontalmente dentro de su contenedor en anchos chicos.

## 16. A7 — consumidores (2026-10-07, en curso)

### 16.1 Instancia local del puerto 4002

- **Proceso:** `npm run dev` → `tsx watch src/server.ts` (iniciado 07:28), servidor hijo en el puerto 4002, con directorio `Gestion-Personal/backend`. Es de este proyecto.
- **Configuración efectiva:**
  - El proceso no heredaba `DATABASE_URL` ni `PORT`, así que `dotenv` cargaba `backend/.env`.
  - `PORT=4002` coincide con ese archivo (el valor por defecto sería 4001) y `DATABASE_URL` apunta a `ep-gentle-resonance…` (development, sin M1).
  - Las IP de conexión no distinguen la rama: ambos hosts resuelven al mismo proxy de Neon.
- **Riesgo:** al recargar en caliente, ejecutaba el código de A6/A7 contra una base sin las tablas de M1.
- **Acción:** se detuvo el árbol completo (3 procesos) el 2026-10-07. No se aplicaron migraciones ni se escribió en development. El Vite del 5174 se dejó corriendo.
- Para QA se usó una instancia propia (puerto 4012) cargando `backend/.env.reorg` explícitamente: host `ep-rough-river…`, `AUTOMATIC_JOBS_DISABLED`. Además, un Vite propio en 5184. Ambos se detuvieron al terminar.

### 16.2 Inventario de lecturas del sector del legajo y de la cadena anterior

| Consumidor | Lectura anterior | Tratamiento A7 |
|---|---|---|
| Legajos — filtros (`GET /employees`) | `sectorId` exacto; el selector mezclaba sectores nuevos y anteriores (un sector nuevo nunca devolvía resultados) | Filtros de estructura (§16.3). `sectorId` queda como **Sector anterior** con sólo sectores del modelo anterior |
| Legajos — tabla | No mostraba estructura | Columnas "Puesto y alcance" (pendiente de recarga marcado) y "Ubicaciones vigentes" |
| Opciones (`/employees/options`) | `sectorId` | Mismos filtros de estructura |
| Organigrama — datos (`/employees/org-chart`) | Cadena sector→área→establecimiento→UN; búsqueda por nombre de sector | Alcances del puesto y ubicaciones vigentes como contexto; filtros de estructura del lado del servidor. La búsqueda sigue incluyendo el nombre del sector anterior |
| Organigrama — pantalla | Filtros por UN, establecimiento y sector (nombres derivados); **Nivel 2 recortado en el cliente comparando el ID del sector del usuario con el NOMBRE del sector del legajo**, por lo que quedaba vacío (bug de §2.2) | Filtros de la cadena anterior retirados. Nivel 2 ve lo que el backend autoriza por responsable de carga. Nodo y resumen muestran empresa empleadora, alcance del puesto, ubicaciones y "Sector anterior". La exportación separa esas columnas |
| Paneles de empleados asociados (regímenes, conceptos horarios) | Filtro y columna "Sector" | Filtros de estructura; columna "Puesto" (pendiente marcado); "Sector anterior" sólo en el detalle móvil |
| Convocatorias a feriados (candidatos) | Filtro "Sector" con todos los sectores | "Zona (vigente ese día)", evaluada en la fecha del feriado, más "Sector anterior". **No cambia quién cobra ni la reinterpretación** |
| Asistencia (observados) | Columna "Sector"; búsqueda por nombre de sector | Columna "Puesto"; la búsqueda agrega el puesto y conserva el sector anterior |
| Grilla horaria del legajo (encabezado) | "empresa · centro de costo · sector · puesto" | Sin sector |
| Dashboard Nivel 2 y Reportes — "Dotación por sector" | `groupCount(sector)`, exclusivo, uno por legajo | **Sin cambio de cálculo (D-8).** Rotulado "Dotación por sector anterior", con aclaración. Se corrigió la descripción del dashboard de Nivel 2, que mostraba el **UUID** del sector del usuario |
| Dashboard — caché | Clave con `User.companyId/sectorId` | Sin cambio (inocuo) |
| Permisos (`employeeAccessWhere`) | Por responsable de carga | Sin cambio. Todos los filtros nuevos se combinan con el filtro de acceso (test y QA) |
| Cachés backend/frontend | Clave = URL | Los parámetros nuevos forman parte de la URL (orden estable) |
| Horas especiales (`doubleHourRuleScopeWhere`) | Empresa **empleadora**, sector **anterior**, centro de costo y puesto del legajo | **Sin cambio (D-4/D-5).** Test de caracterización `doubleHourRuleScope.characterization.test.ts` como base de comparación. "Domingos" se conserva intacta |
| Configuración de reglas (`WorkScheduleSettingsPage`) | Selector de sector con sectores nuevos y anteriores | **Sin cambio (D-4).** Ver ejemplo en §16.4 |
| Exportación Finnegans / horas | Centro de costo; no usan sector | Sin cambio |
| Usuarios (`User.sectorId`) | Alcance editable en la UI; sólo se usa en la clave de caché del dashboard | Pendiente (A8/M2) |
| Dispositivos de fichado | `ClockDevice.sectorId` (anterior); M1 agregó `establishmentId` | Pendiente (etapa de fichador; fuera de los consumidores pedidos) |
| Bandeja de pendientes | Selecciona `employee.sectorId` sin usarlo | Sin cambio |

### 16.3 Implementado

- **Filtro compartido** (`shared/prisma/orgScopeWhere.ts`, `employeeStructureWhere.ts`, `shared/validation/employeeStructureQuery.ts`). Puestos (A5) y Legajos usan la misma semántica, sin duplicarla.
- **Alcance:** `WITHIN` y `COVERS` con `some`. El modo **no tiene valor por defecto** en Legajos, Organigrama ni paneles: sin modo, la UI avisa y el backend rechaza. Esto no decide D-7.
- **Ubicación:** zona y/o establecimiento evaluados en la misma asignación y vigentes a una fecha calendario (por defecto hoy).
- **Recarga** (`PENDING`/`COMPLETE`): mismo criterio que el aviso de A6, sin puesto con alcance o sin ubicación vigente o futura. La UI usa el conteo que devuelve el backend, no infiere.
- **Sector anterior** como filtro de consulta explícito.
- **Empresa empleadora**, rotulada así en todos los filtros y exportaciones adaptados.
- **Organigrama:** sigue por encargado directo; el alcance y las ubicaciones son contexto. La vista por categorías sigue ordenando por categoría salarial, sin definir la jerarquía.

### 16.4 Decisiones abiertas — ejemplos concretos sobre datos de prueba de la copia

Datos usados:
- `QA-A6-001`: puesto con alcance en el sector QA-A6 Agricultura (bajo LOSOD › Administración central).
- `QA-A6-002`: puesto multiempresa, alcance LOSOD + Tropa.
- `QA-A7-001`: puesto con alcance en dos UN de LOSOD (Administración central y Agricultura), con ubicaciones en Zona Norte y Zona Sur.

**D-7 — modo por defecto y banda "Alcance superior".**
- Para el sector QA-A6 Agricultura:
  - `WITHIN` devuelve sólo `QA-A6-001`;
  - `COVERS` devuelve `QA-A6-001`, `QA-A6-002` y `QA-A7-001`.
- Para LOSOD:
  - `WITHIN` devuelve los tres;
  - `COVERS` sólo `QA-A6-002`.
- Opciones:
  - (a) `WITHIN` por defecto (es el valor inicial que hoy usa Puestos, A5);
  - (b) `COVERS` por defecto;
  - (c) sin valor por defecto, como hace A7 en Legajos;
  - (d) mostrar ambos grupos separados.
- Si se elige (a) o (d), hay que alinear Puestos y Legajos.
- Banda en el organigrama: al filtrar `WITHIN` Agricultura, ¿se muestran `QA-A6-002` y `QA-A7-001` en una banda "Alcance superior" aparte, sin contarlos como integrantes? ¿Se agregan como contexto los encargados por línea directa fuera del filtro? Hoy no se agregan; la pantalla lo avisa.

**D-8 — reemplazo de "Dotación por sector".**
- Hoy, para Supervisión, `QA-A7-001` aparece como "Sin cargar" porque no tiene sector anterior.
- Opciones:
  - (a) por zona vigente: no sumable, porque `QA-A7-001` cuenta en Norte y en Sur (suma 2, personas únicas 1). Requiere mostrar el total de personas por separado;
  - (b) por alcance del puesto: no exclusiva; depende de D-7 (un director que abarca LOSOD, ¿suma en cada sector?);
  - (c) por empresa empleadora principal: exclusiva y sumable;
  - (d) conservar el sector anterior hasta M2 y luego retirarlo.

**D-4 — pertenencia a un sector en reglas de horas especiales** (sin cambios en el motor).
- Hoy la dimensión sector usa el sector **anterior**. Una regla nueva limitada a un sector del árbol nuevo (el selector de la configuración lo permite) **no alcanza a nadie**, porque ningún legajo recargado tiene sector anterior.
- Ejemplo con una regla hipotética "x1,5 en QA-A6 Agricultura":
  - S1 (dentro): sólo `QA-A6-001`;
  - S2 (abarca): además `QA-A6-002` y `QA-A7-001`;
  - S3: la unión de S1 y S2;
  - S4: un sector propio por legajo;
  - S5: lista explícita.
- La dimensión **empresa** usa hoy la empresa **empleadora**: "Domingos" (LOSOD) alcanza a los tres legajos de prueba porque su empleadora es LOSOD. Falta decidir si una regla por empresa significa empleadora o alcance del puesto. Por ejemplo, `QA-A6-002` también abarca Tropa.
- Mientras no se decida, convendría que la configuración de reglas no ofrezca sectores del árbol nuevo, o que avise. **No se cambió.**

**D-5 — recálculo histórico.** Sin cambios. Cualquier adaptación requiere la comparación antes/después del motor real en la copia, sin escribir horas, desgloses ni cierres; el test de caracterización es el punto de partida.

**No se decidió:** si un director que abarca una empresa integra cada sector; conteos por sector no exclusivos; zona completa (D-2); variantes de puestos (D-6).

### 16.5 QA integrado en la copia aislada

- **API:** 27/27 escenarios (`WITHIN` vs. `COVERS`, sin duplicados ni en `meta.total`, vigencias hoy/pasadas/futuras, recarga, sector anterior, organigrama, opciones, paneles, convocatorias, permisos).
- **Permisos:**
  - Supervisión con `WITHIN` LOSOD ve sólo `QA-A7-001`, el legajo a su cargo; `QA-A6-001` y `QA-A6-002` no, aunque estén dentro del filtro;
  - su organigrama pasó de vacío a mostrar ese legajo;
  - Carga horaria sigue en 403 en el listado y sus opciones no devuelven legajos de prueba.
- **Visual:**
  - Legajos en 1440, 1366, 1920 y 390;
  - Organigrama (funcional filtrado, resumen, Supervisión, móvil);
  - panel de asociados, convocatorias a feriados y dashboard de Nivel 2.

  Sin desborde horizontal. Durante el QA se corrigieron:
  - filtros sin rótulo que se estiraban;
  - el CUIL partido en varias líneas.
- **Lectura final:**
  - los 32 legajos originales no se modificaron desde antes de A6;
  - todas las ubicaciones son de legajos `QA-`;
  - 0 incidencias y 0 notificaciones nuevas durante el QA de A7;
  - las 5 filas incidentales de §13.3 siguen presentes.

### 16.6 Escrituras de QA (sólo `org-location-reorg`, vía API)

- Puesto `PUE-006` "QA-A7 Gerente multiunidad" `cd204673-0cb7-45c8-87f6-e5c8a5c15b55` (alcances: UN Administración central y UN Agricultura de LOSOD).
- Legajo `QA-A7-001` `e4b4502c-c329-40e6-a155-155a93483c52`, con:
  - ubicaciones en Zona Norte (2 establecimientos) y Zona Sur, desde el 01/09/2026;
  - el supervisor de prueba (`3414677e-de69-441b-9ae0-a712257dc25c`) como responsable de carga;
  - el concepto horario "Sereno" habilitado.
- `AuditLog` de esas operaciones, de los logins de QA y de un rechazo de ruta de la prueba de permisos.
- Ninguna escritura sobre los 32 legajos originales.
- No se guardó ninguna convocatoria a feriado.

No se ejecutó M2, seed, limpieza, restauración ni reconciliación.

### 16.7 Capturas

`docs/qa/a7-*.png`:
- Legajos: `within-losod`, `covers-losod`, `filtro-sin-modo`, `pendientes-recarga`, `zona-fecha`, `1366`, `1920`, `mobile`, `tabla-mobile`.
- Organigrama: `funcional-within`, `popover`, `supervision`, `mobile`.
- `panel-asociados`, `feriados-filtros` y `dashboard-supervision`.

### 16.8 Pendiente para cerrar A7

- Decidir D-7, D-8, D-4 y D-5; luego adaptar el dashboard y reportes, el organigrama (banda y contexto) y, con comparación previa, el motor de horas especiales.
- Configuración de reglas de horas especiales: tratamiento del selector de sector según D-4.
- `User.sectorId` (alcance de usuarios) y `ClockDevice` (sector → establecimiento): fuera de este corte.
- Observado: el resumen del organigrama muestra el responsable de carga sólo por `personName`, así que una asignación por usuario aparece como "-". Es previo a esta etapa y no se modificó.

## 17. A7 — continuación (2026-10-07)

### 17.1 Reglas de horas especiales y sectores del modelo nuevo

- **Backend** (`workforce.service.ts`, `assertRuleSectorSupported`):
  - Crear una regla con un sector del árbol nuevo, o **cambiar** una existente hacia uno, responde `409 DOUBLE_HOUR_RULE_SECTOR_NOT_SUPPORTED`. El mensaje explica que la regla no alcanzaría a nadie y sugiere otras dimensiones.
  - Se valida **antes** de la transacción: no se escribe ni se reinterpreta.
  - Reenviar el sector actual de una regla, o editar otras dimensiones, no se valida ni cambia su alcance. Un sector anterior sigue permitido.
- **Pantalla** (`WorkScheduleSettingsPage`):
  - El selector se llama "Sector anterior" y ofrece sólo sectores anteriores activos, más el sector que la regla ya tenga.
  - "Empresa empleadora" está rotulada así porque es la empresa que compara el motor.
  - Una nota explica por qué los sectores nuevos no se pueden usar.
- "Domingos" (empresa LOSOD, sin sector) no se modificó.
- Esto **no decide D-4**: sólo impide configurar reglas que hoy no tendrían efecto.

### 17.2 Inventario de dependencias antes de M2

M2 elimina las columnas del modelo anterior y vuelve obligatorios los padres nuevos (§7). Ninguna se eliminó ni se adaptó en esta etapa.

| Dependencia | Uso actual | Tratamiento propuesto | Etapa | Decisión pendiente |
|---|---|---|---|---|
| `Employee.sectorId` (FK SET NULL) | Estructura anterior en Datos Laborales; filtro "Sector anterior"; búsqueda y resumen del organigrama; convocatorias y paneles; dashboard de Nivel 2 y Reportes; selects de grilla horaria, asistencia y validación anterior; **motor de horas especiales** (dimensión sector) | La limpieza (B3) lo pone en NULL, pero antes hay que retirar todas sus lecturas y M2 elimina la columna. Ya es de sólo lectura (A6) | A8 + M2 | D-4 (motor), D-8 (dashboard) |
| `Position.sectorId` (FK SET NULL) | Puestos anteriores "pendientes de recarga"; cadena derivada en `positionInclude`/`positionOptionSelect`; búsqueda por nombre de sector; validación anterior del legajo | Retirar la cadena derivada y las comparaciones anteriores cuando no queden puestos sin alcance | A8 + M2 | — (la recarga de puestos depende de D-6) |
| `Sector.areaId`, `Area.establishmentId`, `Establishment.companyId`/`businessUnitId` | Catálogo de Organización (marca "Pendiente de recarga", `legacyLocation`); vínculos anteriores de centros de costo; cadenas derivadas de legajo y puesto; herramientas A3 | M2 los elimina y vuelve obligatorios `Sector.businessUnitId`, `Area.sectorId` y `Establishment.zoneId`. La guarda SQL de M2 aborta si queda un valor anterior | M2 | D-1 (empresas) |
| `Establishment @@unique([companyId, code])` | Unicidad del código por empresa | Al eliminar `companyId` hay que definir otra unicidad: código global o `(zoneId, code)` | M2 | **D-13** |
| `User.sectorId`, `User.companyId` (FK sin `onDelete`) | Usuarios muestra y edita un "alcance" (empresa - sector); `userApiService` resuelve el sector **por nombre** (mismo riesgo de homónimos que tenía el legajo); `AuthUser.sectorId`; clave de caché del dashboard (backend) y del frontend. **No se usa para permisos**: el acceso es por responsable de carga | La limpieza pone `User.sectorId` en NULL (y `companyId` en C2). Hasta decidir, no cambiar permisos ni el concepto | A8 + M2 | **D-14** |
| `ClockDevice.sectorId` (FK SET NULL) y `ClockDevice.establishmentId` (M1, RESTRICT) | Al activar un dispositivo se elige un sector, incluidos los del árbol nuevo; el listado muestra el sector; filtro `sectorId`; el contexto de credencial incluye `sectorId` sin usarlo. Metadato: no autoriza ni ubica fichadas. Inventario A3: 0 filas con sector | Pasar el formulario y el listado a establecimiento (zona derivada); dejar de leer `sectorId` antes de M2 | Etapa de fichador, antes de M2 | **D-15** |
| `DoubleHourRule.sectorId` (FK RESTRICT desde M1) | Dimensión sector del motor (sector anterior). Hoy 0 reglas la usan; guarda §17.1 | Se conserva la columna (§6). Tras la limpieza, toda regla que apunte a un sector anterior bloquea M2/limpieza (R1/R2/R3) | B / A7 | D-4 |
| Vínculos anteriores de `CostCenter*` | La UI de A4 los identifica y permite quitarlos | La limpieza los borra explícitamente. Las tablas se conservan | B3 | D-1 |
| `EmployeeFieldHistory`/`EmployeeBlockHistory`, `AuditLog` | Copias en texto de nombres de sector y cadena | Se conservan sin cambios (sin FK) | — | — |
| Frontend: datos de demostración (`mockData`, `mockOrgStructure`, `employeeMockService`), `structureOptions` (UN/establecimiento/área/sector por nombre), campos derivados de `positionApiService`, `positionAllowedValues` | Modo demostración y validación anterior | Retirar o adaptar junto con las lecturas anteriores | A8 | — |
| Herramientas A3 (`org-reorg-*`) | Dependen del modelo anterior por diseño | Se retiran después de B4 | Después de B | — |
| `DashboardPage`: el filtro de Nivel 2 compara `employee.sector` con `user.sector` (ID) | Se pasa a `getMetrics(_scope)`, que lo ignora: código muerto | Eliminar en A8 | A8 | — |

### 17.3 Responsable de carga asignado por usuario en el organigrama

- El select del organigrama ahora trae `assignments.user.name`. Sólo el nombre visible: nunca email ni otros datos.
- `mapEmployeeFromApi` usa `personName` y, si falta, el nombre del usuario vinculado. Esto también corrige la pestaña Responsables del legajo, que ya traía el usuario pero no lo mostraba.
- Los permisos no cambian: el endpoint sigue siendo de RRHH y Supervisión, y está acotado por `employeeAccessWhere`. Supervisión ve el dato sólo de sus legajos.
- Efecto conocido: si RRHH guarda luego la pestaña Responsables de ese legajo, la asignación se reenvía con `personName` igual al nombre del usuario y conserva el `userId` (resolución existente por nombre).

### 17.4 Cambios de puesto, alcance o ubicación frente a horas, desgloses y cierres

**Garantía vigente.** Ninguna de estas operaciones recalcula nada en el momento:
- cambiar el puesto, el centro de costo o la empresa empleadora del legajo;
- editar el alcance de un puesto;
- cambiar la estructura de Organización o Ubicaciones;
- cargar, cambiar, finalizar o corregir ubicaciones.

Lo fijan dos tests:
- `structureChanges.noRecalculation.test.ts`: el `update` del legajo no resuelve multiplicadores, y los módulos de ubicaciones, puestos y estructura no importan el motor, los cierres ni los desgloses;
- `doubleHourRuleScope.characterization.test.ts`: el criterio actual del motor.

**Entradas del motor** (`resolveSpecialHourRulesByDate`): `Employee.positionId`, `costCenterId`, `sectorId` (anterior) y `EmployeeCompany` (empleadora), leídos con su valor **actual**, sin historia por fecha. `PositionOrgScope` y `EmployeeWorkLocation` **no** son entradas.

**Caminos que recalculan filas pasadas** (los que resuelven horas especiales lo hacen con el alcance actual):

| Camino | Disparador | Qué reescribe | Cierres |
|---|---|---|---|
| `reinterpretSpecialHours` | Crear, editar o eliminar una regla de horas especiales | `TimeEntry.appliedMultiplier`, multiplicador de desgloses, `TimeSegment` especial y `SpecialHourRuleApplication`, en la ventana del calendario anterior y nuevo de la regla, para **todos** los legajos | Reconstruye los snapshots de cierres afectados, incluidos `ENVIADO`/`APROBADO`, con auditoría |
| `reinterpretSpecialHoursOnDates` | Guardar una convocatoria a feriado | Lo mismo, para esa fecha | Igual |
| `reconcile-special-hours` (script) | Manual, dry-run o `--apply` con respaldo | Lo mismo, por ventanas | Igual |
| `reconcile-normal-hours` (script) | Manual, dry-run o `repair` con snapshot | Sólo Horas base (`NORMAL_BASE`) derivadas de jornadas fichadas (reparación 15M.4). **No lee el alcance del legajo** | No los reconstruye |
| Recalcular desgloses automáticos | Manual por legajo y período | Desgloses `AUTOMATIC` del período, con el multiplicador resuelto en ese momento | Bloqueado con período cerrado (`409 PERIOD_CLOSED`) |
| Alta o edición de una carga o de un desglose manual | Usuario | Sólo la fila, con el multiplicador resuelto al guardar | RRHH puede corregir un período cerrado con motivo |
| Procesamiento del fichador y sus catch-ups | Fichada o tarea automática | Snapshot al procesar; un catch-up puede procesar días después | — |

**Limitaciones.**
- Tras cambiar puesto, centro de costo o empresa empleadora, cualquiera de esos disparadores aplica el alcance **nuevo** a fechas anteriores. Esto ya ocurría antes de la reorganización.
- Ejemplos:
  - una regla por puesto que se edita después de reasignar a una persona cambia sus horas pasadas;
  - una convocatoria a feriado reinterpreta esa fecha con la empresa empleadora actual.
- Hoy el alcance del puesto y las ubicaciones no afectan, porque el motor no los lee. Si D-4 los incorpora sin historia, heredarían la misma limitación.

**Qué falta para garantizarlo** (requiere D-5; nada se implementó ni ejecutó):
- H2: historia con vigencias de las entradas del motor (puesto, centro de costo, empleadora y, si D-4 lo decide, alcance o ubicación), o un snapshot del alcance en cada carga o segmento al procesar. Así la reinterpretación usaría el valor vigente en cada fecha.
- H3: excluir de la reinterpretación los períodos cerrados (`ENVIADO`/`APROBADO`), o exigir una reapertura explícita.
- Antes de cualquier adaptación, un comparador antes/después en la copia, con el motor real dentro de una transacción revertida, como el dry-run de `reconcile-special-hours`, aceptando sólo cambios esperados.
- Opcional: avisar al editar una regla o convocatoria si la ventana incluye fechas anteriores a un cambio de puesto, centro de costo o empleadora de algún legajo alcanzado.

No se ejecutó ninguna reconciliación ni recálculo.

### 17.5 QA en la copia aislada

- Instancia propia (4012) cargando `backend/.env.reorg` (host `ep-rough-river…`), `AUTOMATIC_JOBS_DISABLED`, más un Vite en 5184. Ambos se detuvieron al terminar.
- **API, 7/7:**
  - crear una regla con sector nuevo y cambiar "Domingos" hacia uno: ambos `409`, sin reglas nuevas, con "Domingos" sin cambios (mismo `updatedAt`);
  - Supervisión no puede crear reglas;
  - el organigrama trae `user.name` (sin email) para `QA-A7-001`;
  - Supervisión ve el dato sólo en su legajo.
- **Huella de sólo lectura antes/después** (conteo + hash): idénticas en `TimeEntry` (85), `HourConceptBreakdown` (26), `MonthlyTimeClosure` (7), `DoubleHourRule` (2), `SpecialHourRuleApplication` (22), `TimeSegment` (56) y "Domingos".
- **Visual:** el selector ofrece 42 sectores anteriores y no el nuevo; nota en 1440 y 390 sin desborde; el resumen del organigrama muestra "Supervisor Demo".
- Capturas: `docs/qa/a7-reglas-alcance-desktop.png`, `a7-reglas-alcance-mobile.png` y `a7-organigrama-responsable-usuario-desktop.png`.
- Escrituras: ninguna salvo `AuditLog` de logins y de los rechazos de ruta. Las pruebas de reglas fueron sólo rechazos.

### 17.6 Instancia local del puerto 4002

Después de detenerla (§16.1), `npm run dev` se volvió a iniciar a las 13:43 desde la misma terminal. Sigue cargando `backend/.env` (development, sin M1) y recarga en caliente el código de esta rama. Se tomó como un reinicio deliberado: no se detuvo ni se usó. Conviene no correrla sobre esta rama, o apuntarla a la copia.

## 18. A7 — decisiones ratificadas y continuación

Se ratificaron D-4, D-5, D-7, D-8, D-13, D-14 y D-15. D-1, D-2, D-3 y D-6 continúan abiertas; en particular, conservar `Company` sigue siendo una recomendación, no una decisión aprobada.

### 18.1 Protección de cierres (D-5)

- `ENVIADO`, `APROBADO` y `CORRECCION_PENDIENTE` son estados protegidos.
- Todas las escrituras de horas, desgloses, tramos y reinterpretaciones toman un advisory lock compartido por `employeeId + period` y vuelven a leer el cierre dentro de la transacción. Enviar/aprobar/devolver y el procedimiento de corrección toman el lock exclusivo.
- Reglas, convocatorias, reconciliación, recálculos automáticos y fichadas atrasadas no reconstruyen ni reabren cierres protegidos. Informan los pares omitidos. Eliminar una regla se rechaza si perdería la traza de uno de esos períodos.
- La corrección explícita de RRHH conserva motivo, auditoría y lock exclusivo.

### 18.2 Motor de sector (D-4) y falta de historia

- Empresa sigue significando empresa empleadora (`EmployeeCompany`).
- Un sector nuevo usa “Ubicado dentro de”: matchea un alcance del puesto en ese sector o en un área hija. Un alcance en empresa o unidad de negocio no hereda reglas de todos sus sectores. Múltiples alcances se evalúan con `some`.
- Sectores anteriores conservan la comparación con `Employee.sectorId`; no se convierten automáticamente. “Domingos” conserva empresa LOSOD y sus referencias.
- Si una regla de sector nuevo intenta evaluar una fecha anterior a la revisión vigente de `PositionOrgScope`, el motor responde `409 SPECIAL_HOUR_SCOPE_HISTORY_MISSING`, identifica fecha/período y no reinterpreta con valores actuales.
- La auditoría de Puestos conserva los snapshots antes/después de cada cambio de alcance. Falta una historia normalizada y consultable por fecha para posición, empresa empleadora y centro de costo; por eso A7 no puede considerarse cerrada todavía.

### 18.3 Filtros, organigrama y dotación (D-7/D-8)

- Legajos y Puestos usan `WITHIN` (“Ubicado dentro de”) por defecto; `COVERS` (“Abarca”) es alternativo explícito.
- El organigrama puede devolver encargados directos vinculados a un usuario/legajo fuera del filtro en `context`; vuelve a aplicar `employeeAccessWhere`, no los incluye en `meta.total` ni en exportaciones.
- Dotación se calcula por zona vigente, con personas únicas por zona, grupo “Sin ubicación vigente” y total general de personas únicas. Una persona puede figurar en varias zonas, por lo que las barras no se suman. Se conserva el mismo universo activo y los mismos permisos.

### 18.4 Usuarios, dispositivos y establecimientos (D-13/D-14/D-15)

- Usuarios ya no expone ni acepta sector. `User.sectorId` se conserva como columna legacy; empresa continúa como dato administrativo y no interviene en permisos ni en la clave de caché.
- Dispositivos exponen, filtran y asignan `establishmentId`, mostrando `Zona · Establecimiento`. No cambia autenticación, autorización ni procesamiento de fichadas y no se infiere la ubicación laboral de personas.
- `ClockDevice.establishmentId` ya existía en M1, por lo que no fue necesaria otra migración.
- D-13 se aplicará en M2 como unicidad `(zoneId, code)`. La restricción anterior no se elimina en A7.

## 19. A7 — historia temporal normalizada (D-5, 2026-10-08)

### 19.1 Modelo y semántica

La migración aditiva `20261008090000_labor_history_periods` agrega vigencias cerradas de días `[effectiveFrom, effectiveTo]` (`NULL` = abierta) para:

- puesto, centro de costo y sector anterior del legajo;
- conjunto de empresas empleadoras del legajo;
- alcance organizacional del puesto, incluyendo en cada nodo AREA el sector padre vigente al registrar el snapshot.

Los `CHECK` validan el intervalo y la coherencia nivel/FK; exclusiones GiST con `btree_gist` impiden superposiciones incluso bajo concurrencia. Las FKs de historia usan `RESTRICT` hacia legajo, puesto, estructura y centro de costo; autoría usa `User onDelete: SetNull`. La historia no se borra ni se debilita para liberar dependencias.

Un cambio desde D cierra la vigencia que contiene D en D−1 y abre la nueva en D. Si D coincide con el inicio, corrige esa vigencia con auditoría. No se aceptan programaciones futuras ni fechas anteriores al inicio de la vigencia actual. La columna vigente, vigencias, historial visible y auditoría comparten la misma transacción `Serializable`.

### 19.2 Motor y cierres

`resolveSpecialHourRulesByDate` evalúa por fecha las dimensiones que cada regla realmente restringe. Empresa conserva la semántica de empleadora; puesto, centro de costo y sector legado usan la vigencia del legajo; un sector nuevo usa WITHIN sobre el snapshot del alcance del puesto. Una dimensión no restringida no exige historia.

La ausencia de cobertura devuelve `SPECIAL_HOUR_SCOPE_HISTORY_MISSING`; nunca usa valores actuales para inventar pasado. Las cargas normales y atrasadas funcionan cuando existe cobertura suficiente. Los cambios de legajo o alcance que alcanzarían cierres `ENVIADO`, `APROBADO` o `CORRECCION_PENDIENTE` toman los locks compartidos y se rechazan dentro de la transacción. Los demás disparadores automáticos conservan las protecciones de §18.1.

### 19.3 Integración y transición

- Legajos exige fecha y motivo al cambiar puesto, centro de costo o empresas; Puestos los exige al cambiar `orgScopes`.
- La UI muestra los controles junto al campo modificado y explica que no recalcula fechas anteriores.
- Inventario, limpieza y restauración reconocen las siete tablas nuevas. Cualquier referencia histórica hacia el inventario bloquea la limpieza; no se elimina historia. En particular, una **empresa referenciada por historia conserva su ID** (R1 no aplica, ver §6) y C2 aborta si le corresponde borrarla.
- No se inicializaron masivamente los 32 legajos originales ni puestos anteriores. La cobertura inicial se resolverá con el procedimiento posterior y evidencia verificable. Hasta entonces, las cinco fechas originales que dependen de “Domingos” permanecen deliberadamente en `MISSING:EMPLOYER`.

### 19.4 Migración y QA de copia

Destino: copia Neon `org-location-reorg`, host `ep-rough-river-aioy7xp9-pooler.c-4.us-east-1.aws.neon.tech`, con `AUTOMATIC_JOBS_ENABLED=false`. Antes de migrar se guardó un respaldo lógico con SHA-256 y un manifiesto. `migrate status` mostró sólo `20261008090000_labor_history_periods`; `migrate deploy` aplicó sólo esa migración. La comparación pre/post dejó 61 tablas existentes idénticas, `_prisma_migrations +1` y siete tablas nuevas vacías. M2 no se creó ni aplicó.

Las 18 pruebas SQL de constraints corrieron dentro de una transacción revertida: intervalos, superposición presente/futura, concurrencia, coherencia de nodos y FKs `RESTRICT`, todas con el SQLSTATE esperado. El QA API verificó cambios laborales con vigencia, alcance de puesto compartido, resolución antes/después, cargas atrasadas, falta de cobertura sin escrituras parciales, fechas límite/futuras, concurrencia y cierre ENVIADO intacto.

La comparación post-migración/post-QA mostró `0` filas preexistentes modificadas o eliminadas. Para los 78 pares fecha-legajo originales: 73 conservaron exactamente el resultado y 5 quedaron `SPECIAL_HOUR_SCOPE_HISTORY_MISSING`; hubo `0` cambios de valor. Se conservaron “Domingos”, horas, desgloses, cierres, los 32 legajos originales y las cinco filas incidentales de §13.3. El QA visual nuevo revisó Legajo/Datos Laborales y Puesto/Identificación en desktop, sin desbordes ni solapamientos; los controles de fecha/motivo y el aviso de alcance compartido respetan el sistema visual existente.

### 19.5 Límite real antes de M2

A7 queda cerrada en código y copia, pero no completa historia inexistente. Antes de B/M2 siguen pendientes: decidir D-1/D-2/D-3/D-6; obtener verificación administrativa Neon para los scripts destructivos; ejecutar el procedimiento aprobado de respaldo/ensayo/limpieza/recarga; cargar historia sólo con evidencia; y retirar columnas legacy en A8. No se ejecutó limpieza, restauración, seed, reconciliación general ni M2.

## 20. A8 — correcciones tras la revisión de Codex (2026-10-08)

Revisión de Codex sobre la preparación A8 (`b826dba`). Correcciones aplicadas sólo en documentación
(`docs/decisions/A8_M2_PREPARATION.md` y este ADR); sin migraciones, código ni datos.
Marcas del A8: **[R]** medido en reporte identificable · **[C]** verificado en código · **[D]** diseño pendiente.

| # | Hallazgo | Corrección |
|---|---|---|
| 1 | **LEGACY_SECTOR.** La clasificación de una regla como sector legado se deriva del padre actual (`sectorIsLegacy = !rule.sector.businessUnitId`, `timeEntries.repository.ts:231`). Hacer `Sector.businessUnitId` NOT NULL (M2) o asignarlo a un sector retenido **reinterpreta históricamente** la regla (pasa de comparar `EmployeeLegacySectorPeriod` a evaluar alcances con `WITHIN`) | Registrado como **bloqueo funcional** (A8 §3.4): exige **clasificación persistente e independiente del padre actual** (A8-3) y **pruebas de equivalencia antes/después** con el motor real antes de autorizar M2. **El soporte legado no se retira** mientras exista evidencia que lo necesite (`EmployeeLegacySectorPeriod`) |
| 2 | **Nodos históricos.** "Reubicar como INACTIVO" no es una solución general | Retirada. HT-2 (A8 §3.3) distingue **identidad del registro**, **ruta histórica conservada**, **ruta administrativa actual** y **semántica usada por reglas**. Sólo se admite una conversión **demostradamente neutra** en esos cuatro planos, con equivalencia antes/después; si no puede demostrarse, **el nodo se conserva y M2 queda bloqueada**. **Nunca se inventa un padre para satisfacer el NOT NULL** |
| 3 | **Cobertura desde el corte.** Los 78 pares históricos (73 iguales, 5 `MISSING`, 0 cambios de valor [R]) no bastan | Nuevo procedimiento A8 §6.1 con **fecha de corte obligatoria** (hoy **sin elegir ni ejecutar**): la recarga abre **períodos auditados desde esa fecha** para las dimensiones aplicables, **incluidos los alcances de puestos**; verificación de cobertura **por intervalos** `[corte, hoy]` y de **coherencia con los datos actuales**; **antes de la corte se conserva `MISSING`** donde falte evidencia real |
| 4 | **Empresas históricas.** R1 no puede usarse para liberar referencias históricas a `Company` | **R1 acotado a referencias de catálogo** (§6, aclaración) y aclarado en §19.3: una empresa referenciada por historia **conserva su ID**, su FK **no se reasigna** y su historia **no se borra**; **C2 aborta** en ese caso, salvo redefinición posterior aprobada que conserve empresas históricas |
| 5 | **Guardas y pendientes** | La guarda de M2 se reescribió **por clases de fila** (eliminables / retenidas por historia / nuevas, A8 §4.1). **`User.companyId` no se exige NOT NULL**: sigue nullable y administrativo. **D-15 está ratificada** y su retiro de `ClockDevice.sectorId` de autenticación y tipos (`clockDevices.repository.ts:53`, `clockDeviceAuthentication.ts`, `express.d.ts:24`) queda como **pendiente de implementación** (A8 §5.2). **A8-4** se conserva como validación pendiente de índices y planes de consulta (`EXPLAIN` de listados) |
| 6 | **Evidencia** | A8 §1 define el criterio **[R]/[C]/[D]**; todos los conteos quedan ligados a su reporte (`../backups/d5-*-2026-10-08.json`), el impacto de las 5 fechas se atribuye a ADR §12.2 (reporte 2026-10-07, previo a D-5 y **no re-medido**) y los comportamientos se presentan como verificación de código, **no como medición** |

Pendientes derivados: A8-3 (clasificación persistente), A8-5 (fecha de corte), D-0, D-1, D-2, D-3, D-6.
Nada de lo anterior se ejecutó: sin M2, limpieza, restauración, seed, reconciliación, escritura en bases
ni despliegues.
