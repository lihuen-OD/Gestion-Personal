# A8 — Preparación de M2 y retiro del modelo anterior

Fecha: 2026-10-08
Rama: `feat/org-location-reorg` — base `b826dba` (revisión de Codex) → correcciones de este documento
Estado: **diagnóstico y diseño previos. Sin ejecución destructiva ni cambios de código.**

> Alcance de este documento: preparar A8 para revisión (ADR `ORG_LOCATION_REORGANIZATION.md`, etapa A8).
> No ejecuta M2, limpieza, restauración, seed ni reconciliación; no escribe en ninguna base;
> no modifica `development` ni producción; no hace push, merge ni despliegue; no toca notificaciones.
> Referencias: ADR §5–§8 (alcance y ensayo), §17.2 (inventario previo), §18–§19 (A7 cerrada, D-5).

## 1. Fuentes y criterio de evidencia

**Fuentes**
- `AGENTS.md` y ADR `docs/decisions/ORG_LOCATION_REORGANIZATION.md` (completo, §11–§19).
- `git status` (limpio), `git log` (A7 cerrada en `46ac79a`; preparación A8 en `b826dba`).
- Esquema real: `backend/prisma/schema.prisma` + migraciones `20261007120000_org_location_expand` (M1)
  y `20261008090000_labor_history_periods` (D-5). **No existe ninguna migración M2** (ni reversión).
- Reportes de solo lectura sobre la copia `org-location-reorg`, en `../backups/` (fuera del repositorio):
  `d5-org-reorg-inventory-copy-2026-10-08.json`, `d5-coverage-pre-qa-2026-10-08.json`,
  `d5-engine-before-vs-after-qa.summary.json`, `d5-engine-after-qa-2026-10-08.json`,   y los de A8-3
  (`a8-3-*-2026-10-08.json`: snapshot lógico de filas con SHA-256, manifiestos pre/post, verificación
  de la columna, motor antes/después y comparaciones; §3.4, incl. límites del snapshot).

**Criterio de evidencia (usado en todo el documento)**
- **[R] Medido:** número o resultado proveniente de un reporte de solo lectura identificable
  (archivo + fecha). Ningún conteo sin reporte se presenta como medición.
- **[C] Verificado en código/esquema:** lectura de fuente con `path:línea`. Describe qué hace el código
  hoy; **no** es una medición de comportamiento en ejecución.
- **[D] Diseño/propuesta:** requisito o plan aún no ejecutado.
- Una afirmación sin marca debe leerse como [D].

## 2. Inventario de dependencias que M2 eliminaría [C]

M2 es la migración de contracción (ADR §7): elimina las columnas del modelo anterior y vuelve
obligatorios los padres nuevos, con una guarda SQL previa que aborta ante cualquier valor viejo.

### 2.1 Esquema — columnas, relaciones e índices

| Objeto | Schema (col / relación) | `onDelete` efectivo | Índices o únicos asociados | Tratamiento M2 |
|---|---|---|---|---|
| `Employee.sectorId` | 769 / 780 | SET NULL | `@@index([status, sectorId])` 819, `@@index([sectorId])` 821 | DROP columna + índices |
| `Position.sectorId` | 676 / 682 | SET NULL | `@@index([sectorId])` 692 | DROP columna + índice |
| `Sector.areaId` | 534 / 539 (`LegacyAreaSectors`) | SET NULL | `@@index([areaId])` 554 | DROP columna + índice |
| `Area.establishmentId` | 511 / 516 | SET NULL | `@@index([establishmentId])` 523 | DROP columna + índice |
| `Establishment.companyId` | 476 / 490 | **RESTRICT** | `@@unique([companyId, code])` 499 | DROP columna + único; **D-13**: nuevo `@@unique([zoneId, code])` |
| `Establishment.businessUnitId` | 477 / 491 | SET NULL | `@@index([businessUnitId])` 500 | DROP columna + índice |
| `User.sectorId` | 363 / 369 | SET NULL | — | DROP columna |
| `User.companyId` | 362 / 368 | SET NULL | — | **Se conserva**, **nullable** y administrativo (D-14); nunca se exige NOT NULL |
| `ClockDevice.sectorId` | 1957 / 1974 | SET NULL | `@@index([sectorId])` 1985 | DROP columna + índice; **antes** retirar sus lecturas de autenticación/tipos (§5.2) |

**Se conservan en M2:** `BusinessUnit.companyId` (ambos modelos lo usan), `DoubleHourRule.companyId/sectorId/costCenterId/positionId` (ADR §6),
las siete tablas de historia (incl. `EmployeeLegacySectorPeriod`), `EmployeeCompany`, `CostCenter*`, `PositionSalaryCategory`.

### 2.2 Padres nuevos que pasan a obligatorios [D]

| Columna | Estado en M1 | M2 |
|---|---|---|
| `Sector.businessUnitId` | nullable, FK RESTRICT | NOT NULL |
| `Area.sectorId` | nullable, FK RESTRICT | NOT NULL |
| `Establishment.zoneId` | nullable, FK RESTRICT | NOT NULL |

> Alerta derivada del hallazgo 1 (§3.4): el NOT NULL de `Sector.businessUnitId` no es sólo DDL:
> cambia la clasificación histórica legado/nuevo de las reglas. **Mitigado por A8-3 (2026-10-08):**
> la clasificación vive ahora en `Sector.isLegacy` y el motor ya no deriva nada del padre actual.
> **Especificación §12 (D-B1 aprobada, 2026-10-08):** los tres `NOT NULL` de la tabla se sustituyen
> por CHECKs condicionales por forma de fila (`archivedAt`, §12.3): el padre nuevo sigue obligatorio
> para toda fila activa, pero no para la fila archivada. Falta implementar y validar §12 (§12.11).

### 2.3 Consumidores — backend [C]

| Área | Archivos | Lectura/escritura legacy |
|---|---|---|
| Legajos (selects) | `employees/employees.repository.ts` (106-120, 134-196, 226-281, 330-395, 477-549, 590-613, 632-655, 789-835, 1306-1337) | cadenas `sector.area.establishment.businessUnit`, `position.sectorId` |
| Legajos (filtros) | `employees.repository.ts` 891-978, `employees.schemas.ts` 19-44, 95; `shared/prisma/employeeStructureWhere.ts` 15-71; `shared/prisma/employeeAssociationQuery.ts` 18-65 | `query.sectorId`, "Sector anterior", búsqueda por nombre de sector |
| Legajos (escritura) | `employees.repository.ts` 958-1007; `employees.service.ts` 411-421 (`EMPLOYEE_LEGACY_SECTOR_READ_ONLY`), 789-811, 856, 894 | `sectorId` de sólo lectura, validación derivada de la cadena anterior |
| Puestos | `positions/positions.repository.ts` 14-97 (`positionInclude`, `positionOptionSelect`), 190-198; `positions.service.ts` 35-83 | cadena legada + `sectorId` |
| Estructura | `org-structure/orgStructure.repository.ts` 42-94, 168-187, 304-367; `orgStructure.dependencies.ts`; `reorg/cleanupPlan.ts` 48-84; `reorg/manifest.ts` 14-17 | padres legacy, `isLegacy`, unicidad `companyId+code`, plan de limpieza |
| Motor de horas especiales | `time-entries/timeEntries.repository.ts` 227-235 (`ruleScopeOf`: `sectorIsLegacy` derivado de `rule.sector.businessUnitId`), 304-378; `workforce-management/workforce.service.ts` 142-146; `doubleHourRuleMatching.ts` 123-140 | clasificación legado/nuevo por lectura (§3.4) + empresa empleadora; **la resolución por fecha lee sólo historia** (`labor-history/laborHistory.service.ts:212-222`) |
| Historia laboral | `labor-history/laborHistory.scope.ts` 42-89; `laborHistory.repository.ts` 45-139 | dimensión `LEGACY_SECTOR`; tablas de vigencias (se conservan) |
| Usuarios / auth | `users/users.repository.ts` 11-87; `users.schemas.ts` 20, 29; `types/express.d.ts` 10-24 | `companyId` (se conserva). `AuthUser.sectorId`: **el `publicUserSelect` no lo selecciona** y sólo aparece como fixture `null` en `auth.service.test.ts:43` [C] |
| Dashboard | `dashboard/dashboard.service.ts` 85-102 (payload `sector`, clave de caché con `companyId`); `dashboard.repository.ts` 238 | columna "Sector anterior" del payload; clave de caché |
| Dispositivos | `clock-devices/clockDevices.repository.ts` 53, 108-119; `clockDeviceAuthentication.ts` 19, 71; `types/express.d.ts:24` | lectura de `sectorId` en credencial → `req.clockDevice.sectorId` (pendiente de retiro, §5.2) |
| Otros filtros | `pending/pending.repository.ts` 49-84; `shifts/holidayWorkAssignment.*.ts` 19-47; `hour-concepts/hourConcepts.schemas.ts` 38-40; `work-regimes/workRegimes.schemas.ts` 79-81 | `sectorId`/`companyId` en listados y candidatos |

### 2.4 Consumidores — frontend [C]

| Área | Archivos | Lectura legacy |
|---|---|---|
| Filtros de estructura | `components/employees/structureFilters/employeeStructureFilters.ts` (23-89), `EmployeeStructureFilterControls.tsx` (35-91) | `legacySectorId → params.sectorId`, "Sector anterior" |
| Páginas | `EmployeesPage.tsx` (62-98), `HolidayWorkAssignmentsPage.tsx` (164, 345), `WorkScheduleSettingsPage.tsx` (62-474), `DashboardPage.tsx` (32, 51, 119), `PuestosPage.tsx` (28, 57), `UsersPage.tsx` (41-267) | filtros/selectores por sector anterior; columna "Sector anterior"; filtro de Nivel 2 |
| Servicios API | `employeeApiService.ts`, `positionApiService.ts` (38-160, campos `derived*`), `orgStructureApiService.ts` (34-267, padres legacy y `pendingReload`), `holidayWorkAssignmentApiService.ts` (48-78), `workforceApiService.ts` (110-148), `userApiService.ts` (15-106), `apiClient.ts` (34-41) | parámetros, campos derivados de la cadena, etiquetas de error |
| Tipos | `types/orgStructure.types.ts`, `types/position.types.ts` (36-63), `types/index.ts` (10-17), `types/associatedEmployee.types.ts` | columnas y `derived*Id` |
| Organización | `components/org-structure/orgStructureEntities.ts` (82-188), `orgScopePath.ts`, `orgStructureTree.ts`, `OrgStructureTable.tsx`, `orgStructureTree.fixtures.ts` | padres legacy, etiquetas "Pendiente de recarga" |
| Caché | `services/cache/cacheKey.ts` 19-37 | `sectorId` en el alcance de la clave. **[C]** `authApiService.ts:37` envía `sector: undefined`, de modo que el valor en runtime sería `null`; **no está medido en ejecución** |
| Datos demo / fixtures | `data/mockOrgStructure.ts`, `data/mockPositions.ts`, `data/mockData.ts`, `services/employeeMockService.ts`, `services/api/dashboardMetricsApiService.ts:11` | forma legacy completa |

### 2.5 Scripts, seed, fixtures y contratos de prueba [C]

- `backend/prisma/seed.ts`: escribe `User.sectorId` (93, 99), `Position.sectorId` (349), `Employee.sectorId` (366);
  y busca el establecimiento por zona "porque `companyId` único no admite `companyId IS NULL`" (76-88) — workaround que caduca con D-13.
- `backend/scripts/org-reorg/*` e `org-reorg-*.ts`: dependen del modelo anterior por diseño (se retiran después de B4).
  `org-reorg-restore.ts:38` declara `LEGACY_COLUMNS` (5 columnas) — **sólo válido antes de M2**.
- `backend/scripts/labor-history/simulatedReaders.ts`: simula la eliminación de columnas para comparar el motor.
- E2E: `frontend/e2e/support/adminConfigurationJourney.ts:592` (contrato `GET /positions?sectorId=`),
  `performanceEmployeesJourney.ts:249` (contrato `GET /employees?companyId=`).
- Frontend fixtures: `orgStructureTree.fixtures.ts` y los `mock*` de §2.4.

### 2.6 Contratos y documentos a actualizar en el mismo cambio [D]

- `docs/BACKEND_API_CONTRACTS.md`: 49, 187, 203-230, 278-283, 416-429, 715-747, 769-781, 1060, 1172, 1694, 1750-1784.
- `docs/DATABASE_STANDARDS.md`: 60-66, 82-93, 174-178 (modelo actual descrito como "en transición").
- `docs/ARCHITECTURE_STANDARDS.md`: 65.
- `docs/PROJECT_CONTEXT.md`: 212, 357, 800-807, 939.
- `docs/SECURITY_STANDARDS.md`: 79-81 (`req.clockDevice.sectorId`, invariante "metadato, no autorización").
- `docs/PERFORMANCE_NETWORK_OPTIMIZATION_PLAN.md`: 240, 380 (contrato de filtros e índice `Employee(sectorId, status)`).
- `AGENTS.md:76` / `CLAUDE.md:69`: regla "modelo actual" (`Position.sectorId` / `Employee.sectorId`).
- `docs/decisions/HOLIDAY_WORK_ASSIGNMENTS_12D.md` (19-91) y `FICHADOR_STANDALONE_PWA_PLAN.md` (203-366, 1171, 1711-1716).

### 2.7 Tests que ejercitan columnas legacy [C]

- Backend: `employees.repository.test.ts`, `employees.service.test.ts`, `employees.laborAssignment.test.ts`,
  `structureChanges.noRecalculation.test.ts`, `employeeStructureWhere.test.ts`, `employeeAssociationQuery.test.ts`,
  `positions.repository.test.ts`, `positions.service.test.ts`, `orgStructure.*.test.ts`, `reorg/cleanupPlan.test.ts`,
  `reorg/manifest.test.ts`, `doubleHourRuleScope.characterization.test.ts`, `workforce.service.test.ts`,
  `laborHistory.scope.test.ts` (casos `sectorIsLegacy`), `clockDevice.schema.test.ts` (**afirma `ON DELETE SET NULL` de `ClockDevice.sectorId`**),
  `dashboard.service.test.ts`, `auth.service.test.ts`, `pending.service.test.ts`,
  `holidayWorkAssignment.*.test.ts`, `hourConcepts.*.test.ts`, `workRegimes.*.test.ts`.
- Frontend: `employeeStructureFilters.test.ts`, `PuestoIdentificationTab.test.ts`, `OrgStructurePage.test.tsx`,
  `PuestosPage.filters.test.ts`, `WorkScheduleSettingsPage.test.tsx`, `HolidayWorkAssignmentsPage.test.tsx`,
  `positionApiService.test.ts`, `orgStructureApiService.test.ts`, `cacheKey.test.ts`, `associatedEmployeeMapper.test.ts`.

## 3. Tablas históricas: períodos, evidencia y referencias

### 3.1 Las siete tablas de D-5 (migración `20261008090000`) [C]

`EmployeePositionPeriod`, `EmployeeCostCenterPeriod`, `EmployeeLegacySectorPeriod`,
`EmployeeEmployerPeriod`, `EmployeeEmployerPeriodCompany`, `PositionOrgScopePeriod`,
`PositionOrgScopePeriodNode`.

- Todas las FKs hacia legajo, puesto, estructura y centro de costo son **RESTRICT**;
  autoría (`createdByUserId`) es `SetNull`.
- **Regla inamovible (ADR §19.3, implementada en `cleanupPlan.ts:17-19, 74-83, 116-118`):**
  la historia no se borra, no se vacía y no se re-clava para liberar una referencia.
  `HISTORY_REFERENCES_INVENTORY` es un bloqueo de limpieza, no un tratamiento.

### 3.2 Catálogo actual vs. datos para resolver el pasado

| Tipo de referencia | Ejemplos | Tratamiento |
|---|---|---|
| **Catálogo actual** (limpiable con decisión) | `DoubleHourRule.companyId/sectorId/positionId`, vínculos `CostCenter*`, `PositionSalaryCategory`, cadena interna `Sector.areaId`… | R1/R2/R3 **sólo para referencias de catálogo**, `DELETE_LINKS`, `CHAIN` (ADR §5-§6) |
| **Datos para resolver el pasado** (nunca se tocan) | las 7 tablas de vigencias + `EmployeeFieldHistory`/`EmployeeBlockHistory` (texto), `AuditLog`, `SpecialHourRuleApplication`, cierres, horas, desgloses | `HISTORY` / fuera de alcance. **R1 no aplica:** una referencia histórica a `Company` conserva su ID (§3.3 HT-4) |
| **Modelo nuevo** (aparece después de la limpieza) | `PositionOrgScope`, `EmployeeWorkLocation(+Establishment)` | Si apunta a un ID del inventario, cae en `BLOCK` (`UNCLASSIFIED_OR_NEW_DEPENDENCY`): o se retiene el destino o se retira la fila nueva (§5) |

**[C]** El motor de horas especiales ya no lee columnas del catálogo para el pasado:
`loadEngineScopeHistory` (`laborHistory.service.ts:212-222`) carga sólo las vigencias de las siete tablas,
sin fallback a `Employee.sectorId` ni a `EmployeeCompany`. Por eso la columna `Employee.sectorId` puede
retirarse sin romper la resolución histórica: la dimensión "sector anterior" se resuelve desde
`EmployeeLegacySectorPeriod`. **Esto no autoriza a retirar el soporte legado de clasificación (§3.4).**

### 3.3 FKs RESTRICT que impiden limpiar estructura o puestos [C]

| FK | Bloquea el borrado de | ¿Puede sobrevivir a M2? |
|---|---|---|
| `EmployeePositionPeriod.positionId` | Position | Posiblemente: un puesto no tiene padre nuevo obligatorio; su `sectorId` se vacía (autorizado). Requiere verificación de equivalencia (HT-3) |
| `PositionOrgScopePeriod.positionId` | Position | Ídem |
| `DoubleHourRule.positionId/companyId/sectorId` | Position / Company / Sector | Referencia de **catálogo**: R1/R2/R3. Company/Sector sólo sobreviven con su forma nueva |
| `EmployeeLegacySectorPeriod.sectorId` | Sector | **No**, salvo conversión demostradamente neutra (HT-2); nunca inventando un padre |
| `PositionOrgScopePeriodNode.{companyId,businessUnitId,sectorId,area,areaSector}` | Company / BU / Sector / Area | Company/BU posibles; **Sector/Area no**, si la conversión no es neutra (HT-2) |
| `EmployeeEmployerPeriodCompany.companyId` | Company | **La empresa conserva su ID**: historia manda; en C2 la limpieza aborta (HT-4) |
| `PositionOrgScope.*` (modelo nuevo, Restrict) | Company / BU / Sector / Area | Fila nueva: clasificar (retirar fila o retener destino) |
| `EmployeeWorkLocation.zoneId`, `EmployeeWorkLocationEstablishment.establishmentId` | Zone / Establishment | Zone sí; Establishment sólo con `zoneId` |
| `Area.sectorId`, `Sector.businessUnitId`, `Establishment.zoneId` (M1, modelo nuevo) | Sector / BU / Establishment | Bloquean cuando un nodo **nuevo** apunta a un nodo del inventario: clasificar como fila nueva o retener el destino |

**Tratamiento propuesto (preserva la evidencia):**

- **HT-1 — Precondición de limpieza [D]:** antes de congelar el inventario, listar todas las filas de las
  siete tablas de historia (y de `PositionOrgScope`) que apunten a IDs candidatos. En `development`
  antes de B3 el resultado **debería** ser 0 (la historia se escribe con el código nuevo y la ventana es
  sin escrituras): es una **expectativa a verificar**, no una medición. Un resultado distinto de 0 activa HT-2/HT-4.
