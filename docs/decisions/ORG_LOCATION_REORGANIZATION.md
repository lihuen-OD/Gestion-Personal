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
| D-2 | Zona completa en ubicaciones | A6 |
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
| A3–A8, B0–B5 | Pendientes |

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
