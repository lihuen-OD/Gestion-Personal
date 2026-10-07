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
| D-7 | Modo de filtrado por defecto; banda "Alcance superior" en el organigrama | A7 |
| D-8 | Reemplazo de "Dotación por sector" | A7 |
| D-10 | Empresa propietaria de un establecimiento | — |
| D-11 | Múltiples encargados en la vista funcional (hoy se usa el primero; no se cambia en silencio) | — |
| D-12 | Merge y despliegue frente a producción | B5 |

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
| A7–A8, B0–B5 | Pendientes |

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