- **HT-2 — Nodos históricos: conservar salvo conversión neutra demostrada [D].** Para cada registro
  retenido por historia se distinguen cuatro planos, que la limpieza no puede mezclar:
  1. **Identidad del registro:** su ID permanece; nunca se re-clava ni se sustituye por otro.
  2. **Ruta histórica conservada:** cómo resuelve el pasado la evidencia que lo referencia
     (FKs y snapshots de historia; intocable).
  3. **Ruta administrativa actual:** cómo aparece y se administra el nodo en el árbol nuevo (padre, estado, UI).
  4. **Semántica usada por reglas:** cómo lo interpretan las reglas de horas especiales (legado vs. nuevo, §3.4).

  **No se ofrece "reubicar como INACTIVO" ni ninguna otra conversión como solución general.** Una
  conversión sólo es admisible si se demuestra **neutra** para los planos 1, 2 y 4 (identidad intacta,
  ruta histórica idéntica, semántica de reglas sin cambio), con pruebas de equivalencia antes/después
  sobre la copia. **Si la neutralidad no puede demostrarse, el nodo se conserva y M2 queda bloqueada.**
  **Nunca se inventa un padre para satisfacer el NOT NULL de M2.**
  *(**D-B1 aprobada (2026-10-08):** no hay conversión que demostrar — el nodo retenido se **archiva**
  con su forma vieja (`archivedAt`, §12.1) y la frase anterior queda sólo como registro del criterio
  previo. El bloqueo pasa a ser técnico: hasta implementar y validar §12 no hay M2.)*
- **HT-3 — Puestos retenidos [D]:** se conserva la fila y se vacía `Position.sectorId` (columna autorizada
  a NULL). **[C]** Desde D-5 esa columna no es entrada del motor (las vigencias viven en
  `EmployeePositionPeriod`), por lo que el vaciado debería ser neutro — igual se exige la prueba de
  equivalencia antes/después, no el razonamiento. El puesto queda "Pendiente de recarga" hasta que la
  recarga manual lo reemplace; la guarda de M2 debe admitir puestos sin alcance.
  *(**D-B1/D-B2 aprobadas (2026-10-08):** el puesto retenido por historia se **archiva** con su forma
  vieja y `Position.sectorId` se conserva **sin vaciar ni dropear** en esta transición; la variante de
  vaciado queda para la etapa futura de purga (§12.3, §12.11). Lo que sigue vigente es la guarda de
  puestos activos sin alcance.)*
- **HT-4 — Empresas referenciadas por historia [D]:** **R1 no es tratamiento de referencias históricas a
  `Company`.** Una empresa referenciada por `EmployeeEmployerPeriodCompany` o por
  `PositionOrgScopePeriodNode.companyId` **conserva su ID**: se excluye del inventario de borrado.
  En **C2 la limpieza aborta** si alguna empresa del inventario está así referenciada; sólo un
  redefinición posterior y aprobada de C2 (que conserve explícitamente las empresas históricas) podría
  habilitarla. **Nunca se reasigna una FK histórica** para liberar el borrado. Para la referencia de
  catálogo de `DoubleHourRule` siguen disponibles R1/R2/R3 (§3.2).
  *(**D-B1 aprobada (2026-10-08):** archivar esa empresa en C2 es una **capacidad futura
  condicionada** (§12.7) — sólo se implementa y activa con el contrato de raíces históricas (§12.2),
  el marcado `archivedAt`, G4/G7/G8 verdes sobre la copia y **D-1 elegido en C2** con el significado
  actualizado; mientras tanto C2 **sigue abortando** como se describe.)*
- **HT-5 — Divergencia de la copia [C/R]:** en la copia de ensayo hay filas de QA que referencian
  registros del inventario (`PositionOrgScope` → UN antigua; 4 filas de `EmployeeEmployerPeriodCompany`
  → empresas en C2; reporte `d5-org-reorg-inventory-copy-2026-10-08.json`). Se resuelven excluyendo los
  IDs QA del inventario congelado o reteniendo sus destinos. Que en `development` no existan es una
  **expectativa a verificar con HT-1**, no un dato medido.

### 3.4 Clasificación legado/nuevo del sector — bloqueo funcional [C]; A8-3 cerrado con equivalencia [R] (2026-10-08)

**Hecho verificado en código:** la clasificación de una regla como "sector legado" se deriva **en cada
lectura** del padre actual del sector:

```
timeEntries.repository.ts:231
sectorIsLegacy: Boolean(rule.sectorId) && !rule.sector?.businessUnitId
```

y esa bandera decide la ruta de evaluación en `laborHistory.scope.ts:85`
(`LEGACY_SECTOR` contra `EmployeeLegacySectorPeriod` vs. `WITHIN` sobre snapshots de `PositionOrgScope`).

**Bloqueo:**
- Hacer `Sector.businessUnitId` NOT NULL (M2) elimina toda fila con padre NULL: **ningún sector puede
  quedar clasificado como legado** por este camino.
- Asignar `businessUnitId` a un sector retenido (u a cualquier cambio de padre) **reinterpreta
  históricamente** reglas existentes: la misma regla dejaría de comparar contra el sector anterior del
  legajo y pasaría a evaluar alcances de puesto, con efectos distintos en MATCH/NO_MATCH/MISSING.

**Requisitos previos a autorizar M2 [D]:**
1. **Clasificación persistente e independiente del padre actual:** la procedencia legado/nuevo debe quedar
   guardada (dato propio de la regla o del sector), no derivada de una FK que M2 modifica.
2. **Pruebas de equivalencia antes/después** con el motor real sobre la copia (misma metodología que
   ADR §19.4: pares fecha-legajo + reglas), aceptando sólo cambios esperados y documentados.
3. **No retirar el soporte legado** (`sectorIsLegacy`, dimensión `LEGACY_SECTOR`, lectura del sector
   anterior) **mientras exista evidencia que lo necesite**: `EmployeeLegacySectorPeriod` y las reglas que
   hoy comparan contra el sector anterior. Retirarlo es una decisión propia con plan de evidencia, no un
   subproducto de M2.

#### Implementación de A8-3 (2026-10-08) [C] — requisito 1 cumplido en código

- **Columna persistente:** `Sector.isLegacy Boolean` obligatoria, **sin `@default`** (nada se clasifica
  por omisión), comentada A8-3 en `schema.prisma`.
- **Migración aditiva** `20261008110000_sector_org_classification`: `ADD COLUMN` →
  `UPDATE … SET "isLegacy" = ("businessUnitId" IS NULL)` (**el criterio previo**, fijado una sola vez)
  → `SET NOT NULL`. Sin `DEFAULT`, sin `INSERT`/`DELETE`, sin asignar padres. **Aplicada el 2026-10-08
  sólo a la copia `org-location-reorg`** (ensayo autorizado de este §3.4; evidencia [R] más abajo).
  Ni development ni producción: `migrate status` previo mostró esta única pendiente y `migrate deploy`
  aplicó sólo esta migración.
- **Alta:** `orgStructureRepository.create` (sector) fija `isLegacy = !businessUnitId` (criterio previo)
  e **ignora** cualquier `isLegacy` entrante; **edición:** el `update` de sector hace strip del campo
  (una edición común nunca re-clasifica; además Zod hace strip en la ruta). Seed crea con `isLegacy: false`.
- **Motor:** `ruleScopeOf` valida explícitamente los tres estados de una regla (revisión Codex sobre
  `8eac1d7`): **sin `sectorId`** → regla sin sector, sin clasificación que leer; **con `sectorId` e
  `isLegacy` booleano** → se usa tal cual; **con `sectorId` y relación o clasificación ausentes** →
  `SpecialHourRuleSectorIntegrityError` (`SPECIAL_HOUR_RULE_SECTOR_INTEGRITY`, 500). No hay fallback
  sobre `businessUnitId` ni "legado por defecto", y el error **no** se confunde con
  `SPECIAL_HOUR_SCOPE_HISTORY_MISSING` (409, historia del legajo): son problemas distintos con
  responsables y correcciones distintos. El error se lanza al construir el alcance, antes de resolver,
  de modo que ninguna escritura que dependa de la resolución continúa. `ruleInclude` sólo selecciona
  `sector.isLegacy`; `laborHistory.scope.ts` **no cambia**: sigue recibiendo la bandera.
- **Resto del backend:** `findLegacyNames` filtra `isLegacy: true`; overview y `findNode` clasifican desde
  la columna; `assertRuleSectorSupported` ya no necesita leer `businessUnitId`. La validación de alcances
  de puestos (`positions.service.validateScopes`) aplica el mismo patrón: un área sin sector sigue siendo
  estructura anterior (criterio previo, sin consultar clasificación); un nodo de sector con la lectura
  **incompleta** (`isLegacy` no booleano) lanza `POSITION_SCOPE_SECTOR_INTEGRITY` (500), diferenciado de
  `POSITION_SCOPE_LEGACY` (409), y detiene el alta/edición sin tocar la validación normal.
- **Frontend:** `ApiSector.isLegacy` → `mapSector` escribe `pendingReload: item.isLegacy` (ya no
  `!businessUnitId`); los cinco filtros "legado/nuevo" pasan de `businessUnitId` a `pendingReload`
  (`HolidayWorkAssignmentsPage`, `PuestosPage`, `PuestoIdentificationTab`, `employeeStructureFilters` ×2).
- **Pruebas** (motor real sobre cliente en memoria, fixtures; sin escribir en ninguna base) —
  `backend/src/modules/time-entries/sectorLegacyClassification.test.ts`: prueba principal (re-padrear el
  sector no cambia clasificación ni resolución histórica; el criterio previo **habría** re-interpretado de
  2 a 1), caso inverso (sector nuevo sin padre no se reclasifica), legado/nuevo con historia por fecha,
  historia insuficiente (`MISSING` de la dimensión restringida), reglas sin sector, equivalencia
  antes/después de la migración y lectura del SQL de backfill; estados de clasificación e integridad
  (regla sin sector, `isLegacy` true/false, relación ausente, campo ausente, y `resolveSpecialHourRulesByDate`
  rechazando antes de escribir); **equivalencia de resolución en las fechas de un período ya cerrado**
  (no protección transaccional del cierre: ésa es de `shared/monthlyClosure` y
  `workforce/specialHourReinterpretation`, con sus propias pruebas). Más tests de repositorio
  (alta/edición), de `positions.service` (lectura incompleta de sector y de área del sector → integridad,
  sin escritura) y del mapper de frontend. `typecheck`/`build` verdes; suites focalizadas en verde.

#### Equivalencia antes/después en la copia (2026-10-08) [R] — requisito 2 y verificación de cierres cumplidos

Destino: copia Neon `org-location-reorg` (`backend/.env.reorg`; host
`ep-rough-river-aioy7xp9-pooler.c-4.us-east-1.aws.neon.tech` comprobado antes de cada operación con
`--expected-host`; `AUTOMATIC_JOBS_ENABLED=false`; identidad administrativa Neon `NOT_VERIFIED`, igual que
en D-5, sin API key). Sólo lectura salvo la migración autorizada: sin servidor, sin tareas automáticas,
sin escrituras fuera de `20261008110000`. Reportes y snapshot lógico en `../backups/` (fuera del repositorio);
scripts reproducibles `backend/scripts/a8-3-logical-backup.ts`, `a8-3-engine-report.ts` y
`a8-3-compare.ts`.

| Paso | Evidencia [R] |
|---|---|
| `migrate status` previo | 62 migraciones en el repo, **única pendiente** `20261008110000_sector_org_classification` (`../backups/a8-3-migrate-status-pre-2026-10-08.log`) |
| Snapshot lógico pre | `../backups/a8-3-pre-2026-10-08.backup.json` (69 tablas, 5341 filas, 61 migraciones) + SHA-256 `112b427375ce9cc4a9475bdbc1118ec7adc0fb4883ed694f512d5c57a494fecd` (`…backup.json.sha256`). **Snapshot lógico de filas** para verificación y eventual reconstrucción: **no** incluye el esquema completo (sólo columnas y filas, sin índices/constraints/funciones), **no** restaura por sí mismo (sin procedimiento de restauración probado) y **no** reemplaza un `pg_dump` restaurable |
| Manifiesto pre/post | `a8-3-pre-2026-10-08.manifest.json` / `a8-3-post-2026-10-08.manifest.json` (69 tablas; 5341 → 5342 filas) |
| `migrate deploy` | aplicó **sólo** `20261008110000_sector_org_classification` en el host correcto (`a8-3-migrate-deploy-2026-10-08.log`) |
| Verificación de la columna | `a8-3-sector-verification-2026-10-08.json`: 44 sectores; 42 `isLegacy=true` = 42 `businessUnitId IS NULL`; **0** discrepancias contra el criterio previo ni contra el respaldo pre (padres, nombre, código, estado y timestamps idénticos); `is_nullable=NO`, `column_default=NULL`; migraciones: **+1 exacta, 0 quitadas** |
| Manifiesto pre vs post | `a8-3-manifest-pre-vs-post-2026-10-08.summary.json`: **0 violaciones**; única tabla con contenido cambiado = `Sector` (44/44 filas, set de IDs sin cambios: `isLegacy` entra en el hash); `_prisma_migrations +1` con las existentes intactas; **cierres** `MonthlyTimeClosure`: 8 filas, **IDs y contenido idénticos** |
| Motor anterior vs nuevo | mismo script `a8-3-engine-report.ts` sobre los **78 pares fecha-legajo únicos** de `d5-engine-before-2026-10-08.json` (sin duplicados; pares únicos = claves de resultado, sin faltantes ni sobrantes), antes y después de la migración: motor anterior = `ff1565f` (checkout aislado con `git worktree`), motor nuevo = `8a2985e`. `a8-3-engine-before-vs-after-2026-10-08.summary.json`: **equal 78, changed 0, onlyBefore 0, onlyAfter 0, selfConsistency ok**; multiplicadores, ganadoras, `matchedRules` comparados por **`{id, nombre}`**, conflicto e historia faltante idénticos par a par; `missingBefore 5 = missingAfter 5 = missingStillMissing 5` |

El motor anterior (`ff1565f`) sobre los 78 pares reproduce el estado documentado post-D-5 (ADR
§19.3-§19.4, §6): **73 resueltos + 5 `MISSING:EMPLOYER:c96b0fe1…`**. Frente al reporte base
`d5-engine-before-2026-10-08.json` (línea previa a D-5): 73/78 etiquetas iguales y las 5 diferencias son
exactamente esos pares ya documentados — no son una regresión de A8-3. Los 5 `MISSING` siguen `MISSING`
antes y después: **no se completó historia**.

Conclusión: el requisito 2 (equivalencia antes/después con datos reales) y la **verificación de cierres
por ID y contenido** quedan **cumplidos [R]**; la única diferencia de esquema es `Sector.isLegacy` y la
única diferencia de filas es `_prisma_migrations +1`. El requisito 3 sigue intacto: el soporte legado
(`LEGACY_SECTOR`) no se retiró.

**Revisión de Codex sobre `d2c7f71` (2026-10-08)** — tres hallazgos corregidos en un commit
separado, sin tocar la migración ni la base: (1) `a8-3-engine-report.ts` rechaza pares
`employeeId|fecha` duplicados **antes** de agrupar y verifica que los pares únicos coincidan con las
claves de resultado (sin faltantes ni sobrantes; `exit 2` si no); (2) `a8-3-compare.ts` compara
`matchedRules` normalizado por **`{id, nombre}`**, de modo que un cambio de nombre de la misma regla
aparece como diferencia; (3) `a8-3-logical-backup.ts` se describe explícitamente como **snapshot
lógico de filas** con sus límites (no esquema completo, sin restauración probada, no reemplaza
`pg_dump`). La lógica vive en el módulo puro
`backend/src/modules/time-entries/specialHourEvidence.ts`, con pruebas focalizadas (duplicados,
cobertura y cambios de nombre de reglas). Los dos `*.summary.json` se volvieron a comparar **sin base
de datos** con los scripts corregidos y reprodujeron el mismo resultado [R]: **78 pares únicos
(0 duplicados), 0 diferencias, 5 `MISSING` intactos, 8 cierres por ID y contenido idénticos**.

## 4. Cambios propuestos para M2 (diseño; aún no implementar) [D]

### 4.1 DDL de la migración (archivo único, en `reorg-r2`) y guarda por clases de fila

> **D-B1 aprobada (2026-10-08):** esta tabla queda **reemplazada** por la especificación de
> §12 (§12.1-§12.13) — archivo explícito (`archivedAt`) con formas y CHECKs condicionales, raíces
> históricas como contrato del inventario y guardas G1-G9, en vez de `NOT NULL` global y de abortar
> con "Retenidas por historia". Se conserva aquí como **registro del plan previo**; no se ejecuta
> M2 sin implementar y validar §12 (§12.11).

La guarda previa clasifica las filas antes de cualquier DDL y **aborta** si alguna queda en una clase
incompatible. Nunca exige `User.companyId NOT NULL` (sigue siendo nullable y administrativo).

| Cla­se | Definición | Condición que exige la guarda |
|---|---|---|
| **Eliminables** | IDs del inventario congelado destinados a borrado | **0 restantes** (ni borrados parcialmente ni con forma vieja) |
| **Retenidas por historia** (u otras retenciones R3) | filas excluidas del inventario porque evidencia las referencia | Aborta si su forma vieja no puede hacerse nueva **sin inventar padres** (`Sector.businessUnitId IS NULL`, `Area.sectorId IS NULL`, `Establishment.zoneId IS NULL`). Los **puestos** retenidos sí admiten (columna `Position.sectorId` ya vacía) |
| **Nuevas / modelo nuevo** | filas creadas por el modelo nuevo (incl. QA) | Deben cumplir los padres nuevos NOT NULL; ninguna puede apuntar a un ID eliminable (ya clasificada en la limpieza) |

Además verifica que los valores viejos estén vacíos antes del DROP: `Sector.areaId`,
`Area.establishmentId`, `Establishment.companyId`, `Establishment.businessUnitId`, `Position.sectorId`,
`Employee.sectorId`, `User.sectorId`, `ClockDevice.sectorId`. `User.companyId`: bajo C1 se conserva
(nullable, sin exigencia NOT NULL); bajo C2 debe quedar NULL **explícitamente** antes de borrar
empresas, sin apoyarse en `SET NULL`.

Otros pasos del DDL: **DROP** de columnas/índices/únicos (§2.1); **NOT NULL** de §2.2;
**`@@unique([zoneId, code])`** en `Establishment` (D-13) y borrado de `@@unique([companyId, code])`;
sincronización de `schema.prisma` + `prisma validate` + regeneración del cliente.
**No toca:** `DoubleHourRule.*`, tablas de historia, `EmployeeCompany`, `CostCenter*`,
`BusinessUnit.companyId`, legajos, horas, cierres, documentos, historiales.
**Reversión:** sólo restaurando el respaldo previo (ADR §7).

### 4.2 Cambios de código exigidos por A8 (retiro de consumidores)

- **Backend:** retirar cadenas legacy de `employees.repository.ts` y `positions.repository.ts`;
  `buildWhere`/`buildOrgChartWhere`/`buildOptionsWhere` sin `sectorId`; eliminar
  `assertLegacySectorUnchanged` y la validación derivada de la cadena; quitar `sectorId` de los schemas
  de listado/opciones/alta; dashboard sin payload `sector` y sin `companyId`/`sectorId` en la clave de
  caché (D-14); `pending.repository.ts` sin `employee.sectorId`; filtros de convocatorias/régimenes/
  conceptos sin `sectorId` (o acotados a sector anterior mientras exista).
- **Motor:** conservar `DoubleHourRule.sectorId` (ADR §6) y **todo el soporte legado de clasificación**
  mientras haya evidencia que lo necesite (§3.4, hallazgo 1); la clasificación legado/nuevo **ya es
  persistente** (A8-3 implementado 2026-10-08) antes de M2.
- **Frontend:** filtros y selects "Sector anterior" (§2.4), campos `derived*` de puestos, etiquetas de
  padres legacy de Organización, columna "Sector anterior" y filtro de Nivel 2 del dashboard,
  `cacheKey.ts` sin `sectorId`, datos demo/fixtures, etiquetas de error de `apiClient`.
- **Seed:** quitar los `sectorId` de `seed.ts` (93, 99, 349, 366) y el workaround de unicidad (76-88).
- **Contratos/docs:** actualizar §2.6 en el mismo cambio.
- **Tests:** adaptar §2.7; los que afirman `SET NULL` o la cadena legacy pasan a afirmar su ausencia.

### 4.3 Qué no cambia en A8

- Nada de notificaciones (postergadas por instrucción expresa).
- Motor de horas especiales, cierres protegidos y locks de §18.1 (salvo retiro de lecturas legacy).
- Permisos (`employeeAccessWhere` por responsable de carga) y `EmployeeAssignment`.

## 5. Bloqueos y pendientes

### 5.1 Bloqueos hoy

**Plan de limpieza — reporte [R] `d5-org-reorg-inventory-copy-2026-10-08.json` (`blocking: true`):**

| Modo | Código | Detalle |
|---|---|---|
| C1 y C2 | `UNCLASSIFIED_OR_NEW_DEPENDENCY` | 1 fila de `PositionOrgScope.businessUnitId` apunta a una UN del inventario (QA de A5) |
| C2 | `UNCLASSIFIED_OR_NEW_DEPENDENCY` | 2 filas de `PositionOrgScope.companyId` → empresas del inventario |
| C2 | `RULE_WITHOUT_DECISION` | Regla "Domingos" (`c96b0fe1-84bd-43a8-8dac-d7f70fe206f6`) referencia `companyId` sin decisión R1/R2/R3 |
| C2 | `OUTSIDE_RECORD_DEPENDS_ON_INVENTORY` | 1 `BusinessUnit` nuevo depende de una empresa del inventario |
| C2 | `HISTORY_REFERENCES_INVENTORY` | 4 filas de `EmployeeEmployerPeriodCompany` → empresas del inventario: en C2 es **aborto duro** (HT-4) |

**Bloqueos funcionales y de decisión:**

- **Clasificación LEGACY_SECTOR (hallazgo 1)** — §3.4: **A8-3 cerrado** (columna `Sector.isLegacy`,
  backfill con el criterio previo, motor y frontend desde el dato persistido); **migración aplicada y
  equivalencia antes/después verificada en la copia el 2026-10-08** [R] (78 pares únicos iguales
  entre `ff1565f` y `8a2985e`, 0 diferencias, 5 `MISSING` intactos, cierres por ID y contenido iguales). Deja de bloquear M2
  por sí solo; A8-1/A8-2 están especificados en §12 con **D-B1/D-B2 resueltas** y sólo falta
  **validación técnica**; siguen abiertos A8-5 y las decisiones de la lista de abajo.
- **Nodos históricos (hallazgo 2)** — §3.3 HT-2: con **D-B1 aprobada** no hay conversión que
  demostrar — el nodo se **archiva** con su forma vieja (§12.1). El bloqueo que queda es técnico:
  implementar y validar §12 antes de M2.
- **Empresas históricas (hallazgo 4)** — §3.3 HT-4: en C2, aborto si hay historia que referencie una
  empresa del inventario. **D-B1 aprobada** la vuelve capacidad condicionada (§12.7): se activa sólo
  al implementar el contrato de raíces y elegir D-1 en C2.
- **D-0** — sin `NEON_API_KEY`/project/branch ids, `org-reorg-cleanup` y `org-reorg-restore` no corren
  ni en dry-run (identidad NO VERIFICADA) [C].
- **D-1** — modo C1/C2 sin elegir: inventario, guarda de M2 y tratamiento de "Domingos".
- **D-3** — rastro de la limpieza (sólo `AuditLog` vs historial visible).
- **D-6** — sin variantes de puestos, la recarga de puestos (B4) no puede cerrarse.
- **Fecha de corte de cobertura** — §6.1: no elegida; bloquea la recarga y sus verificaciones.
- **5 fechas sin evidencia** — §6 [R].

### 5.2 Pendientes de implementación (decisión ya tomada)

- **D-15 (ratificada, ADR §18.4):** **pendiente de implementar** el retiro de `ClockDevice.sectorId`
  de autenticación (`clockDevices.repository.ts:53`, `clockDeviceAuthentication.ts:19,71`) y de tipos
  (`express.d.ts:24`); después, DROP de la columna en M2 y ajuste de `clockDevice.schema.test.ts:84`.
- **A8-4 (conservada):** validación pendiente de índices y planes de consulta tras el DROP de
  `Employee([status, sectorId])` y `Employee([sectorId])`: correr `EXPLAIN` de los listados según
  `docs/PERFORMANCE_STANDARDS.md` y confirmar la cobertura de `@@index([status])` (schema 817).

## 6. Las cinco fechas históricas sin evidencia [R]

Fuente: `d5-coverage-pre-qa-2026-10-08.json` (`unresolved`) y
`d5-engine-before-vs-after-qa.summary.json` (`originalEmployeeDates: 78`, `equal: 73`,
`missingHistory: 5`, `valueChanged: 0`; los 5 `missingKeys` identifican legajo+fecha+regla).

| # | Legajo | Fecha | Dimensión faltante | Regla |
|---|---|---|---|---|
| 1 | 16 | 2026-07-05* | `EMPLOYER` (empresa empleadora) | "Domingos" |
| 2 | 13 | 2026-08-02* | `EMPLOYER` | "Domingos" |
| 3 | 02 | 2026-08-09* | `EMPLOYER` | "Domingos" |
| 4 | 03 | 2026-08-09* | `EMPLOYER` | "Domingos" |
| 5 | 03 | 2026-08-16* | `EMPLOYER` | "Domingos" |

\* domingos: fechas en las que la regla semanal coincide. **[C]** Al no haber vigencia de empleadora
registrada, el motor devuelve `409 SPECIAL_HOUR_SCOPE_HISTORY_MISSING` en lugar de usar el valor actual
(`timeEntries.repository.ts:277-286, 344-347`). **[R]** Sin cobertura: los 36 legajos de la copia
(`employeesWithoutAnyHistory: 36`); estos cinco son los únicos pares del set de 78 donde una dimensión
restringida decide.

- **Impacto registrado [R, con salvedad]:** ADR §12.2 (reporte `org-reorg-inventory-copy-2026-10-07.json`,
  simulación C2 del 2026-10-07, **previa a D-5 y no re-medida después**): 5 `TimeEntry` (40 h),
  2 desgloses (360 min) y un cierre `ENVIADO`. Las filas conservan su multiplicador almacenado
  (**[R]** `valueChanged: 0` en la comparación post-D-5).
- **Qué falta:** una `EmployeeEmployerPeriod` (+ `EmployeeEmployerPeriodCompany`) con vigencia que cubra
  la fecha, para ese legajo.
- **Operaciones bloqueadas para esos 5 pares [C]:** carga o edición de horas, alta/edición de desgloses,
  recálculo de desgloses automáticos, reinterpretación por cambio de regla o convocatoria,
  `reconcile-special-hours --apply`, reconstrucción de snapshot de cierre y catch-ups del fichador que
  resuelvan esa fecha. El cierre `ENVIADO` está además protegido por §18.1.
- **Cómo se resuelven (sólo con evidencia) [D]:** documentación real de la empleadora en esa fecha
  (recibos, planillas, contratos, exportación Finnegans), registrando la vigencia con fecha y motivo vía
  el flujo existente de Datos Laborales. Después, re-correr cobertura y un dry-run del motor para
  confirmar que el multiplicador almacenado no cambia.
- **Prohibido [ADR §19.3/§19.5]:** inicializar masivamente los legajos ni adivinar vigencias.

### 6.1 Cobertura desde el corte (procedimiento; fecha aún no elegida, no ejecutada) [D]

Los 78 pares históricos **no alcanzan**: son sólo las fechas con horas ya registradas de un subconjunto
de legajos y una sola regla. La cobertura se define por **fecha de corte obligatoria** (aún sin elegir ni
ejecutar) y se verifica por intervalos:

1. **Fecha de corte:** parámetro único y obligatorio del procedimiento (por decidir). Nada se abre "porque sí": toda apertura de historia queda anclada a esa fecha y queda auditada (autoría, motivo, fecha efectiva), en la misma transacción de la escritura que la originó (semántica §19.1).
2. **Apertura desde la corte:** la recarga abre períodos auditados desde la fecha de corte para **las
   dimensiones aplicables**: puesto, centro de costo, sector anterior, conjunto de empresas empleadoras
   **y alcances de puestos** (`PositionOrgScopePeriod` + `PositionOrgScopePeriodNode`, incl. el sector
   padre del área registrado en el snapshot).
3. **Verificación por intervalos:** para cada legajo, cada dimensión que alguna regla activa restringe
   debe tener una vigencia continua que cubra `[corte, hoy]`, sin huecos ni solapamientos.
4. **Coherencia con los datos actuales:** el valor del último período abierto debe coincidir con el dato
   vigente del legajo/puesto (posición, centro de costo, empresas, alcances). Cualquier divergencia
   aborta la verificación.
5. **Antes de la corte:** se conserva `MISSING` donde falte evidencia real. No se rellena con valores
   actuales ni con suposiciones.

## 7. Precondiciones y orden del ensayo (a la luz de D-5)

D-5 está ratificada e implementada (ADR §18-§19): el motor resuelve por fecha con historia y nunca con
valores actuales. El plan de ADR §12.4 se ajusta con las compuertas nuevas (historia,
clasificación, cobertura).

### 7.1 Precondiciones (todas antes de escribir) [D]

1. Identidad: copia aislada, host comprobado antes de cada escritura; `development` y producción intactos (D-12).
2. Identidad administrativa Neon verificada (D-0) para limpieza/restauración, incluso en dry-run.
3. Respaldo doble (rama Neon + `pg_dump`) con SHA-256 y **restauración probada** (B0).
4. `migrate status` en solo lectura muestra exactamente las aditivas esperadas de `reorg-r1`
   (`org_location_expand` + `labor_history_periods` + `sector_org_classification`, ésta **ya aplicada**
   en la copia el 2026-10-08, §3.4) y **ninguna M2**.
5. Inventario congelado con las **clases de fila** por §12.2 (`borrable` / `conservada` / `nueva` si
   la ampliación la incorpora) y con `retained` / `deletable` separados; **F0** en verde antes de
   escribir (§12.3); 0 FKs sin clasificar.
6. Historia: HT-1 corrido; `outsideInventory` = ∅ sólo por ampliación (sin reconocimiento, §12.2);
   toda referencia histórica a `Company` implica retener esa empresa (HT-4); en C2, aborto hasta que
   §12.7 esté implementada y D-1 así lo decida.
7. **Clasificación legado/nuevo persistente** (§3.4) implementada y con **equivalencia antes/después
   verificada en la copia** (2026-10-08, 78 pares únicos, 0 diferencias) [R]; soporte legado intacto
   mientras haya evidencia que lo necesite.
8. `decisions.json` completo: modo C1/C2 (D-1), R1/R2/R3 por regla **de catálogo** (nunca sobre
   historia), D-3 decidido.
9. Backend detenido, ventana sin escrituras, actor humano (`--actor-user-id` RRHH activo).
10. Línea base de reconciliación (`reconcile-special-hours` dry-run) con el motor histórico, registrando
    los 5 `MISSING` preexistentes como estado esperado [R].
11. D-15 implementada: ninguna lectura de `ClockDevice.sectorId` en autenticación o tipos (§5.2).
12. **Fecha de corte** decidida y procedimiento de §6.1 definido (aún no ejecutado) antes de la recarga.

### 7.2 Orden del ensayo

1. **Respaldo** doble + restauración probada (B0).
2. **Migraciones aditivas** (`reorg-r1`: M1 + historia) → manifiesto previo/posterior → drift vacío.
3. **Inventario congelado** + clasificación por clases de fila (historia, `PositionOrgScope`, reglas)
   + **F0** (formas transicionales sin mirar `archivedAt`, §12.3).
4. **Tratamiento de dependencias:** raíces y retención (`outsideInventory` sólo se resuelve por
   ampliación, §12.2); R1/R2/R3 sólo sobre catálogo — **sólo R3 aprobados** quedan referenciando
   archivados —; retenciones por historia resueltas (HT-2/HT-3/HT-4); borrados autorizados enumerados
   (§12.4); `decisions.json` firmado.
5. **Limpieza autorizada + archivo:** dry-run → revisión → `--apply --backup` → **V1** (ADR §5.4) →
   prueba de restauración → limpieza final con `archivedAt = retained` → **F1** al cerrar (§12.3).
   Dentro de la misma transacción: equivalencia del motor **histórico** (0 cambios; los 5 `MISSING`
   siguen `MISSING`) [D].
6. **M2** (`reorg-r2`): `migrate status` → `deploy` → CHECKs de forma (§12.3) → DROP de
   `Employee/User/ClockDevice.sectorId` (conteo 0), `NOT NULL` y `(zoneId, code)`; **sin purga**
   (D-B2).
7. **Recarga manual:** Organización → Ubicaciones → Puestos → Legajos (con ubicaciones de trabajo) y
   **apertura de historia auditada desde la fecha de corte** para las dimensiones aplicables, incluidos
   alcances de puestos (§6.1); antes de la corte, `MISSING` donde falte evidencia.
8. **Verificaciones:** **F2** (§12.3) + V2 por ID y contenido; **cobertura por intervalos** `[corte, hoy]` y coherencia
   con los datos actuales (§6.1.3-4); motor en dry-run sin cambios de valor; `migrate status` al día;
   typecheck/test/build verdes en `reorg-r2`; equivalencia de clasificación legado/nuevo (§3.4);
   QA visual contra `docs/reference-ui/`; contratos de §2.6 actualizados; **A8-4** (`EXPLAIN` de
   listados, §5.2).

### 7.3 Qué cambió respecto del plan de ADR §12.4

- Paso 3: clasificación por clases de fila + historia y `PositionOrgScope` + **F0** (§12.3).
- Paso 4: raíces/retención con `outsideInventory` sólo por ampliación (§12.2); R1/R2/R3 sólo para
  catálogo — **sólo R3 aprobados** hacia archivados —; borrados autorizados enumerados (§12.4);
  referencias históricas a `Company` retienen ID (HT-4).
- Paso 5: motor **histórico**; acepta sólo los 5 `MISSING` preexistentes [R]; la limpieza incluye el
  archivo (`archivedAt = retained`) y cierra con **F1** (§12.3).
- Paso 5½ (nuevo): clasificación legado/nuevo persistente con equivalencia antes/después (§3.4).
- Paso 6: CHECKs de forma (§12.3); ningún registro con forma vieja queda activo — se **archiva**
  (F1) en vez de convertirse; sin purga de columnas ni de filas (D-B2).
- Paso 7: recarga + apertura de historia **desde la fecha de corte**, con verificación por intervalos.
- La restauración (`org-reorg-restore`) sigue siendo válida **sólo antes de M2** (`LEGACY_COLUMNS`)
  y debe reponer `archivedAt` además de filas y columnas (§12.9.7).

## 8. Separación del trabajo

### 8.1 Preparación que puede hacerse ahora (sin ejecución destructiva)

- Este documento y sus correcciones en el ADR (§6, §11, §19.3, §20).
- Inventario de dependencias (§2) con marcas de evidencia [C]/[R]/[D].
- Diseño: especificación **§12** (D-B1 aprobada; diseño técnico pendiente de validación), HT-1…HT-5
  (§3.3), procedimiento de cobertura desde el corte (§6.1) — a ratificar; clasificación persistente
  (§3.4) ya **implementada** como A8-3. §4.1 queda como registro del plan previo.
- Lista de cambios de código por archivo (§4.2) como plan de A8.
- Corridas de solo lectura en la copia ya realizadas (2026-10-08, archivos de §1).
- Actualizar `decisions.json` cuando se decidan D-1/D-3, y elegir la fecha de corte.

### 8.2 Ejecución que depende de decisiones pendientes

| Decisión | Qué bloquea |
|---|---|
| **D-1** (C1/C2) | modo del inventario, clases `borrable`/`conservada` y `retained`/`deletable` (§12.2), `EmployeeCompany`/`CostCenterCompany`, tratamiento de "Domingos"; en C2, aborto por empresas históricas hasta implementar §12.7 (HT-4) |
| **D-2** (zona completa) | ampliación de ubicaciones y su recarga (no el DDL de M2) |
| **D-3** (rastro visible vs `AuditLog`) | salida del script de limpieza; si se elige historial visible, ampliarlo antes de B1 |
| **D-6** (variantes de puestos por alcance) | redacción de la recarga de puestos y el cierre de B4 |
| **Fecha de corte** (§6.1) | apertura de historia en la recarga y sus verificaciones de cobertura |
| **D-0** (Neon, §8.3) | limpieza/restauración, incluso dry-run |

### 8.3 Comprobación administrativa de identidad Neon pendiente (D-0) [D]

Checklist mínimo: `NEON_API_KEY` (de solo lectura si el plan lo permite), `--neon-project-id`,
`--expected-branch-id` y `--expected-branch-name` de la rama de ensayo y de `development`;
verificar en la primera ejecución la forma de respuesta (`GET /projects/{id}/endpoints/{endpointId}`
→ `endpoint.branch_id`/`host`; `GET /projects/{id}/branches/{branchId}` → `branch.name`/`default=false`);
confirmar que `production` queda rechazado. Hasta entonces, los scripts destructivos no corren.

## 9. Autorización de limpieza recibida (2026-10-08) y sus límites

El usuario autoriza, **durante el procedimiento posterior de prueba** (no en este bloque), eliminar:

- estructura del modelo anterior y puestos actuales;
- dependencias de configuración que acompañan a esos registros (vínculos `CostCenter*`,
  `PositionSalaryCategory`, `EmployeeCompany`, alcances actuales y demás filas de configuración en
  cascada), para recargarlos a mano — familias, condiciones y conteos en **§12.4**.

La autorización **no** alcanza a:

- legajos ni sus IDs, horas, cierres, documentos e historiales operativos (ADR §5.1);
- evidencia temporal: ninguna tabla de historia, `AuditLog`, desgloses, trazas o movimientos
  se borra ni se vacía para liberar referencias (§3.2);
- **reasignar FKs históricas** (R1 no aplica a historia, HT-4);
- adelantar la limpieza a este bloque: aquí sólo se diagnostica y diseña.

Nota de ingeniería: la autorización habilita la *eliminación explícita* de esas filas de configuración
en el orden del plan; no convierte a `CASCADE` en atajo de la transacción (la limpieza sigue borrando
de forma explícita y ordenada, con manifiesto V1).

## 10. Decisiones pendientes con ejemplos breves

*(Resueltas el 2026-10-08: **D-B1**, **D-B2** y **D-14** — §12.11; ya no figuran como pendientes.)*

| Id | Decisión | Ejemplo |
|---|---|---|
| D-1 | C1 o C2 | C1 conserva LOSOD y "Domingos"; C2 exige R1/R2 para la regla **y aborta** si la historia referencia una empresa del inventario (HT-4). *Si se implementa el archivo de §12.7, el alcance de C2 pasa a "todas las empresas del inventario **salvo las archivadas por historia**" (aclaración, no decisión nueva).* |
| D-2 | Zona completa | ¿"Todos los establecimientos de Zona Norte" se marca explícitamente o una lista vacía lo significa? (Hoy: lista vacía se rechaza) |
| D-3 | Rastro de la limpieza | Sólo `AuditLog` (script actual) vs filas en el historial visible del legajo |
| D-6 | Puestos por alcance | ¿Un "Gerente de O'Dwyer" y uno "de Tropa" son dos puestos o uno con dos alcances? (Hoy: una función con alcance distinto = puesto distinto) |
| **A8-1** | Nodo retenido por historia con forma vieja | **D-B1 aprobada (2026-10-08); diseño técnico pendiente de validación:** archivo explícito `archivedAt` en las 6 tablas de `DELETE_ORDER` con invariantes I1-I6 (§12.1) y raíces históricas con ampliación obligatoria del inventario (§12.2); sin inventar padres ni conversión. Falta implementar + AT + corrida en la copia; hasta entonces no se ejecuta M2 |
| **A8-2** | Alcance exacto de la guarda de M2 | **D-B1/D-B2 aprobadas; especificación corregida (§12):** fases F0/F1/F2 con condiciones separadas (§12.3), lista cerrada de relaciones + borrados autorizados de configuración (§12.4), guardas G1-G9 con G7 profunda (§12.5-§12.6), cambios por componente (§12.9), pruebas AT-1..AT-9 (§12.10) y cadena extremo a extremo (§12.12). `User.companyId` **no** se exige NOT NULL (D-14); puestos sin alcance admitidos; sin purga (D-B2) |
| **A8-3** | Clasificación legado/nuevo persistente | **Cerrado (2026-10-08):** `Sector.isLegacy` (sin `@default`) sustituye a `!rule.sector.businessUnitId` (§3.4); backfill con el criterio previo en la migración aditiva `20261008110000` (**aplicada sólo a la copia `org-location-reorg`**), motor y frontend desde el dato persistido, pruebas con motor real; **equivalencia antes/después [R]**: 78 pares únicos idénticos (`ff1565f` vs `8a2985e`), 0 diferencias, 5 `MISSING` intactos, manifiesto con única diferencia `Sector.isLegacy` + `_prisma_migrations +1`, cierres por ID y contenido iguales. Mientras haya evidencia legada, el soporte legado se conserva |
| **A8-4** | Índices y planes de consulta tras el DROP | `EXPLAIN` de listados antes de eliminar `[status, sectorId]` y `[sectorId]`; cobertura de `@@index([status])` (schema 817) |
| **A8-5** | Fecha de corte de cobertura | Fecha desde la que la recarga abre períodos auditados (§6.1). Hoy **no elegida ni ejecutada**; hasta decidirla, `MISSING` se conserva |

## 11. Criterio de cierre de este bloque

- [x] Inventario de dependencias completo (§2) con backend, frontend, scripts, seed, fixtures, contratos y tests, marcado por origen de evidencia.
- [x] Hallazgos de Codex sobre `b826dba` incorporados: clasificación LEGACY_SECTOR (§3.4), nodos históricos (HT-2), cobertura desde el corte (§6.1), empresas históricas sin R1 (HT-4), guardas por clases y pendientes (§4.1, §5.2), evidencia calificada (§1).
- [x] Tratamiento de tablas históricas y FKs RESTRICT sin borrar evidencia ni reasignar FKs (§3).
- [x] Precondiciones y orden del ensayo revisados a la luz de D-5 (§7).
- [x] Cinco fechas sin evidencia documentadas con sus bloqueos y su resolución (§6).
- [x] Trabajo separado en ahora / dependiente de decisiones / Neon (§8).
- [x] Autorización de limpieza registrada con sus límites (§9).
- [ ] A8 en revisión (este documento + correcciones en el ADR).
- [x] **A8-3 implementado en código** (§3.4): columna `Sector.isLegacy`, migración aditiva con backfill
  del criterio previo, motor, consumidores, frontend y pruebas con motor real; `typecheck`/`test`/`build`
  verdes en ambos paquetes.
- [x] **A8-3 migración aplicada y equivalencia verificada en la copia** (2026-10-08, §3.4): único destino
  `org-location-reorg`; 78 pares únicos idénticos (0 diferencias) entre `ff1565f` y `8a2985e`; 5
  `MISSING` intactos; manifiesto y cierres por ID/contenido sin cambios fuera de `Sector.isLegacy` y
  `_prisma_migrations +1`.
- [x] **Hallazgos de Codex sobre `d2c7f71` corregidos** (§3.4): pares duplicados y cobertura
  únicos↔resultado verificados en el reporte del motor (con `exit 2`), `matchedRules` comparado por
  `{id, nombre}` y límites del snapshot lógico documentados; comparaciones `.summary.json`
  re-ejecutadas **sin base de datos** con los mismos resultados (78 únicos, 0 diferencias, 5
  `MISSING`, 8 cierres intactos).
- [x] **A8-1/A8-2 especificados y corregidos** (§12): diseño inicial en `f183e3a`, reescrito como
  especificación en `e4fb4f0` y corregido tras la revisión de Codex sobre `e4fb4f0` (§12.13) —
  `archivedAt` con invariantes I1-I6, raíces con ampliación obligatoria sin reconocimiento, fases
  F0/F1/F2 con condiciones separadas, lista cerrada de relaciones + borrados autorizados de
  configuración, guardas G1-G9 (G7 con comparación profunda), `DoubleHourRule` sólo con R3
  aprobado, C2 como capacidad condicionada, unicidad D-13, cadena extremo a extremo (§12.12) y
  pruebas AT-1..AT-9.
- [x] **Decisiones de este bloque resueltas** (§12.11): **D-B1 aprobada**, **D-B2 aprobada sin purga
  en esta transición** y **D-14 ratificada** (empresa administrativa nullable; retiro funcional del
  sector). Siguen abiertas D-1 (con la aclaración de §12.7), D-2, D-3, D-6, A8-5 y D-0 — ninguna
  nueva por esta especificación.
- [x] **A8-1/A8-2 implementados en código** (2026-10-09, §12.14): archivo de escritor único, clases
  del congelado y ampliación, plan raíces → cierre → eliminables, clase 4 con retiro autorizado, R3
  aprobada, F0/F1, G1-G9, manifiesto/V1 con familias autorizadas, restauración que revierte el
  archivo, rechazos de servicio; `typecheck`/`test`/`build` verdes; ensayo **local** de inventario y
  guardas.
- [x] Correcciones de la revisión de Codex hasta `b199732` (§12.14.8): respaldo por tabla + PK,
  clase 4 acotada, población de R2 con la semántica A7, empresas y destinos de `DoubleHourRule`
  revalidados en la transacción; transacciones de limpieza/restauración verificadas en **integración
  local** (no son el comando operativo, que sigue detrás de D-0).
- [x] Hallazgos de la revisión independiente: revalidación transaccional del puesto en Legajos y
  reversión de `20261008150000` que no pierde archivo ni clasificación (§12.14.5).
- [ ] **Ensayo real sobre la copia aislada** (§7.2 pasos 3-5 con F0/F1 y G1-G8): bloqueado por D-0
  (identidad Neon) y D-1 (modo C1/C2); `decisions.json` además necesita R1/R2/R3 aprobadas y las
  resoluciones de clase 4.
- [ ] M2 (CHECKs de forma con los nombres de G6, DROP de `Employee/User/ClockDevice.sectorId`,
  `@@unique([zoneId, code])`) — no escrita.
- Siguiente paso: resolver D-0 y D-1, congelar el inventario en la copia y correr el ensayo de §7.2
  (pasos 3-5) con `org-reorg-guards` en F0 y F1; recién con F1 verde, escribir y ensayar M2 en
  `reorg-r2` (D-B1/D-B2/D-14 ya no están pendientes).

## 12. A8-1 y A8-2 — especificación de archivo legado, raíces históricas y guarda de M2 (2026-10-08) [D]

**Estado (2026-10-09, tras la revisión de Codex hasta `b199732`): implementado; verificado con
pruebas unitarias y con integración local REAL de la transacción de limpieza y de restauración
(PostgreSQL desechable, datos sintéticos); pendiente el ensayo sobre la copia Neon (bloqueado por D-0
y D-1). Detalle por componente, AT y nivel de verificación en §12.14.** Decisiones de producto
resueltas: D-B1 **aprobada**, D-B2 **aprobada** (sin purga durante esta transición) y D-14
**ratificada**.

*Estado previo (2026-10-08): diseño técnico pendiente de validación (implementación + pruebas AT +
corrida en la copia aislada).* Este commit sólo corrige la
especificación según la revisión de Codex sobre `e4fb4f0`: no hay migraciones, código ni escrituras
en bases. Con D-B1 aprobada, §12 **reemplaza** a §4.1 como diseño vigente (§4.1 queda como registro
del plan previo); HT-2 y HT-4 dejan de plantear un bloqueo de producto y pasan a depender de
implementar y validar este §12 antes de M2.

Tres niveles de garantía se usan en toda la especificación y no se mezclan:

- **SQL** — lo que la base impide por sí sola (CHECK, únicos, FK `RESTRICT`).
- **Servicio** — lo que impiden endpoints y repositorios (entrada rechazada, 409, filtros de listado).
- **Guardas del ensayo** — consultas deterministas G1-G9 que se corren en los puntos de control del
  §7.2 y abortan el proceso si fallan.

Elecciones técnicas ya tomadas acá (no son decisiones de producto): representación `archivedAt`,
escritor único, contrato de raíces del inventario con **ampliación obligatoria** cuando hay
referencias fuera de él (sin reconocimiento ni flag), fases F0/F1/F2 con condiciones separadas,
G7 con comparación profunda, NULLIFY ampliado a objetivos archivados, borrados autorizados de
configuración enumerados (§12.4), `DoubleHourRule` sólo con R3 aprobado y coexistencia de los dos
únicos de `Establishment`.

### 12.1 Modelo elegido: archivo explícito (`archivedAt`)

Columna `archivedAt TIMESTAMPTZ NULL`, **sin `@default`**, en las seis tablas de `DELETE_ORDER`:
`Company`, `BusinessUnit`, `Establishment`, `Area`, `Sector`, `Position`. Definición: **archivado ⇔
`archivedAt IS NOT NULL`**. Es la única representación de archivo y cubre también `Company` y
`BusinessUnit`, que no tienen `isLegacy`.

Por qué no `isLegacy` ni `status`:

- `isLegacy` es **origen** (sólo `Sector`, inmutable, la lee el motor para la ruta legado/nuevo):
  una fila legada puede ser borrada (la mayoría) o archivada (las retenidas); son ejes distintos.
- `status` es **estado operativo mutable**: `INACTIVO` sigue siendo un nodo vivo, editable,
  reactivable y visible en el árbol. Archivar es lo contrario: congelado y de un solo sentido.
- Un booleano genérico no alcanzaría sin las invariantes de abajo: cualquier alta no debe poder
  declararse archivada.

Invariantes:

- **I1 — Un solo escritor:** sólo la transacción de limpieza (B3) escribe `archivedAt`. Ningún input
  de API lo expone (los schemas de entrada lo desconocen y rechazan el campo); `createNode` y
  `updateNode` jamás lo setean.
- **I2 — Conjunto autorizado:** las filas a archivar salen exclusivamente del `retained` del
  manifiesto (raíces históricas + R3 + closure de ancestros, §12.2). La guarda G4 exige que el
  conjunto archivado en la base sea **idéntico** al `retained` del manifiesto (diferencia simétrica
  0). Ningún alta puede declararse archivada porque ninguna ruta de alta escribe la columna.
- **I3 — De un solo sentido:** no existe servicio, script ni endpoint de desarchivar. **D-B2
  aprobada sin purga durante esta transición:** nada previsto revierte el archivo; retirar filas
  archivadas será una etapa futura, con su propia decisión, respaldo y prueba de restauración.
- **I4 — Inmutabilidad:** `updateNode`/`deleteNode` sobre un registro archivado → 409
  `ORG_STRUCTURE_ARCHIVED_RECORD`. Es más estricto que el tratamiento legacy actual (que permite
  corregir nombre/código/estado): el contenido archivado es evidencia de G4/G7 y no se toca.
- **I5 — Auditoría:** cada UPDATE de archivo genera su `AuditLog` en la misma transacción (D-3
  decide después la visibilidad; el registro existe siempre).
- **I6 — Orden:** la columna se agrega **antes** de la limpieza (migración aditiva de A8, paso 2 del
  §7.2), se rellena dentro de la transacción de limpieza (paso 5) y los CHECKs de forma (§12.3)
  llegan en M2 (paso 6), cuando ya sólo existen filas con forma válida.

### 12.2 Contratos del inventario: raíces históricas

Extensión del contrato `FrozenInventory` (hoy `records` + `parents`) con una sección nueva:

```ts
interface HistoryReference {
  source: string;           // "EmployeeLegacySectorPeriod.sectorId" (tabla.columna)
  targetTable: TargetTable; // Company | BusinessUnit | Sector | Area | Position
  referencedIds: string[];     // IDs exactos, ordenados, sin duplicados
  insideInventory: string[];   // ∩ inventario congelado
  outsideInventory: string[];  // ∉ inventario, listados uno a uno
}
// FrozenInventory.history: HistoryReference[]
```

**Fuentes** (FKs de las 7 tablas de D-5 cuyo destino es una tabla de `DELETE_ORDER`; los destinos que
no lo son quedan fuera porque nunca se borran: `EmployeeCostCenterPeriod.costCenterId → CostCenter`,
`employeeId` de cualquier período y la autoría `createdByUserId`):

| # | Fuente | Destino |
|---|---|---|
| 1 | `EmployeePositionPeriod.positionId` | Position |
| 2 | `EmployeeLegacySectorPeriod.sectorId` | Sector |
| 3 | `EmployeeEmployerPeriodCompany.companyId` | Company |
| 4 | `PositionOrgScopePeriod.positionId` | Position |
| 5 | `PositionOrgScopePeriodNode.companyId` | Company |
| 6 | `PositionOrgScopePeriodNode.businessUnitId` | BusinessUnit |
| 7 | `PositionOrgScopePeriodNode.sectorId` | Sector |
| 8 | `PositionOrgScopePeriodNode.areaId` | Area |
| 9 | `PositionOrgScopePeriodNode.areaSectorId` | Sector |

Producción: consulta de sólo lectura por fuente (Prisma/SQL); el resultado se persiste en el reporte
de inventario con los IDs, **no sólo conteos**.

**Orden obligatorio en `buildCleanupPlan`:**

1. cargar `records` (candidatos a borrar);
2. cargar `history` (IDs exactos por fuente);
3. `roots` = (`history.insideInventory` ∩ borrables) ∪ destinos R3 ∪ retenciones de clase 4;
4. `retained = retainedClosure(inventory, roots)` — **antes de calcular `deletable`**;
5. `deletable[table] = records[table] − retained[table]`;
6. aserción fail-closed: `∪ referencedIds ∩ ∪ deletable = ∅` (viola → aborta el plan; no es sólo
   una guarda externa);
7. `outsideInventory` de cada fuente ≠ ∅ → issue `HISTORY_REFERENCE_OUTSIDE_INVENTORY` con los IDs
   exactos y **bloqueo duro** (única salida: ampliación, ver abajo).

El congelado registra además, por fila, su **clase**: `borrable` (`records`), `conservada` (en
alcance y activa por el modo elegido — p. ej. empresas bajo C1) o, sólo si la ampliación la
incorpora, `nueva` (fuera de la transición). Sólo un **borrable** referenciado por historia se
promueve a raíz → `retained` → archivado: un registro `conservada` o `nueva` referenciado por
historia **no** se archiva.

**Membresía de la transición (explícita).** Pertenecen a la transición sólo los registros que cumple
el criterio del inventario congelado del modo elegido (candidatos a borrado de ADR §12.2 / A8 §7.2
paso 3), más sus dependencias necesarias (ancestros para el closure de retención y filas hijas que
deben clasificarse), junto con los registros en alcance que el modo **conserva activos**. Una
referencia en historia **no crea membresía**: un registro del modelo nuevo o fuera de alcance que
aparezca en alguna fuente de la tabla no entra en la transición, no se archiva ni se borra.

**`outsideInventory` bloquea sin reconocimiento ni flag de bypass.** Único camino de continuación:
**ampliar el inventario con esos destinos y sus dependencias, re-congelar y recalcular `roots`,
`retained` y `deletable`**, aplicando a cada destino incorporado el criterio de membresía de arriba:

- cumple el criterio (registro de la transición que faltó) → entra como `borrable`; al estar
  referenciado por historia se promueve a raíz → `retained` → archivado;
- no lo cumple (catálogo nuevo válido o registro conservado fuera de alcance) → se registra como
  `nueva`/`conservada`, **sin archivar ni borrar**, con la referencia intacta.

El ciclo (ampliación → re-congelado → F0 → recálculo de raíces y retención) se repite hasta que
`outsideInventory` quede vacío. Esperado en `development`: 0 desde el primer congelado (expectativa
HT-1); un no-cero nunca se "reconoce": se resuelve ampliando. Con este contrato el issue
`HISTORY_REFERENCES_INVENTORY` queda informativo (las raíces ya entran en `retained`), salvo conflicto
con una fila de clase 4 apuntando al mismo ID (eso sigue abortando).

### 12.3 Formas y validaciones

**Formas por fila** (una sola tabla; "tal cual" = no se modifica el valor existente). **F0** la
evalúa **ignorando `archivedAt`**: sólo clasifica cada fila como vieja (legado) o nueva.
**F1** la evalúa **con `archivedAt`**: `archivedAt IS NULL` ⇔ forma nueva; `archivedAt NOT NULL`
⇒ forma vieja (con `tal cual` sólo donde la tabla lo admite).

| Tabla | Forma vieja (legado) | Forma nueva (activa) | Estado mixto → **aborta** |
|---|---|---|---|
| Company | única forma: sin padres | idem | n/a |
| BusinessUnit | `companyId NOT NULL` | idem | n/a (misma forma) |
| Establishment | `zoneId IS NULL ∧ companyId NOT NULL` (`businessUnitId` tal cual) | `zoneId NOT NULL ∧ companyId IS NULL ∧ businessUnitId IS NULL` | ni una ni otra: `zoneId` y `companyId` ambos `NULL` (huérfano) o ambos `NOT NULL` (doble padre) |
| Area | `sectorId IS NULL ∧ establishmentId NOT NULL` | `sectorId NOT NULL ∧ establishmentId IS NULL` | ambos padres `NULL` o ambos `NOT NULL` |
| Sector | `isLegacy = true ∧ businessUnitId IS NULL` (`areaId` tal cual) | `isLegacy = false ∧ businessUnitId NOT NULL ∧ areaId IS NULL` | `isLegacy` y `businessUnitId` contradictorios (bicondicional de G1) o `isLegacy = false` con `areaId NOT NULL` |
| Position | `sectorId NOT NULL` (sin alcance activo) | `sectorId IS NULL` | `sectorId NOT NULL` **y** `PositionOrgScope` activos a la vez (la fila pertenece a los dos mundos) |

En `Position`, la fila archivada conserva el resto **tal cual** (típicamente `sectorId NOT NULL`;
se admite `NULL` heredado) — la equivalencia estricta `archivedAt` ⇔ forma aplica a las otras cinco
tablas.

Fases de validación, con condiciones separadas (ninguna fase sustituye a otra):

- **F0 — formas transicionales, paso 3, antes de escribir.** La columna `archivedAt` se agregó en el
  paso 2 pero está **vacía**: F0 **no la exige ni la mira**. Condiciones:
  1. cada fila de las 6 tablas cae en exactamente una forma de la tabla, evaluada **sin
     `archivedAt`** (vieja o nueva); cualquier estado mixto → aborta con tabla + IDs;
  2. G1 sin violaciones (`Sector.isLegacy ⇔ businessUnitId IS NULL`).
  Cero tratamiento y cero limpieza hasta que F0 = 0; se vuelve a correr tras cada re-congelado por
  ampliación (§12.2). Las resoluciones de mezcla son puntuales, manuales y sobre la copia (no son
  decisiones de producto).
- **F1 — después de calcular `retained`/`deletable`, aplicar el tratamiento y ejecutar la
  transacción de archivo + limpieza (cierre del paso 5).** Condiciones:
  1. **archivo exacto:** IDs con `archivedAt NOT NULL` == `retained` del manifiesto (diferencia
     simétrica = 0, G4);
  2. **sin eliminables:** filas de las 6 tablas con ID ∈ `deletable` → 0 (G3);
  3. **formas finales:** equivalencia `archivedAt` ⇔ forma de la tabla (arriba), sin estados
     mezclados;
  4. **contenido:** idéntico al previo salvo `archivedAt` en `retained` y los borrados autorizados
     enumerados del §12.4 — verificación **V1** de ADR §5.4;
  5. **historia intacta:** las 7 tablas idénticas columna por columna (G7);
  6. **sin vínculos activos hacia archivados:** G5 — salvo la propia fila archivada (forma
     `tal cual`) y `DoubleHourRule` con R3 aprobado; los borrados autorizados del §12.4 ya no existen
     desde el paso 5 (§12.4).
  **F1 es la compuerta de M2:** sin F1 verde no hay paso 6.
- **F2 — post-M2 y post-recarga (paso 8).** Condiciones:
  1. invariantes I1-I6 activas en servicio (sin endpoint de archivo, 409 en filas archivadas);
  2. CHECKs presentes y `validated` en `information_schema` + `prisma migrate diff` vacío (G6);
  3. unicidad `(zoneId, code)` operativa y lookup de zona sin archivados (§12.8);
  4. G9 (rendimiento) y el resto de las verificaciones del paso 8.

(F0/F1/F2 son las fases de validación de formas de esta especificación; no confundir con la
verificación V1 por ID y contenido de ADR §5.4, que sigue llamándose V1.)

Garantías **SQL** (M2): CHECKs escritos a mano (patrón M1) que obligan, por fila, a la forma que
corresponde según `archivedAt` — en `Sector`, `Area` y `Establishment`:
`archivedAt IS NOT NULL ⇒ padre nuevo IS NULL` y `archivedAt IS NULL ⇒ padre nuevo IS NOT NULL`.
`Company`, `BusinessUnit` y `Position` no tienen padre nuevo que condicionar (su forma ya está
obligada por columnas existentes: `companyId NOT NULL`, y `Position` sin FK de padre). Los CHECKs no
fuerzan la cadena vieja del archivado (un legado pudo nacer sin `areaId`): esa preservación es la
guarda G2/G4, no una restricción SQL. Prisma no modela CHECK (precedente M1, verificado estable en
A2): se verifican con G6.

**Columnas en M2.** Se dropean `Employee.sectorId` (+ índices), `User.sectorId` y
`ClockDevice.sectorId` (+ índice), con precondición de conteo 0; el NULLIFY de la limpieza se amplía
para vaciar también los valores que apunten a filas **archivadas** (`Employee.sectorId` es estado
actual, no evidencia: la evidencia del sector anterior vive en `EmployeeLegacySectorPeriod`). Se
**conservan sin DROP ni vaciado durante toda esta transición** — D-B2 aprobada sin purga —
`Sector.areaId`, `Area.establishmentId`, `Establishment.companyId`, `Establishment.businessUnitId`
y `Position.sectorId`: son la forma archivada; dropearlos mutilaría el archivo. Su retiro queda para
la etapa futura (nueva decisión + respaldo + prueba). `User.companyId` no se exige NOT NULL (nullable
y administrativo, D-14 ratificada).

Garantías de **servicio** y de **guardas**: capa servicio en §12.4 (lista cerrada de relaciones) y
§12.1 (invariantes I1-I4); capa guardas en §12.5 (G1-G9).

### 12.4 Relaciones y vínculos: qué rechaza archivados y qué se borra autorizadamente

| Familia | Relación / operación | Mecanismo de rechazo |
|---|---|---|
| **Padres organizacionales** | `Area.sectorId` (alta/edición de área), `Sector.businessUnitId` (alta/edición de sector), `Establishment.zoneId` (alta/edición de establecimiento), `BusinessUnit.companyId` (alta/edición de UN) | `assertParent` pasa a rechazar por `archivedAt NOT NULL` (hoy rechaza por `isLegacy`/padre-NULL, que no cubre Company/BusinessUnit) → 400/409 |
| **Alcances** | `PositionOrgScope.{companyId,businessUnitId,sectorId,areaId}` (alta/edición) y apertura de `PositionOrgScopePeriodNode` | `validateScopes` agrega rechazo de nodo archivado → 409, junto al `POSITION_SCOPE_LEGACY` actual |
| **Ubicaciones** | `EmployeeWorkLocationEstablishment.establishmentId` (alta/edición de ubicación) y `ClockDevice.establishmentId` (colocación de dispositivo, D-15) | establecimiento archivado → 400 |
| **Centros de costo** | vínculos `CostCenterCompany/BusinessUnit/Establishment/Area/Sector` | `assertNoNewLegacyLinks` migra de detección legacy a `archivedAt NOT NULL` y rechaza **vínculos nuevos** hacia archivados; los vínculos existentes hacia registros retirados **no se conservan**: son borrado autorizado en la limpieza (bloque de abajo) |
| **Legajos** | `Employee.positionId` (asignación de puesto) y `EmployeeCompany` (vínculo nuevo) | destino archivado → 400; el motor no se afecta (resuelve el pasado con las 7 tablas) |
| **Usuarios** | `User.companyId` en edición de alcance | destino archivado → 400 mientras la columna exista; `User.companyId` se conserva **nullable y administrativa** (D-14 ratificada) y nunca se exige NOT NULL; `User.sectorId` está **retirada funcionalmente** (no se expone ni se acepta) y se dropea en M2 con conteo 0 |
| **Reglas de horas** | `DoubleHourRule.companyId/sectorId/positionId` | **Alta:** destino archivado → rechazado (400/409). **Edición:** sólo se conserva **sin cambio** una FK que la regla ya apuntara a un registro hoy archivado; cualquier asignación **nueva** hacia un archivado → rechazada. **Limpieza:** de las reglas que referencian registros del inventario sólo sobreviven las referencias con **R3 aprobada** en `decisions.json` (R1/R2 se aplican antes del marcado). Es la única fila no-historia admitida por G5; el motor distingue legado/nuevo por `isLegacy` (§17.1) |

Complemento de servicio: todos los listados, selectores y filtros del modelo nuevo agregan
`archivedAt IS NULL` (además de `status`); no existe endpoint de archivo. Las referencias
**históricas** no se rechazan nunca: apuntan a IDs conservados (§3.1).

**Borrados autorizados de configuración (resuelve la contradicción con G5).** Los vínculos de
configuración cuyo destino **sale del catálogo activo** — destino ∈ `deletable` (borrado) **o**
destino ∈ `retained` (archivado) — **se borran en la misma transacción de limpieza (paso 5), antes de
F1 y de G5**: por eso G5 exige 0 vínculos activos hacia archivados sin contradecir nada — lo
prohibido es que **quede** un vínculo, no que se borre el autorizado. Alcance: sólo filas,
**nunca tablas**, y sólo si no son evidencia protegida (la autorización de §9 ya los cubre):

| Familia | Condición de borrado | Origen del tratamiento | Filas afectadas en la copia [R] |
|---|---|---|---|
| `CostCenterCompany.companyId` | destino ∈ `deletable` ∪ `retained` | `DELETE_LINKS` (`cleanupPlan.ts:58`) ampliado a destinos archivados | C1: 0 · C2: 3 |
| `CostCenterBusinessUnit.businessUnitId` | ídem | `cleanupPlan.ts:59` | 1 (ambos modos) |
| `CostCenterEstablishment.establishmentId` | ídem | `cleanupPlan.ts:60` | 2 |
| `CostCenterArea.areaId` | ídem | `cleanupPlan.ts:61` | 4 |
| `CostCenterSector.sectorId` | ídem | `cleanupPlan.ts:62` | 2 |
| `EmployeeCompany.companyId` | ídem (la historia del vínculo vive en `EmployeeEmployerPeriodCompany`) | `cleanupPlan.ts:56` | C1: 0 · C2: 40 |
| `PositionSalaryCategory.positionId` | ídem (asociación de puesto activo, no evidencia; no existe vigencia para esta asociación) | `cleanupPlan.ts:57` | 14 |
| `PositionOrgScope.*` (alcances actuales) | fila nueva que depende de un registro retirado (clase 4) → se retira la fila (§3.2) | `BLOCK` + clasificación | C1: 1 (`businessUnitId`) · C2: 3 (1 + 2 `companyId`) |

**[R]** `../backups/d5-org-reorg-inventory-copy-2026-10-08.json` (`references[].rowsToInventory`,
2026-10-08) — esas cifras sólo cubren destinos **a borrar**; las filas con destino **archivado**
(`retained`) se suman al congelar. Los conteos exactos se **re-miden al congelar** (paso 3) y el
reporte del ensayo los lista por familia **con IDs y destino (`deletable`/`retained`)**; este
documento no fija números. En el mismo reporte, `tableRowCounts` y `plan.deleteLinks` confirman el
mecanismo (p. ej. `EmployeeCompany` 40 filas totales, `PositionSalaryCategory` 15,
`PositionOrgScope` 7).

**Evidencia protegida — nunca se borra ni se vacía (§3.2, §9):** las 7 tablas de historia (incl.
`EmployeeEmployerPeriodCompany`, `EmployeeLegacySectorPeriod`, `PositionOrgScopePeriod` y
`PositionOrgScopePeriodNode`), `EmployeeFieldHistory`/`EmployeeBlockHistory`, `AuditLog`,
`SpecialHourRuleApplication`, horas, desgloses, cierres y documentos. **Tablas operativas
conservadas:** `CostCenter*`, `PositionSalaryCategory`, `PositionOrgScope(+Period+Node)`,
`EmployeeCompany` y todo el catálogo — ni la limpieza ni M2 hacen DROP de tablas; sólo se borran
las filas de la tabla de arriba.

**Adaptaciones exigidas:**
- **Manifiesto (V1):** el whitelist acepta exactamente `archivedAt` en los IDs de `retained` y las
  filas borradas de las familias de arriba, por tabla e ID; cualquier otra diferencia aborta
  (§12.9.4).
- **Respaldo:** `org-reorg-cleanup --apply --backup` captura cada familia borrada en
  `backup.deleted["<Tabla>.<columna>"]` con ID y contenido íntegro (mecanismo `DELETE_LINKS`
  existente); el `pg_dump` de B0 sigue siendo la segunda copia; el reporte imprime el conteo por
  familia.
- **Restauración:** `org-reorg-restore.ts` reinserta esas familias desde `backup.deleted` y además
  debe **reponer `archivedAt` a `NULL`** en los IDs archivados del respaldo (hoy no lo haría y
  `verifyV1` fallaría contra el manifiesto previo). La ventana "sólo antes de M2" no cambia
  (`LEGACY_COLUMNS` sigue trippando por `Employee.sectorId`).

### 12.5 Guardas del ensayo (G1-G9)

| Guarda | Qué verifica | Punto del §7.2 |
|---|---|---|
| **G1** clasificación | bicondicional `isLegacy ⇔ businessUnitId IS NULL` en `Sector` → 0 violaciones | 3 y 8 |
| **G2** formas | F0: formas transicionales sin mezclas (condiciones F0.1-F0.2, §12.3); F1: condiciones F1.1-F1.6 | 3 y 5 |
| **G3** eliminables | por tabla de `DELETE_ORDER`, IDs del inventario deletable presentes → 0 | 5 |
| **G4** conjunto de archivo | IDs archivados en la base == `retained` del manifiesto (diferencia simétrica = 0); contenido idéntico salvo `archivedAt` en `retained` y los borrados autorizados del §12.4 (único whitelist admitido) | 5 |
| **G5** vínculos a archivados | filas **no históricas** que referencien un archivado y **no sean ellas mismas una fila archivada** de las 6 tablas de `DELETE_ORDER` → 0. Admisiones: (a) la propia fila archivada (conserva su FK vieja `tal cual`, §12.3); (b) `DoubleHourRule` con **R3 aprobada** en `decisions.json` (verificada contra el manifiesto). Los borrados autorizados del §12.4 no cuentan: se borran en el paso 5, antes de esta guarda | 5 y 8 |
| **G6** restricciones | CHECKs de forma presentes y `validated` en `information_schema`; `prisma migrate diff` vacío | 8 |
| **G7** historia | snapshot profundo idéntico de las 7 tablas, columna por columna (§12.6) | 5 y 8 |
| **G8** raíces | `referencedIds ∩ deletable = ∅` (ya fail-closed en el plan) y `outsideInventory = ∅` tras el ciclo de ampliación — **sin** lista reconocida ni flag (§12.2) | 3, 5 y 8 |
| **G9** rendimiento | `EXPLAIN` de listados y cobertura de `@@index([status])` (A8-4, `docs/PERFORMANCE_STANDARDS.md`) | 8 |

### 12.6 Conservación: G7 (comparación profunda de las siete tablas de historia)

G7 **no** es un conteo ni se apoya sólo en las FK `RESTRICT`:

- **Antes** de la limpieza captura un snapshot **completo** de las 7 tablas de D-5: todas las
  columnas de cada fila — `id`, todas las referencias (`employeeId`, `positionId`, `sectorId`,
  `companyId`, `businessUnitId`, `areaId`, `areaSectorId`, `periodId`, `costCenterId`),
  `effectiveFrom/To`, `reason`, `createdByUserId`, `createdAt`, `updatedAt` — ordenado por clave
  primaria.
- **Después** de la limpieza vuelve a capturar y compara: **JSON idéntico, diff = 0 filas y 0
  columnas**. Una sola celda cambiada, un `updatedAt` tocado, una fila perdida o agregada → guarda
  fallida.
- Implementación: utilidad de snapshot/compare con el patrón de `a8-3-compare.ts` (reporte con
  `exit` ≠ 0), corrida en el paso 5 y de nuevo en el paso 8 del §7.2.
- Las FK `RESTRICT` siguen como garantía SQL de fondo; **G7 es lo que se mide y se reporta**.

### 12.7 C2: capacidad futura condicionada (corrección)

- **Corregido el texto anterior:** conservar empresas históricas **no** significa "C2 deja de
  abortar". El comportamiento vigente **no cambia en este commit**: si una empresa del inventario
  está referenciada por historia, el plan emite `HISTORY_REFERENCES_INVENTORY` y **C2 aborta**
  (HT-4, ADR §6).
- La retención + archivo de empresas en C2 es una **capacidad futura** que sólo se implementa y
  activa cuando se cumplan, todas verificadas sobre la copia:
  1. contrato de raíces históricas (§12.2) consumido por `buildCleanupPlan`;
  2. `archivedAt` + marcado en la transacción de limpieza (§12.1);
  3. G4, G7 y G8 en verde en un ensayo completo (§7.2);
  4. decisión **D-1** en modo C2 con el significado actualizado de abajo (D-B1 ya aprobada).
- **Cambio de significado de C2:** pasa de "se eliminan todas las empresas del inventario" a
  "**se eliminan todas salvo las archivadas por historia**". Consecuencias:
  - el inventario de empresas **no termina necesariamente vacío**: queda con las filas archivadas,
    que siguen ocupando `code`/`name` (§12.8);
  - las verificaciones que esperaban "0 empresas del inventario restantes" pasan a esperar
    "0 empresas del inventario **sin archivar** restantes";
  - los vínculos `EmployeeCompany` a esas empresas **se borran** (cascade al borrar la empresa; y,
    si la empresa queda archivada en vez de borrada, como **borrado autorizado** del §12.4) — la
    historia del vínculo vive en `EmployeeEmployerPeriodCompany` y el motor resuelve el pasado con
    las 7 tablas;
  - el organigrama activo no las muestra (`archivedAt IS NULL`).

Esto aclara el alcance de **D-1**; no es una decisión nueva.

### 12.8 Unicidad y códigos: coexistencia archivado/nuevo

- **Únicos globales** (`Company.code`, `Company.name`, `Sector.code`, `Area.code`, `Position.code`,
  `Zone.code`): el archivado **sigue ocupando** su código (y nombre, en Company). Reusarlos está
  bloqueado por la base, y eso es intencional: código y nombre son permanentes, no se reciclan. Un
  alta nueva con el mismo código falla por único normal, sin excepción.
- **`BusinessUnit` `@@unique([companyId, code])`:** un archivado ocupa su código dentro de su
  empresa; una UN nueva de esa misma empresa no puede repetirlo (mismo criterio de permanencia). En
  C1 la empresa sigue activa y el caso es visible: se documenta, no se abre excepción.
- **`Establishment` — los dos únicos conviven:** `@@unique([companyId, code])` gobierna las filas
  archivadas (`companyId` set, `zoneId NULL`) y `@@unique([zoneId, code])` (D-13) gobierna las
  nuevas (`zoneId` set, `companyId NULL`); Postgres no colisiona `NULL`, así que ambos aplican a su
  población sin impedirse mutuamente. Caso posible: el mismo `code` una vez archivado (por
  `companyId`) y otra vez activo (por `zoneId`, en otra zona o la misma). Se distingue siempre:
  - **lookup por zona y código:** `findZonedEstablishmentByCode(tx, zoneId, code, excludeId?)`
    **recibe la zona** y busca `zoneId` + `code` + `archivedAt IS NULL` (excluye archivados); se usa
    en alta **y** en edición;
  - **colisión al cambiar de zona:** la validación de `(zoneId, code)` corre **siempre que cambie
    `zoneId` o `code`** (hoy sólo cuando cambia `code`): mover un establecimiento a otra zona con el
    mismo código choca contra el único de la zona destino;
  - el índice `@@unique([zoneId, code])` (D-13, M2) es la garantía SQL; antes de M2 la garantía es
    de servicio, y AT-8 cubre ambos. Las consultas del modelo nuevo (selectores, filtros, alta)
    agregan `archivedAt IS NULL` y `zoneId NOT NULL`; las altas nuevas las rige `(zoneId, code)`;
  - **consultas históricas, motor y vigencias:** resuelven **por ID**, nunca por `code`;
  - **pantallas:** árbol y selects activos excluyen archivados; las vistas de diagnóstico los
    muestran con la etiqueta **"Archivado"**, distinta de "Pendiente de recarga" (puesto activo sin
    alcance) y de "Inactivo" (`status`).
- **`seed.ts`:** con `(zoneId, code)` vigente en M2, el workaround de `seed.ts:76-88` (lookup por
  zona porque el único de `companyId` no admite `NULL` en el upsert) se reemplaza por
  lookup/upsert sobre `(zoneId, code)`; el seed sólo crea filas activas y nunca referencia
  archivados.

### 12.9 Cambios por componente (al implementar; nada de esto en este commit)

1. **Base / Prisma:** `archivedAt DateTime?` en los 6 modelos de `DELETE_ORDER` (sin `@default`,
   comentado); migración aditiva nueva aplicada en el paso 2 del §7.2; en M2 (paso 6): CHECKs de
   §12.3 escritos a mano + `@@unique([zoneId, code])` (D-13) + DROP de
   `Employee/User/ClockDevice.sectorId` con conteo 0, conservando las cinco columnas de la cadena
   hasta la purga (§12.3). `prisma validate`, regeneración de cliente y `migrate diff` vacío.
2. **Inventario (`backend/scripts/org-reorg/*`):** producir y persistir `history` (§12.2) con IDs
   exactos; HT-1 pasa a medir exactamente esto.
3. **`cleanupPlan.ts`:** orden del §12.2 (roots → closure → deletable + aserción); `HISTORY` aporta
   raíces sólo de **borrables**; `outsideInventory` → bloqueo **sin reconocimiento ni flag**, con el
   ciclo de ampliación (destinos + dependencias → re-congelado → recalcular raíces/retención) y la
   clasificación de membresía por clase; F0 de formas transicionales; UPDATE de archivo = `retained`
   + `AuditLog`; borrados autorizados por familia con IDs (§12.4); NULLIFY ampliado a objetivos
   archivados; sólo R3 aprobados dejan referencias de `DoubleHourRule` hacia archivados; clase 4
   debe llegar a 0 incluyendo el retiro de la fila nueva; reporte por clases.
4. **Manifiesto / V1 (`manifest.ts`):** set `archived`, whitelist de cambio permitido (`archivedAt`
   sólo en IDs `retained` **y** filas borradas de las familias autorizadas del §12.4, por tabla e
   ID) y snapshot de G7 de las 7 tablas.
5. **Servicios / repositorios:** `assertNotArchived` y los rechazos de §12.4; 409
   `ORG_STRUCTURE_ARCHIVED_RECORD` en update/delete de archivados; `archivedAt IS NULL` en todos los
   listados del modelo nuevo; `assertParent`, `validateScopes`, `assertNoNewLegacyLinks` (sólo
   rechaza vínculos **nuevos**; el comentario "los vínculos que ya tenía se conservan" queda acotado
   a los no retirados), alta y edición de ubicaciones, colocación de dispositivos, asignación de
   puesto/empresa de legajo; `findZonedEstablishmentByCode` con `zoneId` y `archivedAt IS NULL` más
   la validación de colisión al cambiar de zona (§12.8); creación y edición de `DoubleHourRule` con
   las reglas de §12.4.
6. **Frontend:** excluye archivados de árboles, selects y filtros activos; etiqueta "Archivado" en
   vistas de diagnóstico; **ninguna** UI de archivar/desarchivar; claves de caché sin cambios.
7. **Restauración (`org-reorg-restore.ts`):** reinserta los borrados de `DELETE_ORDER` **y** de las
   familias `backup.deleted["<Tabla>.<columna>"]`, revierte `archivedAt` a los valores del respaldo
   (`NULL` en los IDs archivados) y repone columnas vaciadas; la ventana "sólo antes de M2" no
   cambia (`LEGACY_COLUMNS` sigue trippando por `Employee.sectorId`).
8. **Contratos / docs (§2.6):** `DATABASE_STANDARDS.md` (columna y semántica de archivo),
   `BACKEND_API_CONTRACTS.md` (se documenta que **no** existe endpoint de archivo),
   `ARCHITECTURE_STANDARDS.md`, `PROJECT_CONTEXT.md`, y este §12.
9. **Tests:** ver §12.10.

### 12.10 Pruebas de aceptación

Patrón: unitarias con `vi.mock` sobre la capa de repositorio, siguiendo los `*.service.test.ts`
existentes; las de datos corren sobre la copia aislada en los pasos del §7.2. En todos los casos:
`typecheck`/`test`/`build` verdes en backend y frontend.

- **AT-1 contrato de raíces:** fixture de filas de historia → `referencedIds` exactos por fuente; una
  fila de historia que apunte a un ID deletable hace fallar la aserción `∩ deletable = ∅` (el plan
  aborta); IDs fuera del inventario → `outsideInventory` ≠ ∅ y el plan **aborta sin
  reconocimiento ni flag**. Se ensaya el único camino de salida: ampliación con destino + dependencias
  → re-congelado → recálculo de raíces/retención; destino que cumple el criterio de membresía entra
  como borrable-raíz (archivado) y destino que no lo cumple queda `nueva`/`conservada`, sin archivar,
  hasta que `outsideInventory` = ∅.
- **AT-2 formas por fase:** F0 — por cada celda de la tabla de §12.3, fixtures en forma vieja y en
  forma nueva pasan **sin exigir `archivedAt`**; fixture mezclada → F0 aborta con tabla + ID.
  F1 — archivo distinto de `retained` → falla (F1.1); ID eliminable presente → falla (F1.2); fila con
  forma vieja y `archivedAt` NULL (o al revés) → falla (F1.3); diff fuera del whitelist → falla
  (F1.4).
- **AT-3 archivo de un solo escritor:** payload con `archivedAt` en create/update → 400 (schema);
  update/delete de fila archivada → 409 `ORG_STRUCTURE_ARCHIVED_RECORD`; no existe endpoint ni
  servicio de desarchivar.
- **AT-4 matriz de relaciones y reglas (§12.4):** parametrizada — cada relación con destino archivado →
  rechazo con su código; con destino activo → éxito (regresión). Cubre padres organizacionales,
  alcances, ubicaciones, centros de costo, legajos y usuarios (D-14). **`DoubleHourRule`:** alta con
  destino archivado → rechazo; edición que conserva **sin cambio** una FK ya apuntando a un archivado
  → éxito; edición que asigna **por primera vez** una FK hacia un archivado → rechazo; en el plan,
  regla con referencia al inventario sin R1/R2/R3 → aborto y con R3 aprobado → la referencia
  sobrevive a la limpieza y G5 la admite.
- **AT-5 conjunto de archivo y F1:** el plan produce `retained` = raíces + closure; aplicado el
  marcado sobre la copia, G4 da diferencia simétrica 0, F1.1-F1.2 quedan en verde y V1 sólo acepta
  el cambio `archivedAt` de esos IDs **y** los borrados autorizados del §12.4 (con ID fuera de esa
  lista el diff aborta).
- **AT-6 G7:** snapshot → alterar una celda de una tabla de historia → el compare falla indicando
  tabla/fila/columna; sin alteraciones → diff 0.
- **AT-7 C2 condicionada:** con el comportamiento actual, empresa del inventario referenciada por
  historia → sigue emitiendo `HISTORY_REFERENCES_INVENTORY` y C2 aborta; con las condiciones de
  §12.7 implementadas y **D-1 elegido en C2**, esa empresa entra a `retained`/archivo, sale de
  `deletable` y el reporte refleja el significado de §12.7.
- **AT-8 unicidad y D-13:** alta nueva con `code` de un archivado → rechazada por único en
  `Company`/`Sector`/`Area`/`Position`; en `Establishment` la coexistencia se permite y las dos
  filas se distinguen por `archivedAt`/`zoneId`. `findZonedEstablishmentByCode` recibe `zoneId`,
  busca por zona + código y **no devuelve archivados**; edición que cambia `zoneId` con un código que
  ya existe en la zona destino (código sin cambios) → rechazada, e ídem cuando cambian zona y código;
  antes de M2 la validación es de servicio y después la respalda `@@unique([zoneId, code])`. Si se
  toca código del motor o de lecturas, rerun de `a8-3-compare` (equivalencia A8-3 intacta).
- **AT-9 guardas como script:** G1-G9 implementadas como consultas del reporte del ensayo (formato
  tipo `a8-3-*`), con `exit` ≠ 0 ante violación, corridas en los puntos de la columna "Punto del
  §7.2".

### 12.11 Decisiones: resueltas y pendientes

**Resueltas el 2026-10-08 (no están abiertas):**

| Id | Resolución |
|---|---|
| **D-B1** | **Aprobada:** rige esta especificación de §12 (archivo `archivedAt`, raíces, formas F0/F1/F2, guardas G1-G9). §4.1 queda como registro del plan previo y HT-2/HT-4 dejan de ser bloqueos de producto (dependen de implementar y validar §12) |
| **D-B2** | **Aprobada sin purga durante esta transición:** no se borran filas archivadas ni se retiran `Sector.areaId`, `Area.establishmentId`, `Establishment.companyId/businessUnitId`, `Position.sectorId` ni `@@unique([companyId, code])`; la variante HT-3 de vaciar `Position.sectorId` **no** aplica (forma archivada tal cual, §12.3). El retiro del archivo queda para una etapa futura, con su propia decisión, respaldo y prueba de restauración |
| **D-14** | **Ratificada:** `User.companyId` se conserva **nullable y administrativa** (nunca se exige NOT NULL); `User.sectorId` **retirada funcionalmente** (no se expone ni se acepta) y dropeada en M2 con conteo 0 (§2.1, §12.4) |

El **diseño técnico** de §12 sigue **pendiente de validación** (implementación + AT-1..AT-9 +
corrida en la copia aislada): eso es ingeniería, no una decisión de producto. No se abren decisiones
nuevas para asuntos técnicos ya definidos en este documento.

**Pendientes (decisiones de producto que siguen abiertas):**

| Id | Decisión | Alcance |
|---|---|---|
| **D-1 (con la aclaración de §12.7)** | C1/C2; si C2, con el significado actualizado: "todas las empresas del inventario **salvo las archivadas por historia**" | Junto con R1/R2 de la regla "Domingos" |
| Ya abiertas | D-2, D-3, D-6, A8-5 (fecha de corte), D-0 (Neon): sin cambios por esta especificación | — |

### 12.12 Cadena de coherencia extremo a extremo (F0 → recarga)

| # | Etapa (paso del §7.2) | Qué se calcula / hace | Compuerta que debe pasar |
|---|---|---|---|
| 1 | Congelado (3) | inventario con clases (`borrable` / `conservada`) + `history` con IDs exactos por fuente | reporte de inventario con IDs, no sólo conteos |
| 2 | **F0** (3, antes de escribir) | formas vieja/nueva por fila **sin mirar `archivedAt`** | F0.1-F0.2 + G1 + G2/F0 (§12.3) |
| 3 | Raíces (3-4) | membresía de la transición; `outsideInventory` → ciclo de ampliación hasta ∅; `roots = (history ∩ borrables) ∪ R3 ∪ clase 4` | G8: fail-closed `∩ deletable = ∅` y `outsideInventory = ∅` (§12.2) |
| 4 | Retención / borrables (4) | `retained = retainedClosure(...)`, `deletable = records − retained` | aserción del plan; G3 se cobra en F1 |
| 5 | Tratamiento (4) | R1/R2/R3 sólo de catálogo (**sobreviven sólo los R3 aprobados** hacia archivados), retiro de filas clase 4, borrados autorizados enumerados (§12.4), `decisions.json` | sin `RULE_WITHOUT_DECISION` ni `BLOCK` sin clasificar |
| 6 | Archivo + limpieza (5) | DELETE de `deletable` + borrados autorizados; UPDATE `archivedAt = retained`; NULLIFY ampliado; `AuditLog`; V1 | **F1** (F1.1-F1.6) + G4 + G5 + G7 |
| 7 | M2 (6) | CHECKs de forma, DROP de `Employee/User/ClockDevice.sectorId` (conteo 0), `@@unique([zoneId, code])`; **sin purga** (D-B2) | G6 + `migrate diff` vacío |
| 8 | Recarga + verificaciones (7-8) | organización, ubicaciones, puestos, legajos; apertura de historia desde la fecha de corte | **F2** (I1-I6 activas, G9, A8-4, D-13) |

Ninguna etapa se salta: **F0 es compuerta del tratamiento** (paso 4 no empieza con formas mezcladas),
**F1 es compuerta de M2** (el paso 6 no corre sin archivo exacto y sin eliminables) y **F2 cierra el
ensayo**. Cualquier compuerta fallida aborta antes de escribir más.

### 12.13 Revisión de Codex sobre `e4fb4f0`: hallazgos y correcciones (2026-10-08)

| # | Hallazgo | Corrección | Dónde |
|---|---|---|---|
| 1 | Las fases estaban mezcladas: F0 exigía `archivedAt` y F1 no separaba condiciones | **F0** valida las formas transicionales vieja/nueva **ignorando `archivedAt`**; **F1** (después de calcular `retained`/`deletable` y ejecutar el tratamiento) exige archivo exacto == `retained`, ausencia de eliminables, formas finales, V1, historia intacta y sin vínculos activos; **F2** post-M2. Condiciones numeradas y compuertas separadas | §12.3, G2/G4 (§12.5), AT-2/AT-5 (§12.10), §12.12 |
| 2 | `outsideInventory` se levantaba con "reconocimiento" en el run report y no definía quién pertenece a la transición | Bloqueo **sin reconocimiento ni flag de bypass**; única salida = **ampliar el inventario con destinos y dependencias, re-congelar y recalcular raíces y retención**; membresía = criterio del inventario (nunca la aparición en historia): catálogos nuevos válidos se registran `nueva`/`conservada` y **no se archivan** | §12.2, G8 (§12.5), AT-1 (§12.10) |
| 3 | `DoubleHourRule` figuraba como excepción total hacia archivados | **Alta** rechaza destinos archivados; **edición** sólo conserva sin cambio una FK ya existente (ninguna asignación nueva); la **limpieza** conserva únicamente referencias con **R3 aprobada**; G5 y AT-4 actualizados | §12.4, G5 (§12.5), AT-4 (§12.10), §12.9.3 |
| 4 | "Conservar los vínculos previos" contradecía G5 | Los vínculos `CostCenter*`, `EmployeeCompany`, `PositionSalaryCategory` y los alcances actuales de registros retirados pasan a **borrados autorizados** en la transacción de limpieza (previa a G5), sólo filas y sólo si no son evidencia protegida; tablas históricas y operativas **conservadas**; familias y conteos [R] enumerados + adaptaciones de manifiesto, respaldo y restauración | §12.4 (bloque nuevo), §12.9.4/§12.9.7, G4/G5, AT-5 |
| 5 | Lookup, índice y pruebas no estaban alineados con D-13 ni con el archivo | `findZonedEstablishmentByCode` **recibe `zoneId`** y busca por zona + código **excluyendo archivados**; colisión `(zoneId, code)` validada **también al cambiar de zona** sin cambiar código; servicio, `@@unique([zoneId, code])` y AT-8 alineados | §12.8, §12.9.5, AT-8 (§12.10) |
| 6 | Decisiones figuraban abiertas o condicionadas | **D-B1 aprobada**, **D-B2 aprobada sin purga en esta transición**, **D-14 ratificada** (empresa administrativa nullable; retiro funcional del sector); el diseño técnico queda **pendiente de validación**, no de decisión; sin decisiones nuevas para asuntos técnicos ya definidos | §12.11, §12.1 (I3), §12.3 (columnas), §4.1/HT-2/HT-3/HT-4, ADR §6/§11/§21 |

### 12.14 Implementación y verificación (2026-10-09)

Niveles (actualizados el 2026-10-09 tras la revisión de Codex hasta `b199732`, §12.14.8):

- **Implementado** — en código en `feat/org-location-reorg`.
- **[U] Verificado con pruebas unitarias** — `vitest` con mocks o funciones puras.
- **[I] Verificado mediante integración local** — código REAL contra PostgreSQL 18 local desechable
  (todas las migraciones del repo con `migrate deploy`, datos sintéticos, ninguna base compartida):
  el script de inventario y el de guardas ejecutados como comandos de sólo lectura, y la prueba
  opt-in `reorg/cleanupRestore.integration.test.ts`, que corre `runCleanup`/`runRestore` —las mismas
  funciones que invocan los comandos operativos DESPUÉS de su compuerta D-0— de punta a punta.
- **[S] Simulación manual** (sólo el 2026-10-09, antes de §12.14.8) — el plan aplicado a mano en SQL
  para probar el script de guardas en F1. **No** es un ensayo del script de limpieza; quedó
  reemplazada por [I].
- **[P] Pendiente de ensayo sobre la copia Neon** — requiere D-0 y D-1.

Los **comandos operativos** `org-reorg-cleanup` y `org-reorg-restore` no se ejecutaron contra
ninguna base: sin identidad Neon verificada se niegan antes de importar o escribir nada (comprobado
el 2026-10-09 contra la base local: ambos rechazan y no escriben reporte).

#### 12.14.1 Estado recibido

OpenCode dejó, sin push: `daf3cd3` (invariantes y rechazos en org-structure y puestos), `7f9db02`
(rechazos en consumidores) y `1c68df4` (plan con historia, archivo y salvaguardas en scripts), sobre
`28b3387` (columnas `archivedAt` + `isLegacy` de Área/Establecimiento) y `59f9295` (especificación).
Suite de partida: 168 archivos / 2601 pruebas verdes. Se conservó todo lo válido; se corrigió:

| Hallazgo en lo recibido | Corrección |
|---|---|
| El congelado no registraba clases: en C1 las empresas no entraban al inventario, así que **toda** historia hacia una empresa quedaba `outsideInventory` (bloqueo permanente sin salida) | C1 congela las empresas como `conservada`; un único criterio de membresía (`transitionClass`) para el congelado y la ampliación |
| `conservada`/`nueva` se trataban como inventario en el cierre de retención, en las dimensiones de reglas y en el conteo de dependencias (una empresa C1 se habría archivado por el cierre de una UN retenida) | Sólo `borrable` se borra, archiva, cuenta como dependencia o exige decisión (`borrableIds`, `classOf`) |
| Faltaba el ciclo de ampliación | `amplifyInventory`: ronda por ronda hasta `outsideInventory = ∅`, con IDs, clase y motivo por destino; aborta si un destino no existe |
| Clase 4: "retener el destino" resolvía la referencia y dejaba una fila activa apuntando a un archivado (G5) | Sólo **retirar** resuelve, y sólo en la familia autorizada (`PositionOrgScope`); retener es raíz adicional opcional |
| C2 con el gate de §12.7 apagado podía archivar una empresa por el cierre de una raíz histórica | `HISTORY_RETAINS_COMPANY_C2` (bloqueante) |
| R3 sin exigencia de aprobación | `R3_NOT_APPROVED` si falta `approvedBy`; `r3References` es la única admisión no histórica de G5 |
| El script de limpieza no recibía resoluciones de clase 4, no corría F0/F1, G3-G8 ni G7, archivaba con `now()` por fila | F0 como compuerta antes de escribir; F1 completo + V1 antes del commit; un único instante de archivo |
| La restauración no revertía `archivedAt` | Revierte exactamente los IDs archivados del respaldo, con conteo |
| V1 aceptaba como "esperado" cualquier borrado que el script pidiera | Lista cerrada de tablas de borrado autorizado (historia y auditoría nunca) |
| Sin F0/F1 ni G1-G9 como código | `shapes.ts`, `guards.ts`, script `org-reorg-guards.ts` |

#### 12.14.2 Componentes

| # | Componente (§12.9) | Dónde | Estado |
|---|---|---|---|
| 1 | Columnas `archivedAt` (6) + `isLegacy` Área/Establecimiento | `20261008150000` | Implementado; **[I]** aplica sobre base vacía; **no aplicada a ninguna base compartida** |
| 2 | Inventario con clases + `history` con IDs + ampliación | `reorg/catalogReads.ts` (lecturas, ahora en `src`), `scripts/org-reorg-inventory.ts` | **[U]** plan; **[I]** comando de inventario C1/C2 y lecturas reales en la integración; **[P]** copia |
| 3 | Plan raíces → cierre → eliminables, aserción fail-closed, clase 4 (lista cerrada), R3, C2 | `reorg/cleanupPlan.ts` | **[U]**; **[I]** |
| 4 | Manifiesto/V1: `archivedAt` sólo en `retained`, familias autorizadas por tabla e ID | `reorg/manifest.ts` | **[U]**; **[I]** dentro de `runCleanup`/`runRestore` |
| 4b | Captura y respaldo de filas retiradas por tabla + PK (formato 2), verificación exacta antes de borrar | `reorg/retirement.ts`, `reorg/cleanupTransaction.ts` | **[U]**; **[I]** |
| 4c | Transacción de limpieza completa (F0 → plan → captura → reglas → vaciados → retiro por PK → catálogo → archivo → motor → F1 + V1) | `reorg/cleanupTransaction.ts` (invocada por `scripts/org-reorg-cleanup.ts` tras D-0) | **[I]** dry-run, apply y rechazo previo a escribir; **[P]** comando operativo en la copia |
| 5 | Rechazos de servicio y listados sin archivados (lista cerrada §12.4), revalidación transaccional de puesto, empresas y destinos de `DoubleHourRule` | módulos org-structure, positions, employees, users, workforce, clock-devices | **[U]** (AT-3, AT-4, AT-8); bloqueo `FOR SHARE` frente al archivo concurrente **[I]** |
| 5b | Población de R2 con la semántica del motor (A7) | `reorg/rulePopulation.ts`, `time-entries/specialHourRuleScope.ts` | **[U]**; **[I]** con el cargador real de historia |
| 6 | Frontend | — | Sin cambios: ninguna vista recibe archivados; no hay vistas de diagnóstico que rotular |
| 7 | Restauración: reinserta cada fila una vez, revierte archivo, repone vaciados; compatibilidad con respaldo formato 1 | `reorg/restoreTransaction.ts` (invocada por `scripts/org-reorg-restore.ts` tras D-0) | **[U]**; **[I]** dry-run con formato 1 y apply con formato 2 hasta el manifiesto previo; **[P]** comando operativo en la copia |
| 8 | Contratos/docs | `BACKEND_API_CONTRACTS.md`, `DATABASE_STANDARDS.md`, `PROJECT_CONTEXT.md`, este §12.14 | Hecho. `ARCHITECTURE_STANDARDS.md` sin cambios (sin módulo ni capa nuevos) |
| 9 | Guardas G1-G9 como script (AT-9) | `scripts/org-reorg-guards.ts` (`--phase` F0/F1/F2, exit 2) | **[I]** F0 y F2 como comando; F1 como comando sólo sobre la simulación **[S]**; F1 dentro de `runCleanup` **[I]**; **[P]** copia |

#### 12.14.3 Pruebas de aceptación

| AT | Cobertura | Estado |
|---|---|---|
| AT-1 | Partición de historia, aserción `∩ deletable`, `outsideInventory` sin flag, clases, ampliación (`cleanupPlan.test.ts`); ampliación real en el comando de inventario y en la integración | **[U]** + **[I]** |
| AT-2 | Cada celda de §12.3 vieja/nueva pasa F0 sin `archivedAt`; mixtos abortan con tabla + ID; F1 en ambos sentidos (`shapes.test.ts`); F0 real por comando | **[U]** + **[I]** |
| AT-3 | Schemas rechazan `archivedAt`; 409 en editar/borrar archivados; únicos escritores = las dos transacciones de reorganización, invocadas sólo por sus scripts tras `requireVerifiedIdentity` (`archiveSingleWriter.test.ts`) | **[U]** |
| AT-4 | Padres, alcances, centros de costo, ubicaciones, dispositivos, legajos (puesto, empresa), usuarios, `DoubleHourRule`; R3 aprobada en plan y G5 | **[U]**; G5 con R3 **[I]** |
| AT-5 | `retained` = raíces + cierre; G3/G4; V1 con familias autorizadas; `runCleanup` aplicado: respaldo == filas retiradas, F1 y V1 verdes | **[U]** + **[I]**; **[P]** copia |
| AT-6 | G7 celda/fila/tabla, PK compuestas, UTC; G7 dentro de `runCleanup` | **[U]** + **[I]** |
| AT-7 | C2 aborta con el gate apagado (directa y por cierre); con el gate archiva | **[U]**; inventario C2 real **[I]**; activar el gate exige D-1 en C2 |
| AT-8 | `(zoneId, code)` sin archivados, cambio de zona, código de archivado → único | **[U]**; `@@unique([zoneId, code])` **[P]** (M2). `ruleScopeOf` se movió sin cambios (suite del motor verde); el rerun de `a8-3-compare` sobre la copia queda **[P]** |
| AT-9 | G1-G9 como script con exit ≠ 0 | **[I]** (F0, F2; F1 sólo sobre [S]); **[P]** en los puntos del §7.2 sobre la copia |

Suite del backend (2026-10-09, tras §12.14.8): 173 archivos / 2709 pruebas verdes + 1 archivo / 8
pruebas de integración omitidas sin base (en CI); con `REORG_IT_DATABASE_URL` local, 8/8 verdes.
`typecheck`, `build` y `prisma validate` verdes; scripts `org-reorg*` sin errores de tipos
(chequeados con una configuración temporal: no están en el `tsconfig` del build).

**Cómo correr la integración (sólo local):** base `reorg_it*` en `localhost` con `prisma migrate
deploy` (en una base vacía, la migración `20260824170000` exige la fila `HC-NORMAL` en `HourConcept`,
como la tenía development); luego `REORG_IT_DATABASE_URL=postgresql://…@localhost:…/reorg_it
DATABASE_URL=<la misma> npx vitest run src/modules/org-structure/reorg/cleanupRestore.integration.test.ts`.
La prueba se niega fuera de `localhost` o con otro nombre de base y **vacía la base al empezar**.

#### 12.14.4 Precisiones técnicas (no son decisiones de producto)

- **R3 aprobada** = entrada R3 con `approvedBy` no vacío en `decisions.json` (formato del ADR §12.4).
- **`decisions.json`** acepta el arreglo de reglas del ADR o `{ "rules": [...], "classFour": [{ table, column, target, retain, retire }] }`.
- **Clase 4:** lista cerrada `PositionOrgScope.{companyId, businessUnitId, sectorId, areaId}` → su tabla; sólo hacia registros `borrable` con filas existentes; retirar es lo único que resuelve (retener exige retirar); el resultado se revalida contra `deletable ∪ retained` en el plan y otra vez en la transacción.
- **Respaldo formato 2:** `retired` por tabla + PK; la restauración acepta además el formato 1 consolidándolo por la PK del manifiesto previo (contenido distinto con la misma PK aborta).
- **Población de R2:** fecha civil argentina de la corrida (`populationDate`, en el reporte de inventario y en el resumen de la limpieza; la limpieza la recalcula a su propia fecha). Candidatos = lista explícita o todos los legajos; alcance = `ruleScopeOf` + `evaluateRuleScope` del motor sobre `loadEngineScopeHistory`. Legajos sin historia suficiente → `R2_POPULATION_HISTORY_MISSING` (bloquea). Las convocatorias de feriado no son población por alcance y R2 no las cambia.
- **R1 sobre sector — sigue bloqueado, con motivo actualizado:** D-4 ya está implementada (A7), pero pasar una regla de un sector anterior a uno nuevo cambia LEGACY_SECTOR → WITHIN y reinterpreta fechas pasadas (§3.4). Alternativas dentro del alcance aprobado: R2 o R3.
- **G6:** M2 debe nombrar sus CHECKs `Sector_archive_shape_check`, `Area_archive_shape_check` y `Establishment_archive_shape_check`. `migrate diff` usa un schema temporal y la variable `REORG_GUARD_DATABASE_URL`.
- **G8 en los pasos 5 y 8:** `outsideInventory = ∅` del congelado + ningún ID referenciado por la historia (congelada o viva) entre los eliminables del plan.
- **G7 en el paso 8 — pendiente de definición:** comparación estricta contra el snapshot del paso 5; cómo separar las vigencias que abra la recarga se define con A8-5.
- **G9:** compuerta = índice de `Employee` encabezado por `status`; los `EXPLAIN` se adjuntan.
- **G7 y zona horaria:** el snapshot normaliza `TIMESTAMPTZ` a ISO UTC.

#### 12.14.5 Hallazgos de la revisión independiente sobre `1c68df4` (commits separados)

- **A — Asignación de puesto en Legajos (`add3d13`):** revalidación dentro de la transacción con
  `FOR SHARE`, contra el puesto leído allí. **[U]**; bloqueo frente al archivo concurrente **[I]**.
- **B — Reversión de `20261008150000` (`6ce4e5c`):** aborta con archivo usado o `isLegacy`
  divergente. **[I]** (tres casos sobre bases locales).

#### 12.14.6 Migraciones

Preparada: `20261008150000_org_catalog_archive_classification` (aditiva) y su reversión endurecida.
**No se aplicó ninguna migración a Neon ni a ninguna base compartida;** sólo a bases locales
desechables. M2 no está escrita. Sin seed, reconciliación ni recálculos.

#### 12.14.7 Bloqueos reales y siguiente paso

- **D-0 (identidad administrativa Neon):** sin `NEON_API_KEY`, `--neon-project-id`, `--expected-branch-id` y `--expected-branch-name` de la rama de ensayo, los comandos de limpieza y restauración no corren ni en dry-run. Es el único bloqueo para ejecutar el comando operativo; la transacción ya está verificada en integración local.
- **D-1 (C1/C2):** define el inventario congelado y, en C2, el gate de §12.7.
- **Decisiones necesarias en `decisions.json`** (no las elige este bloque): R1/R2/R3 **aprobadas** para cada regla que el congelado marque `RULE_WITHOUT_DECISION` (p. ej. "Domingos" en C2), sabiendo que R2 puede bloquear por historia faltante y R1 de sector sigue bloqueado; y resoluciones de clase 4 para los `PositionOrgScope` de QA (HT-5), sólo de la lista cerrada.
- **D-2, D-3, D-6, A8-5:** sin cambios; A8-5 además define G7 en el paso 8.
- **Siguiente paso concreto en la copia (no ejecutado):** (1) con D-0 resuelto, `org-reorg-inventory` sobre la copia con el modo D-1; (2) `org-reorg-guards --phase=F0`; (3) completar `decisions.json` con lo que el reporte marque; (4) `org-reorg-cleanup` en dry-run; (5) revisión del reporte; (6) `--apply --backup`; (7) `org-reorg-restore` en dry-run y luego apply como prueba de restauración; (8) limpieza final + `org-reorg-guards --phase=F1`. Recién con F1 verde, escribir M2 y ensayarla en `reorg-r2`.

#### 12.14.8 Correcciones tras la revisión de Codex hasta `b199732` (2026-10-09)

| # | Hallazgo | Corrección | Commit | Verificación |
|---|---|---|---|---|
| 1 | El respaldo por `"tabla.columna"` dejaba que una resolución pisara a otra y que una fila se reinsertara dos veces | Captura consolidada por tabla + PK sin sobrescribir; respaldado == filas que los predicados encuentran antes de borrar; borrado por PK; formato 2 con compatibilidad explícita del 1; transacciones movidas a `src` con las compuertas en los scripts | `100c725`, `f2cb271` | **[U]** + **[I]** |
| 2 | `retire` aceptaba destinos `conservada`/`nueva` (plan no bloqueado que retiraba alcances hacia una empresa de C1) | Lista cerrada de combinaciones; sólo destinos `borrable` con filas; entradas vacías/contradictorias rechazadas; validación final contra `deletable ∪ retained` en plan y transacción | `b33514d` | **[U]** + **[I]** (rechazo antes de escribir) |
| 3 | La población de R2 comparaba siempre `Employee.sectorId` | Semántica del motor (LEGACY_SECTOR / WITHIN con historia, fecha explícita, faltantes bloquean, feriado aparte); `ruleScopeOf` compartido con el motor | `3b817e7`, `8bf1412` | **[U]** + **[I]** |
| 4 | Empresas empleadoras validadas fuera de la transacción | Revalidación de los vínculos nuevos dentro de la transacción con `FOR SHARE`, contra lo leído allí | `c65404f` | **[U]** + **[I]** (bloqueo real) |
| 4b | Misma ventana en destinos archivados de `DoubleHourRule` | Revalidación en la transacción con `FOR SHARE` contra las FKs leídas allí; la FK preexistente sin cambio se conserva | `721679c` | **[U]** |

`8bf1412` corrige tipos en las pruebas de `3b817e7` (vitest pasaba; `typecheck` no).

#### 12.14.9 Ensayo A8 en modo C1 (2026-10-09): preparación sobre la copia, ensayo sobre su restauración local

**D-1 = C1** (conservar empresas), indicado por el usuario el 2026-10-09. C2 no se ejecutó.

**Destino.** Copia `org-location-reorg`: `backend/.env.reorg` → endpoint `ep-rough-river-aioy7xp9`
(host registrado para la copia desde el 2026-10-08; distinto del de development). **D-0 no
satisfecho:** faltan `NEON_API_KEY`, el ID del proyecto Neon (`--neon-project-id`) y el ID de la rama
`org-location-reorg` (`--expected-branch-id`); no están en la configuración local ni en el entorno.
Sin ellos los comandos de limpieza y restauración se niegan (no se salteó la compuerta), y tampoco se
puede tomar la mitad "rama Neon" del respaldo doble de B0 (§7.1.3).

**Sobre la copia en Neon — sólo lectura, nada escrito:**
- `prisma migrate status`: pendiente exactamente `20261008150000_org_catalog_archive_classification`
  (la aditiva prevista). **No se aplicó**: falta el respaldo doble exigido antes de escribir.
- `pg_dump` (host directo, formato custom) `backups/a8-rehearsal-copy-pre-2026-10-09.dump`, SHA-256
  `5a67d5ae1e04d1ff794958c1a0cff49a18a4dd56f9bbbff61800267c2fcc8251`, y manifiesto por fila
  `backups/a8-rehearsal-copy-pre-2026-10-09.manifest.json` (69 tablas, 5342 filas).
- **Restaurabilidad probada:** el dump restaurado en una base local coincide con el manifiesto de la
  copia en las 69 tablas y 5342 filas, por ID y contenido (0 diferencias). Hallazgo y corrección
  (`a31074d`): el hash del manifiesto dependía del `TimeZone` de la sesión.

**Ensayo sobre la restauración local del dump [I] (datos reales de la copia; no es el ensayo en Neon):**
migración `20261008150000` aplicada sólo en local; `runCleanup`/`runRestore` (las funciones de los
comandos operativos) mediante un arnés limitado a `localhost`; guardas F1 con el comando real.

| Paso | Resultado |
|---|---|
| Inventario C1 congelado + F0 | F0 verde (0 formas mezcladas, G1 0). 6 empresas `conservada`; `borrable`: 11 UN, 18 establecimientos, 43 áreas, 42 sectores, 3 puestos; ampliación de 1 ronda: 2 puestos y 2 sectores `nueva`. G8 verde. 0 raíces históricas → `retained` vacío (nada borrable referenciado por historia) |
| Bloqueos del plan | Sólo `UNCLASSIFIED_OR_NEW_DEPENDENCY`: alcance `3299daab…` de `PUE-006` (2 alcances, 1 legajo) → UN legada `UN-005 Agricultura` (QA de A5, HT-5). Ninguna regla requiere decisión en C1 ("Domingos" y "QA-D5 x1,5 Agricultura" no tocan registros borrables) |
| `decisions.json` | `backups/a8-rehearsal-c1-decisions.json`: 0 reglas; retiro de esa fila — familia y caso enumerados como borrado autorizado en §12.4 (C1: 1 `businessUnitId`). No se eligió `retain` (sería una decisión adicional y no hace falta) |
| Dry-run | `DRY_RUN_OK`: 141 filas a retirar (117 de catálogo, 4 `CostCenterArea`, 1 `CostCenterBusinessUnit`, 2 `CostCenterEstablishment`, 2 `CostCenterSector`, 14 `PositionSalaryCategory`, 1 `PositionOrgScope`), 67 vaciados, 184 filas de auditoría; motor de horas especiales: 0 cambios (población a 2026-10-09); F1 (G4, G3, formas, G7, G5, G8) verde; V1 0 violaciones |
| Aplicación con respaldo | `APPLIED`, mismos resultados; respaldo formato 2 con las 141 filas una vez cada una |
| Guardas F1 (comando) | G2/F1, G3, G4, G5, G7, G8 verdes |
| Conservación (antes vs después de aplicar) | Idénticas por ID y contenido: `TimeEntry` 94, `TimeSegment` 56, `HourConceptBreakdown` 26, `MonthlyTimeClosure` 8, `Novelty` 14, `StorageFile` 165, `LaborMovement` 39, `EmployeeFieldHistory` 25, `EmployeeBlockHistory` 20, `SpecialHourRuleApplication` 22, `AttendancePunch` 80, `WorkShift` 47, `EmployeeAssignment` 6, `DoubleHourRule` 3, las 7 tablas de historia, `Company` 6, `EmployeeCompany` 40. `Employee` 39: hash personal igual; sólo `positionId`/`sectorId` vaciados en 33 legajos (autorizado) |
| Restauración | `RESTORED`: 141 filas reinsertadas, 67 vaciados repuestos; V1 interna 0 |
| Comparación completa | Manifiesto previo a la limpieza vs posterior a la restauración: 69 tablas, 0 diferencias por ID y contenido; únicas filas nuevas: 185 de `AuditLog` (184 limpieza + 1 restauración), que nunca se borran |

Evidencia (fuera del repo, con SHA-256): `backups/a8-rehearsal-local-*` y
`backups/a8-rehearsal-local-2026-10-09.sha256`. La base local se descartó al terminar.

**Para el ensayo en la copia Neon faltan sólo:** (1) los tres datos de D-0; (2) el respaldo de rama
Neon (con D-0, o creado por el usuario en la consola) para completar B0 — el `pg_dump` ya está tomado
y probado. Con eso, en orden: aplicar `20261008150000` en la copia → `org-reorg-inventory` (congelado
C1 real) → `org-reorg-guards --phase=F0` → `org-reorg-cleanup` dry-run con
`a8-rehearsal-c1-decisions.json` (re-verificar que el bloqueo siga siendo sólo esa fila) →
`--apply --backup` → `org-reorg-guards --phase=F1` → `org-reorg-restore` → manifiesto y comparación.
Ninguna decisión de producto adicional es necesaria para C1.

#### 12.14.10 D-0 y respaldo de rama: preparación (2026-10-09)

**Datos a obtener en la consola de Neon** (documentación vigente: [API keys](https://neon.com/docs/manage/api-keys),
[ramas](https://neon.com/docs/manage/branches), [crear rama por API](https://api-docs.neon.tech/reference/createprojectbranch)):

| Dato | Dónde | Notas |
|---|---|---|
| `NEON_API_KEY` | Organización → **Settings → API keys → Create new → Project-scoped**, elegir el proyecto de la copia | Mínimo privilegio: Editor sobre UN proyecto (lee y modifica sus recursos; no borra el proyecto ni opera la organización). Requiere admin de la organización; si no, clave personal (Perfil → Settings → API keys), más amplia. Se muestra una sola vez. Revocarla al cerrar el ensayo |
| `NEON_PROJECT_ID` | Proyecto → **Settings → General → Project ID** (también en la URL del proyecto) | Formato `palabra-palabra-12345678` |
| `NEON_BRANCH_ID` | Proyecto → **Branches** → `org-location-reorg` → campo **ID** | Empieza con `br-`. Debe ser la rama cuyo endpoint es `ep-rough-river-aioy7xp9`; el script lo verifica |

**Configuración local:** `backend/.env.neon-admin` (creado con placeholders, permisos 600, ignorado por
`backend/.gitignore` `.env.*`). Completar sólo `NEON_API_KEY`, `NEON_PROJECT_ID` y `NEON_BRANCH_ID`;
`NEON_BRANCH_NAME`, `REORG_ENV_FILE=.env.reorg` y `REORG_EXPECTED_HOST` ya están. Los scripts se
corren con el lanzador `scripts/org-reorg/neon-admin.ts`, que pasa la clave sólo por el entorno del
proceso hijo y los IDs como los flags que ya exigen los scripts. `backend/.env` no se toca.

**Respaldo de rama (mitad "rama Neon" de B0):** los snapshots manuales de Neon sólo se toman de ramas
raíz; `org-location-reorg` es una rama de ensayo, así que el mecanismo es una **rama hija sin compute**
(`init_source: parent-data`, sin `endpoints`), nombre `org-location-reorg-a8-backup-AAAAMMDD`: copia
copy-on-write que no cambia con las escrituras del ensayo en la rama de origen. Herramienta:
`scripts/org-reorg-branch-backup.ts` (plan de sólo lectura por defecto; `--apply` crea, verifica
`parent_id` y estado `ready`, y registra IDs y LSN fuera del repo). Estado: **preparado, no creado**
(faltan las credenciales). Para atar las dos mitades de B0, justo después de crearla se captura el
manifiesto de la copia y se compara con `a8-rehearsal-copy-pre-2026-10-09.manifest.json` (el del
`pg_dump`): igualdad ⇒ rama y dump representan el mismo estado; si difiere, se toma un dump nuevo.

**Secuencia del ensayo en la copia, con D-0 completo** (`L` = `npx tsx scripts/org-reorg/neon-admin.ts`):
1. `L scripts/org-reorg-branch-backup.ts --record=../backups/a8-copy-branch-plan.json` (sólo lectura: identidad verificada y plan).
2. `L scripts/org-reorg-branch-backup.ts --record=../backups/a8-copy-branch-backup.json --apply` + manifiesto y comparación con el del dump.
3. `migrate status` (sólo lectura) → aplicar **sólo** `20261008150000` en la copia → `migrate status`.
4. `L scripts/org-reorg-inventory.ts --report=../backups/a8-copy-inventory-c1.json` (congelado C1 real) → **re-comprobar** que el único bloqueo de C1 siga siendo el alcance `3299daab…` de `PUE-006` → `UN-005` (`15598eb2…`) y que ninguna regla requiera decisión; si aparece otro caso, se detiene y se presenta.
5. `L scripts/org-reorg-guards.ts --phase=F0 --company-mode=C1 --inventory=… --report=…`.
6. `L scripts/org-reorg-cleanup.ts --company-mode=C1 --inventory=… --decisions=../backups/a8-rehearsal-c1-decisions.json --actor-user-id=<RRHH activo> --report=…` (dry-run) → revisión.
7. `… --apply --backup=…` → `L scripts/org-reorg-guards.ts --phase=F1 …`.
8. `L scripts/org-reorg-restore.ts --backup=… --actor-user-id=… --report=… --apply` → manifiesto y comparación completa con el previo.

Sin M2 ni limpieza final en este bloque.

#### 12.14.11 Ensayo en la copia: D-0 verificado, respaldo de rama bloqueado (2026-10-09)

- **D-0 VERIFICADO por la API** (2026-10-09T12:08Z): proyecto `solitary-scene-44555429`; endpoint
  `ep-rough-river-aioy7xp9` → rama `br-green-bonus-aixba3xg` = `org-location-reorg`, no es la rama por
  defecto (la de por defecto es `production`). La credencial vive sólo en `backend/.env.neon-admin`.
- **Estado de la copia sin cambios desde el `pg_dump`:** manifiesto tomado con identidad verificada
  igual al del dump (5342 filas, 0 diferencias), antes y después del intento de rama.
- **Respaldo de rama: bloqueado.** `POST /branches` → `400 BRANCHING_IS_NOT_ALLOWED: Branches with an
  expiration date cannot have child branches`. No se creó ninguna rama (el proyecto sigue con 4).
- **Hallazgo:** `org-location-reorg` tiene `expires_at = 2026-10-14T12:23:10Z` (creada el 2026-10-07
  desde `development`): Neon la eliminará en esa fecha junto con todo lo que se ensaye en ella. La
  ventana de historia del proyecto es de 6 h (`history_retention_seconds = 21600`).
- **No se escribió nada en la copia:** sin respaldo doble (§7.1.3) no se aplica la migración ni se
  ejecuta la limpieza. Opciones (decisión del usuario): ver la entrega del 2026-10-09.

#### 12.14.12 Ensayo A8 C1 en la copia Neon `org-location-reorg` — completado y restaurado (2026-10-09)

Primer ensayo **real** en la copia Neon con los comandos operativos (`scripts/org-reorg/neon-admin.ts`
+ `org-reorg-*`), identidad D-0 **VERIFICADA** en cada paso (proyecto `solitary-scene-44555429`,
rama `br-green-bonus-aixba3xg` = `org-location-reorg`, endpoint `ep-rough-river-aioy7xp9`, no es la
rama por defecto). Schedulers deshabilitados (`AUTOMATIC_JOBS_ENABLED=false`). development, demo y
production no se tocaron. Evidencia en `backups/a8-copy-*-2026-10-09*` con
`backups/a8-copy-rehearsal-2026-10-09.sha256` (fuera del repo; sin credenciales).

| Paso (§7.2) | Resultado |
|---|---|
| Expiración de la rama (autorizado por el usuario) | `PATCH expires_at: null` sólo sobre `br-green-bonus-aixba3xg`: `2026-10-14T12:23:10Z` → sin expiración (releído) |
| 1. Respaldo doble (B0) | Rama hija `org-location-reorg-a8-backup-20261009` (`br-late-frog-ai7hd0kw`), origen `org-location-reorg`, LSN `0/1DC9BE50`, `ready`, sin compute + `pg_dump` `a8-rehearsal-copy-pre-2026-10-09.dump` (SHA-256 `5a67d5ae…`, restauración probada). Manifiesto de la copia == manifiesto del dump antes y después de crear la rama (0 diferencias): **ambos respaldos representan el mismo estado** |
| 2. Migración aditiva | `migrate status`: sólo `20261008150000` pendiente → `migrate deploy` → al día. Manifiesto: únicamente columnas nuevas en las 6 tablas de catálogo y +1 `_prisma_migrations`; backfill `isLegacy` coherente (0 discrepancias), 0 archivados |
| 3. Inventario C1 + F0 | F0 verde; 6 empresas `conservada`, 117 `borrable`, 4 `nueva` (1 ronda de ampliación); G8 verde; `retained` vacío. **Idéntico** (registros, clases e historia) al del ensayo sobre la restauración local. Guardas F0 (comando): G1, G2/F0, G8 verdes |
| 4. `decisions.json` | Revalidado sin cambios: 0 reglas; único bloqueo C1 = alcance QA `PUE-006` → `UN-005` (`15598eb2…`), retiro autorizado (§12.4) |
| 5. Dry-run | `DRY-RUN OK (revertido)`: 141 filas a retirar, 67 vaciados, 184 auditorías, motor 0 cambios (población 2026-10-09), F1 verde, V1 0 |
| 6. Aplicación con respaldo | `APLICADO`: F1 (G4, G3, formas, G7, G5, G8) verde en la transacción y con el comando de guardas F1; V1 0 violaciones. Respaldo `a8-copy-cleanup-backup-2026-10-09.json` (formato 2) con SHA-256 |
| Conservación (antes → después de aplicar) | Idénticas por ID y contenido: `TimeEntry` 94, `TimeSegment` 56, `HourConceptBreakdown` 26, `MonthlyTimeClosure` 8, `Novelty` 14, `StorageFile` 165, `LaborMovement` 39, `EmployeeFieldHistory` 25, `EmployeeBlockHistory` 20, `SpecialHourRuleApplication` 22, `AttendancePunch` 80, `WorkShift` 47, `EmployeeAssignment` 6, `DoubleHourRule` 3, las 7 tablas de historia, `Company` 6, `EmployeeCompany` 40. `Employee` 39: datos personales iguales; sólo puesto/sector anteriores vaciados en 33 legajos (autorizado) |
| 7. Restauración | `RESTAURADO`: 141 filas reinsertadas una vez cada una, 67 vaciados repuestos; verificación interna 0 |
| Comparación completa | Línea base previa a la limpieza vs posterior a la restauración: 69 tablas, 0 diferencias por ID y contenido; únicas filas nuevas: 185 en `AuditLog` (184 limpieza + 1 restauración) |

**Estado final de la copia:** datos restaurados al estado previo a la limpieza, con la migración
aditiva `20261008150000` aplicada (paso 2 del §7.2, previsto que permanezca), sin expiración y con la
rama de respaldo `br-late-frog-ai7hd0kw` conservada. Sin M2 ni limpieza final.

**Verificación por nivel actualizada:** AT-5, AT-6, AT-9 y la transacción de limpieza/restauración
pasan a **verificadas en la copia Neon** para C1 (sin archivo: en C1 la copia no tiene registros
borrables referenciados por historia, así que `retained` = ∅ y el marcado de archivo se ejerció sólo
en la integración local).

#### 12.14.13 M2 implementada en la rama y verificada localmente (2026-10-09)

**Migración** `20261009150000_org_location_contract_m2` (no aplicada a ninguna base compartida):
guarda previa (aborta sin cambios si quedan `Employee/User/ClockDevice.sectorId` con valor, filas sin
forma final en Sector/Área/Establecimiento o `(zoneId, code)` repetido) → DROP de esas tres columnas
con FKs e índices → CHECKs `Sector/Area/Establishment_archive_shape_check` → único
`Establishment_zoneId_code_key`. Se conservan la cadena legada y `@@unique([companyId, code])` (D-B2).
**Consumidores retirados:** selects/filtros/búsqueda por sector del legajo (legajos, organigrama,
opciones, convocatorias, asistencia, conceptos, regímenes, pendientes, puestos, dashboard),
`assertLegacySectorUnchanged`, comparación estructural legada de la validación contra el puesto,
`sectorId` del dispositivo en autenticación y tipos (D-15), del usuario (D-14), conteos de
dependencias del sector; frontend: filtro "Sector anterior"; seed sin `sectorId`.
Nota: un `sectorId` dentro de un spread condicional (`...(x ? { sectorId } : {})`) **no lo detecta
el compilador** y Prisma lo rechazaría en ejecución: se barrió textualmente además de compilar.

**Concurrencia (2026-10-09):** la migración bloquea las seis tablas (`ACCESS EXCLUSIVE`) antes de la guarda; sin eso, una escritura de `sectorId` confirmada entre la guarda y el `DROP` se perdía en silencio (reproducido). Prueba opt-in `reorg/m2Migration.integration.test.ts` (`REORG_IT_M2_DATABASE_URL`, base `reorg_it_m2*` migrada hasta antes de M2), con control sin bloqueo.

**Recuperación después de M2:**
1. Antes de la recarga: `prisma/rollbacks/20261009150000_org_location_contract_m2.down.sql` (sin
   pérdida: recrea vacías las columnas que M2 sólo pudo retirar vacías, retira CHECKs/único y borra la
   fila de M2 de `_prisma_migrations`; `migrate resolve --rolled-back` no sirve para una migración
   aplicada, P3012) → `org-reorg-restore` con el respaldo de la limpieza → comparación.
   `org-reorg-restore` **se niega** sobre el esquema post-M2 (`LEGACY_COLUMNS` incluye ahora las tres
   columnas retiradas).
2. Después de la recarga, o como último recurso: rama de respaldo (`br-late-frog-ai7hd0kw`) o
   `pg_dump` (`a8-rehearsal-copy-pre-2026-10-09.dump`).

**Verificación local [I]** (restauración del `pg_dump` de la copia, PostgreSQL desechable): limpieza
C1 (F1/V1 verdes) → M2 → **F2 verde** (G1, G5, G6 con CHECKs validados y `migrate diff` vacío, G7, G8,
G9) → a través de M2 sólo cambian las tres columnas y `_prisma_migrations` (+1); el resto, incluidas
las 7 tablas de historia, idéntico por ID y contenido → backend local (schedulers deshabilitados): 25
endpoints principales en 200, 0 errores 5xx → CHECKs y único rechazan altas inválidas → reversión de
M2 + restauración: base idéntica al estado previo a la limpieza (sólo auditoría nueva).
**Pendiente en la copia Neon [P]:** la limpieza C1, M2 y F2 **ya se aplicaron el 2026-10-09**
(§12.14.14); quedan la recarga de datos del cliente sobre la copia y los documentos de §2.6
(AGENTS/CLAUDE "modelo actual", SECURITY_STANDARDS, PERFORMANCE…).

#### 12.14.14 A8 C1 + M2 + F2 aplicados a la copia Neon `org-location-reorg` (2026-10-09)

Secuencia autorizada completa sobre la copia (no se tocó `development` ni producción; sin recarga ni
datos nuevos). **Respaldo previo:** `pg_dump` `../../backups/a8-copy2-pre-2026-10-09.dump`
(SHA-256 `9be1568b…` verificado), manifiesto `a8-copy2-pre-2026-10-09.manifest.json` y rama de la API
`br-dark-moon-aijz7ln0` (`org-location-reorg-a8-backup-20261009-b`, parent `br-green-bonus-aixba3xg`
en LSN `0/1DE03B20`, creada 13:50:38Z, **antes** de la primera escritura a las 14:05:46Z).
Restauración del dump sobre la base local desechable `a8_copy2_restore_check2` (PostgreSQL 18.4,
socket local): log de `pg_restore` en `a8-copy2-pg-restore-2026-10-09.log` (exit=1 sólo por permisos
de Neon inexistentes en el host local), destino real certificado desde esa conexión en
`a8-copy2-restore-local-identity-2026-10-09.txt` y manifiesto **capturado desde esa misma conexión**
(`a8-copy2-post-restore-local-2026-10-09b.manifest.json`, con la conexión local registrada dentro).
Comparación por tablas/columnas/filas contra el manifiesto previo → **IDENTICO**, 69 tablas / 5528
filas (`a8-copy2-restore-check-2026-10-09b.json`; la base local se eliminó). Los archivos de la
primera pasada (`a8-copy2-restore-check-2026-10-09.json` y `…post-restore-local-2026-10-09.manifest.json`)
quedan **sustituidos**: su manifiesto estaba rotulado con el host de Neon en vez del destino local.
Existencia y metadatos de ambas ramas, por GET de la API Neon, en
`a8-copy2-branch-evidence-2026-10-09.json`.

- **Revalidación:** `migrate status` sólo con M2 pendiente (`a8-copy2-migrate-status-pre-2026-10-09.log`),
  inventario sin casos nuevos (`a8-copy2-inventory-c1-2026-10-09.json`, `rules: []` y un único
  `classFour` heredado del caso QA), guardas F0/G8 verdes.
- **C1:** dry-run y apply (`a8-copy2-cleanup-{dryrun,apply}-2026-10-09.json`) con respaldo
  `a8-copy2-cleanup-backup-2026-10-09.json` (SHA-256 `7c29510c…`) → `APLICADO`; V1 184 auditorías /
  141 filas retiradas; **F1 verde** (G2, G3, G4, G5, G7, G8). Conservación comparada con los
  manifiestos: se borró exactamente lo autorizado (Sector 42, Área 43, Establecimiento 18, BusinessUnit
  11, Puesto 3, joins de CostCenter y 14 `PositionSalaryCategory`), Auditoría +184. En legajos, los 39
  repartidos en **33 con `positionId`/`sectorId` vaciados** (los que apuntaban a puestos del modelo
  anterior) y **6 que conservan su `positionId`** (puestos del modelo nuevo, fuera del inventario);
  0 cambios en datos protegidos (`stable`), horas, cierres e historia. El único cambio fuera de lo
  listado es el `sectorId` del usuario `3414677e…` (NULLIFY autorizado, D-14; los 3 usuarios quedan
  con `sectorId` NULL y el de `carga@losod.local` conserva su `companyId`).
- **M2:** `prisma migrate deploy` aplicó `20261009150000_org_location_contract_m2` (64/64,
  `a8-copy2-migrate-deploy-m2-2026-10-09.log`); la guarda previa pasó con `Employee/User/ClockDevice
  .sectorId` sin valores, formas finales correctas y sin `(zoneId, code)` repetido. Tras aplicar:
  tres columnas retiradas, CHECKs de archivo validados y `Establishment_zoneId_code_key` creado;
  conservados la cadena legada y `@@unique([companyId, code])` (D-B2).
- **F2 verde** (G1, G5, G6, G7, G8, G9 → `a8-copy2-guards-f2-2026-10-09.json`). Diferencias reales de
  M2, medidas contra `a8-copy2-post-m2-2026-10-09.manifest.json` (baseline: manifiesto post-limpieza):
  **`_prisma_migrations` +1**; **columnas modificadas**: `Employee -sectorId`, `User -sectorId`,
  `ClockDevice -sectorId` (sólo esas tres); **hashes de fila**: `Employee` `stableDiffs=0` y
  `watchedDiffs=39`, `User` 3 y `ClockDevice` 5 — el hash se recalcula sin la columna retirada, cuyo
  valor era NULL en toda la base antes del deploy (medido); ninguna otra tabla cambió.
- **Arranque y smoke HTTP (evidencia saneada en `a8-copy2-app-smoke-2026-10-09.json`):** backend sobre
  la copia en 4002 con `AUTOMATIC_JOBS_ENABLED=false` (`AUTOMATIC_JOBS_DISABLED` en el log de arranque)
  y Vite en 5174 → login RRHH, `/org-structure` (6 empresas, 1 unidad, 2 sectores, 0 áreas, 2 zonas,
  4 establecimientos, 3 centros de costo), legajos + detalle, organigrama, puestos, ubicaciones de
  trabajo, listado/resumen/asistencia de horas, notificaciones y `/dashboard/metrics` en 200; en el
  log, 0 respuestas 5xx y los únicos 409 son DELETE de entidades con dependencias (regla de negocio,
  no un fallo por columnas retiradas). Quedaron corriendo: `npx tsx src/server.ts` en 4002 (con
  `DATABASE_URL` de `.env.reorg`) y Vite en 5174. **Esto es smoke técnico HTTP, no QA funcional ni
  visual:** la verificación en navegador (login, estructura, puestos, legajos, organigrama) sigue
  pendiente — en este entorno sólo se pudo confirmar el shell servido en 5174.
- **Uso del operador posterior a M2 (manifiesto final en sólo lectura
  `a8-copy2-post-app-usage-2026-10-09.manifest.json` vs baseline post-M2, clasificación en
  `a8-copy2-post-m2-diff-2026-10-09.json`):** las tres llamadas
  `DELETE /api/positions/:id` con HTTP 200 (14:27-14:28Z) **no borraron puestos**: el servicio las
  resolvió como **inactivación** (`removeOrInactivate`, con 1 persona asignada) — `PUE-004`
  `ab2b54d4…` y `PUE-005` `a9a6f458…` (dos llamadas, idempotente) pasaron a `INACTIVO`, con sus 3
  auditorías `UPDATE`; el total de puestos sigue en 5. El resto de las diferencias: **AuditLog +11**
  (esas 3 más 8 `LOGIN` del usuario `fd872d5a…`) y **31 notificaciones** marcadas `LEIDA` con
  `readAt`. **Sin filas borradas en ninguna tabla.** Lecturas del smoke separadas de estas
  escrituras en el reporte. **Pendiente de decisión:** conservar o no estos artefactos de uso de
  prueba (logins, notificaciones leídas, 2 puestos inactivados) hasta la recarga de datos.
- **Recuperación posible en cualquier momento:** `prisma/rollbacks/…m2.down.sql` + `org-reorg-restore`
  con `a8-copy2-cleanup-backup-2026-10-09.json`, o el `pg_dump` previo / la rama de respaldo.
