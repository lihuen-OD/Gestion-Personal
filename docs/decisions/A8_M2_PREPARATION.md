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
> **Propuesta alternativa (§12):** bajo D-B1, los tres `NOT NULL` de la tabla se sustituyen por
> CHECKs condicionales por clase de fila; los padres nuevos siguen siendo obligatorios **para filas
> nuevas**, pero no para filas archivadas.

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
  *(Propuesta alternativa §12: bajo D-B1 no hay conversión que demostrar — el nodo se archiva con su
  forma vieja y M2 no queda bloqueada; esta última frase pasaría a estar vigente sólo si D-B1 se
  rechaza.)*
- **HT-3 — Puestos retenidos [D]:** se conserva la fila y se vacía `Position.sectorId` (columna autorizada
  a NULL). **[C]** Desde D-5 esa columna no es entrada del motor (las vigencias viven en
  `EmployeePositionPeriod`), por lo que el vaciado debería ser neutro — igual se exige la prueba de
  equivalencia antes/después, no el razonamiento. El puesto queda "Pendiente de recarga" hasta que la
  recarga manual lo reemplace; la guarda de M2 debe admitir puestos sin alcance.
- **HT-4 — Empresas referenciadas por historia [D]:** **R1 no es tratamiento de referencias históricas a
  `Company`.** Una empresa referenciada por `EmployeeEmployerPeriodCompany` o por
  `PositionOrgScopePeriodNode.companyId` **conserva su ID**: se excluye del inventario de borrado.
  En **C2 la limpieza aborta** si alguna empresa del inventario está así referenciada; sólo un
  redefinición posterior y aprobada de C2 (que conserve explícitamente las empresas históricas) podría
  habilitarla. **Nunca se reasigna una FK histórica** para liberar el borrado. Para la referencia de
  catálogo de `DoubleHourRule` siguen disponibles R1/R2/R3 (§3.2).
  *(Propuesta alternativa §12: bajo D-B1, esa empresa se **archiva** —clase 2— en C2 en vez de
  abortar, y el texto de "aborta" quedaría actualizado al aprobarse; ver §12.7.)*
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

> **Propuesta alternativa registrada (2026-10-08, §12):** si se aprueba **D-B1**, esta tabla se
> reemplaza por el diseño de §12.4/§12.6 — archivo en su tabla con CHECKs condicionales, en vez de
> `NOT NULL` global y de abortar con "Retenidas por historia" cuando la forma vieja no se puede hacer
> nueva. Hasta esa aprobación, **este §4.1 sigue rigiendo**.

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
  por sí solo; el resto de A8 (A8-1/A8-2/A8-5) sigue abierto.
- **Nodos históricos (hallazgo 2)** — §3.3 HT-2: sin conversión neutra demostrada, el nodo se conserva
  y M2 queda bloqueada.
- **Empresas históricas (hallazgo 4)** — §3.3 HT-4: en C2, aborto si hay historia que referencie una
  empresa del inventario.
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
valores actuales. El plan de §12.4 se ajusta con las compuertas nuevas (historia, clasificación,
cobertura).

### 7.1 Precondiciones (todas antes de escribir) [D]

1. Identidad: copia aislada, host comprobado antes de cada escritura; `development` y producción intactos (D-12).
2. Identidad administrativa Neon verificada (D-0) para limpieza/restauración, incluso en dry-run.
3. Respaldo doble (rama Neon + `pg_dump`) con SHA-256 y **restauración probada** (B0).
4. `migrate status` en solo lectura muestra exactamente las aditivas esperadas de `reorg-r1`
   (`org_location_expand` + `labor_history_periods` + `sector_org_classification`, ésta **ya aplicada**
   en la copia el 2026-10-08, §3.4) y **ninguna M2**.
5. Inventario congelado con las **tres clases de fila** separadas: eliminables / retenidas por historia /
   nuevas (§4.1); 0 FKs sin clasificar.
6. Historia: HT-1 corrido; toda referencia histórica a `Company` implica retener esa empresa (HT-4) y,
   en C2, aborto explícito.
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
3. **Inventario congelado** + clasificación por clases de fila (historia, `PositionOrgScope`, reglas).
4. **Tratamiento de dependencias:** R1/R2/R3 sólo sobre catálogo; retenciones por historia resueltas
   (HT-2/HT-3/HT-4); `decisions.json` firmado.
5. **Limpieza autorizada:** dry-run → revisión → `--apply --backup` → **V1** (ADR §5.4) →
   prueba de restauración → limpieza final. Dentro de la misma transacción: equivalencia del motor
   **histórico** (0 cambios; los 5 `MISSING` siguen `MISSING`) [D].
6. **M2** (`reorg-r2`): `migrate status` → `deploy` → guarda por clases de fila (§4.1) → DROP, NOT NULL
   y `(zoneId, code)`.
7. **Recarga manual:** Organización → Ubicaciones → Puestos → Legajos (con ubicaciones de trabajo) y
   **apertura de historia auditada desde la fecha de corte** para las dimensiones aplicables, incluidos
   alcances de puestos (§6.1); antes de la corte, `MISSING` donde falte evidencia.
8. **Verificaciones:** V2 por ID y contenido; **cobertura por intervalos** `[corte, hoy]` y coherencia
   con los datos actuales (§6.1.3-4); motor en dry-run sin cambios de valor; `migrate status` al día;
   typecheck/test/build verdes en `reorg-r2`; equivalencia de clasificación legado/nuevo (§3.4);
   QA visual contra `docs/reference-ui/`; contratos de §2.6 actualizados; **A8-4** (`EXPLAIN` de
   listados, §5.2).

### 7.3 Qué cambió respecto del plan de ADR §12.4

- Paso 3: clasificación en tres clases de fila + historia y `PositionOrgScope`.
- Paso 4: R1/R2/R3 sólo para catálogo; referencias históricas a `Company` retienen ID (HT-4).
- Paso 5: motor **histórico**; acepta sólo los 5 `MISSING` preexistentes [R].
- Paso 5½ (nuevo): clasificación legado/nuevo persistente con equivalencia antes/después (§3.4).
- Paso 6: guarda por clases; ningún registro con forma vieja sobrevive sin conversión neutra demostrada.
- Paso 7: recarga + apertura de historia **desde la fecha de corte**, con verificación por intervalos.
- La restauración (`org-reorg-restore`) sigue siendo válida **sólo antes de M2** (`LEGACY_COLUMNS`).

## 8. Separación del trabajo

### 8.1 Preparación que puede hacerse ahora (sin ejecución destructiva)

- Este documento y sus correcciones en el ADR (§6, §11, §19.3, §20).
- Inventario de dependencias (§2) con marcas de evidencia [C]/[R]/[D].
- Diseño: guarda por clases de fila (§4.1), HT-1…HT-5 (§3.3), procedimiento de cobertura desde el corte
  (§6.1) — a ratificar; clasificación persistente (§3.4) ya **implementada** como A8-3.
- Lista de cambios de código por archivo (§4.2) como plan de A8.
- Corridas de solo lectura en la copia ya realizadas (2026-10-08, archivos de §1).
- Actualizar `decisions.json` cuando se decidan D-1/D-3, y elegir la fecha de corte.

### 8.2 Ejecución que depende de decisiones pendientes

| Decisión | Qué bloquea |
|---|---|
| **D-1** (C1/C2) | modo del inventario, contenido de la guarda (clase "eliminables"), `EmployeeCompany`/`CostCenterCompany`, tratamiento de "Domingos"; en C2, aborto por empresas históricas (HT-4) |
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
  `PositionSalaryCategory` y demás filas de configuración en cascada), para recargarlos a mano.

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

| Id | Decisión | Ejemplo |
|---|---|---|
| D-1 | C1 o C2 | C1 conserva LOSOD y "Domingos"; C2 exige R1/R2 para la regla **y aborta** si la historia referencia una empresa del inventario (HT-4) |
| D-2 | Zona completa | ¿"Todos los establecimientos de Zona Norte" se marca explícitamente o una lista vacía lo significa? (Hoy: lista vacía se rechaza) |
| D-3 | Rastro de la limpieza | Sólo `AuditLog` (script actual) vs filas en el historial visible del legajo |
| D-6 | Puestos por alcance | ¿Un "Gerente de O'Dwyer" y uno "de Tropa" son dos puestos o uno con dos alcances? (Hoy: una función con alcance distinto = puesto distinto) |
| **A8-1** | Nodo retenido por historia con forma vieja | **Diseño entregado (§12), pendiente de aprobación D-B1:** archivo en su tabla con forma vieja + CHECKs condicionales (§12.3-§12.4), sin inventar padres y sin conversión. Mientras D-B1 no se apruebe sigue rigiendo lo anterior: si `EmployeeLegacySectorPeriod` apunta a un Sector del inventario y no se demuestra una conversión neutra, **se conserva y M2 queda bloqueada** |
| **A8-2** | Alcance exacto de la guarda de M2 | **Diseño entregado (§12):** cuatro clases (nuevas / archivadas / eliminables / dependencias pendientes) con guardas G1-G8 verificables (§12.6), columnas a retirar vs. conservar (§12.5) y efectos sobre limpieza/restauración (§12.7); pendiente de D-B1. Sin B aprobada, rige §4.1: clases eliminable/retenida/nueva; `User.companyId` **no** se exige NOT NULL (nullable, administrativo); puestos sin alcance admitidos |
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
- [x] **A8-1/A8-2 diseñados** (§12): archivo en su tabla con restricciones condicionales en vez de
  NOT NULL global, columnas a retirar vs. conservar, guardas G1-G8 y efectos sobre limpieza y
  restauración. **Pendiente: aprobación de la propuesta** (§12.9); hasta entonces siguen rigiendo
  §4.1 y HT-2.
- Siguiente paso: aprobar o rechazar la propuesta de §12; luego, en `reorg-r2`, implementar M2 y el
  retiro de consumidores, probarlos en la copia aislada, y recién entonces ejecutar el ensayo de §7
  (la clasificación A8-3 ya no está pendiente).

## 12. A8-1 y A8-2 — diseño de nodos históricos y guarda de M2 (2026-10-08) [D]

**Estado: propuesta de diseño, pendiente de aprobación.** No implementa nada: sólo documenta qué se
haría y qué exige aprobar. Sustituiría el párrafo "Retenidas por historia" de §4.1 y la condición de
bloqueo de HT-2 (§3.3) **si se aprueba**; mientras tanto, esas reglas siguen vigentes sin cambios.

### 12.1 La pregunta

Con el plan vigente (§4.1, HT-2), un registro retenido por historia con forma vieja
(`Sector.businessUnitId IS NULL`, `Area.sectorId IS NULL`, `Establishment.zoneId IS NULL`) debe
convertirse a la forma nueva sin inventar padres; si la conversión no es neutra demostrable, **M2
queda bloqueada**. La pregunta de A8-1 es si existe una salida que conserve el registro sin
convertirlo; la de A8-2 es cuál es el alcance exacto de la guarda que lo permite.

### 12.2 Alternativas evaluadas

| | A — plan vigente (§4.1 / HT-2) | **B — archivo en su tabla (propuesta)** | C — "reubicar como INACTIVO" |
|---|---|---|---|
| Qué hace con un nodo retenido | exige convertirlo a forma nueva | lo deja donde está, con su forma vieja, protegido por CHECKs condicionales | lo mueve/reclasifica en el árbol nuevo |
| M2 con archivo no vacío | **bloqueada** | **procede** | no aplica |
| Evidencia exigida | neutralidad demostrada en 4 planos | viabilidad técnica (§12.3-§12.6) | — |
| Estado | vigente si B no se aprueba | **recomendada, pendiente de aprobación** | **rechazada** (ADR §20 hallazgo 2) |

- **A** sigue siendo el plan hasta que B se apruebe. Es correcto pero conservador: hace de una fila
  histórica potencial un bloqueo duro de M2 (HT-2).
- **B** es la alternativa pedida para evaluar. No se da por aprobada: §12.3-§12.6 demuestran viabilidad
  y §12.8 lista los límites; §12.9 lista lo que el usuario debe decidir.
- **C** no se reconsidera (rechazo ratificado en ADR §20).

### 12.3 Propuesta B — archivo en su tabla con restricciones condicionales

**Idea central:** los registros retenidos por historia **no se convierten**. Se quedan en sus tablas,
con su forma vieja (padre nuevo `NULL`, como hoy), y M2 deja de exigir `NOT NULL` global sobre los
padres nuevos: en su lugar agrega CHECKs **bicondicionales por fila**, de modo que cada fila sólo
está sujeta a la forma que le corresponde (asumiendo D-B3 de §12.9, `isLegacy` también en `Area` y
`Establishment`; si D-B3 se rechaza, los CHECKs de esas dos tablas se reducen a la forma descrita en
la nota al pie):

```sql
-- M2 (reorg-r2), sólo si se aprueba la propuesta B [D]
-- Fila nueva: su padre nuevo NO puede ser NULL.
-- Fila archivada: su padre nuevo DEBE ser NULL (nadie le inventa un padre).
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_parent_class_check"
  CHECK (( "isLegacy" = false AND "businessUnitId" IS NOT NULL )
      OR ( "isLegacy" = true  AND "businessUnitId" IS NULL     ));

ALTER TABLE "Area" ADD CONSTRAINT "Area_parent_class_check"
  CHECK (( "isLegacy" = false AND "sectorId" IS NOT NULL )
      OR ( "isLegacy" = true  AND "sectorId" IS NULL     ));

ALTER TABLE "Establishment" ADD CONSTRAINT "Establishment_parent_class_check"
  CHECK (( "isLegacy" = false AND "zoneId" IS NOT NULL )
      OR ( "isLegacy" = true  AND "zoneId" IS NULL     ));
```

(Sin D-B3, `Area`/`Establishment` no tienen `isLegacy` y el CHECK sólo puede exigir "cada fila tiene
al menos un padre" — `sectorId IS NOT NULL OR establishmentId IS NOT NULL` en `Area`, `zoneId IS NOT
NULL OR companyId IS NOT NULL` en `Establishment` —; la regla "archivado no gana padre nuevo" queda
entonces sólo en servicio, sin sostén en la base. Por eso D-B3 está vinculada a D-B1.)
Los CHECKs **no** fuerzan la cadena vieja del archivado (un sector legado pudo nacer sin `areaId`):
la preservación de la cadena es la guarda de datos G2 de §12.6, no una restricción SQL.

Características de la propuesta:

1. **La clasificación donde ya existe no cambia.** La clasificación ya existe en `Sector.isLegacy` (A8-3);
   `Area`/`Establishment` se clasifican hoy en lectura por `sectorId IS NULL` / `zoneId IS NULL`
   (`orgStructure.repository.ts:192,210`), criterio que coincide con el backfill de A8-3
   (`isLegacy = (padre nuevo IS NULL)`). No se agrega `isLegacy` a esas dos tablas salvo que se
   quiera la misma persistencia que en `Sector` (decisión D-B3 de §12.9).
2. **La identidad histórica no se toca:** los IDs, las FKs `RESTRICT` de las siete tablas de D-5 y el
   closure de ancestros siguen garantizando que nada referenciado se borra
   (`schema.prisma` historia, `cleanupPlan.ts:189-205`).
3. **La exclusión de nuevas selecciones ya está implementada** [C]: `assertParent`
   (`orgStructure.service.ts:99`) rechaza colgar hijos de un legado; `updateNode`
   (`orgStructure.service.ts:166`) rechaza reubicar un legado; `assertNoNewLegacyLinks`
   (`:111`) rechaza vínculos nuevos de centros de costo; `positions.service.ts:74`
   (`POSITION_SCOPE_LEGACY`) excluye sectores legados de nuevos alcances. La propuesta sólo
   **sostiene** estas reglas en la base con los CHECKs, no las reemplaza.
4. **Sin inventar padres nunca:** el CHECK de clase impide que una fila archivada gane un padre
   nuevo (que sería reubicación, rechazada por servicio) y que una fila nueva nazca sin padre.

### 12.4 DDL previsto en M2 bajo la propuesta B [D]

Archivo único en `reorg-r2` (patrón: aditivo primero, luego restricciones, luego DROP):

1. **CHECKs condicionales** (§12.3) en `Sector`, `Area`, `Establishment` — sustituyen los tres
   `NOT NULL` de §2.2. Los CHECK escritos a mano **no se modelan en Prisma** y `schema.prisma` no
   gana campos NOT NULL nuevos por este motivo (precedente: `PositionOrgScope_level_target_check` y
   `EmployeeWorkLocation_*` en `migration.sql` de M1, líneas 204/215/221; verificados como
   estables ante `migrate diff` en A2 del ADR); el único `@@unique` nuevo es el de D-13, punto 3.
2. **Sin `NOT NULL` global sobre los tres padres nuevos:** el NOT NULL global es exactamente lo que
   una fila archivada (padre nuevo `NULL`) no puede cumplir; lo que sí exige es que **cada fila nueva**
   tenga padre, y eso lo dan los CHECKs de §12.3. `BusinessUnit.companyId` ya es NOT NULL y no cambia.
3. **D-13:** `CREATE UNIQUE INDEX` por `(zoneId, code)` sobre `Establishment`, **conservando**
   `@@unique([companyId, code])` mientras existan filas archivadas que lo usen; en `schema.prisma`
   se modela como `@@unique([zoneId, code])`. Ambos conviven sin impedir altas nuevas: en Postgres
   los `NULL` no colisionan, de modo que las filas legadas (`zoneId NULL`) siguen regidas por el
   único viejo y las nuevas (`companyId NULL`) por el nuevo.
4. **DROP de columnas** según la tabla de §12.5, con precondición de conteo `= 0` (DO-block que
   aborta si alguna fila aún usa la columna, mismo patrón fall-closed que `org-reorg-restore.ts:65`).
5. Sincronización de `schema.prisma`, `prisma validate`, regeneración del cliente y
   `migrate diff` vacío (guarda de deriva).

**No toca:** tablas de historia, `AuditLog`, legajos, horas, cierres, documentos, historiales,
`DoubleHourRule.*` (salvo retiro ya autorizado), `EmployeeCompany`, `CostCenter*`.

### 12.5 Columnas: retirar vs. conservar

| Grupo | Columnas | Tratimiento en M2 | Condición |
|---|---|---|---|
| **Retirar** | `Employee.sectorId` (+ índices `[status, sectorId]`, `[sectorId]`), `User.sectorId`, `ClockDevice.sectorId` (+ índice) | **DROP** | Se ejecuta en M2, en este orden: A8 retira sus consumidores (§4.2, incluye D-15 para dispositivos), la limpieza B3 las pone en NULL, conteo `= 0` (DO-block que aborta si queda algún valor), y A8-4 valida planes de consulta tras el DROP |
| **Conservar mientras haya archivo** | `Sector.areaId`, `Area.establishmentId`, `Establishment.companyId`, `Establishment.businessUnitId`, `Position.sectorId` (+ `@@unique([companyId, code])`) | **No se dropean en M2** | Se retiran en una etapa posterior (purga del archivo) con su propio conteo `= 0`; hasta entonces son la "ruta histórica" del archivo (HT-2 plano 2) |
| **Conservar siempre** | `Sector.isLegacy`, padres nuevos (`businessUnitId`, `sectorId` de Area, `zoneId`), FKs `RESTRICT` de historia | intactas | — |

Justificación de la diferencia: `Employee/User/ClockDevice.sectorId` apuntan a un legajo, un usuario
o un dispositivo — su valor es estado actual, no evidencia, y A8 retira sus consumidores en §4.2
antes de que M2 los dropee; las
columnas de la cadena interna, en cambio, **son** la forma archivada del registro: dropearlas
mutilaría el archivo que la propuesta existe para conservar. Bajo el plan A (sin B aprobada) esas
cinco sí caían en M2 con la condición de §4.1. Nota sobre HT-3: bajo B, vaciar `Position.sectorId`
deja de ser necesario (la columna se conserva con el archivo); si se prefiere vaciarla igual — sigue
siendo neutral según el propio HT-3, porque desde D-5 no es entrada del motor — es una variante de
D-B2, no un requisito del diseño.

### 12.6 Guardas verificables (A8-2) — cuatro clases de fila

| Cla­se | Definición | Condición que exige la guarda (aborta si no) |
|---|---|---|
| **1. Nuevas / modelo nuevo** | filas creadas por el modelo nuevo (incl. QA) | Padre nuevo NOT NULL (o, bajo B, CHECK de clase nueva cumplido); ninguna apunta a un ID eliminable; ninguna tiene forma vieja |
| **2. Archivadas (retenidas por historia o R3)** | IDs excluidos del inventario porque evidencia los referencia | **Forma vieja preservada** (padre nuevo `NULL`, cadena vieja intacta), identidad y contenido idénticos a los previos a la limpieza (V1 por ID y contenido), CHECK de clase archivada cumplido, closure de ancestros también archivado |
| **3. Eliminables** | IDs del inventario congelado destinados a borrado | **0 restantes** tras la limpieza, ni borrados parcialmente ni con forma nueva |
| **4. Dependencias operativas pendientes** | referencias de catálogo/modelo nuevo sin decisión (`RULE_WITHOUT_DECISION`, `UNCLASSIFIED_OR_NEW_DEPENDENCY`, `OUTSIDE_RECORD_DEPENDS_ON_INVENTORY`) | **0 sin resolver**: cada una tiene R1/R2/R3, retención o retiro de la fila nueva aplicado y registrado antes de limpiar |

Verificaciones concretas [D] (se escriben al implementar; todas son consultas deterministas sobre la
copia, sin escritura):

- **G1 — clasificación:** `COUNT(*)` de sectores con `isLegacy = true AND businessUnitId IS NOT NULL`
  o `isLegacy = false AND businessUnitId IS NULL` → **0** (equivalente al CHECK; sirve como precondición
  antes de M2 y como verificación de backfill si se extiende a Area/Establishment).
- **G2 — forma archivada:** `COUNT(*)` de filas de la clase 2 con padre nuevo no `NULL` o cadena vieja
  rota (p. ej. un sector archivado con `areaId` apuntando a un área eliminable) → **0**.
- **G3 — eliminables:** por cada tabla de `DELETE_ORDER`, `COUNT(*)` de IDs del inventario deletable
  presentes → **0**.
- **G4 — contenido del archivo:** hash/`compare` por ID y contenido de las filas de la clase 2 contra
  el manifiesto V1 previo a la limpieza → **idénticos** (mismo mecanismo de V1, ADR §5.4).
- **G5 — selecciones nuevas:** `COUNT(*)` de filas de `PositionOrgScope`, `EmployeeWorkLocation`,
  `EmployeeWorkLocationEstablishment`, vínculos nuevos de `CostCenter*` y altas de servicio que apunten
  a un legado → **0** (hoy ya garantizado por servicio; G5 lo confirma en datos).
- **G6 — restricciones activas:** en `information_schema.check_constraints`, los CHECKs de clase de
  M2 presentes y `validated` → **true**; `prisma migrate diff` vacío contra `schema.prisma`.
- **G7 — historias intactas:** `COUNT(*)` de filas de las 7 tablas de D-5 que referenciaban IDs del
  inventario y ahora apuntan a IDs de la clase 2 → **idéntico al previo** (las FKs `RESTRICT` lo
  garantizan a nivel DB; G7 sólo lo constata).
- **G8 — índices y planes (A8-4):** `EXPLAIN` de listados de legajos tras los DROP, cobertura de
  `@@index([status])` según `docs/PERFORMANCE_STANDARDS.md`.

### 12.7 Efectos sobre limpieza y restauración

- **`cleanupPlan.ts`:** `HISTORY` deja de emitir sólo bloqueo (`cleanupPlan.ts:116-118`) para, bajo
  B, **clasificar la referencia como retención**: la fila referenciada pasa a la clase 2 (se agrega
  como raíz de `retainedClosure`, `cleanupPlan.ts:189-205`) y deja de estar en `deletable`. El issue
  pasa a informativo (`HISTORY_ARCHIVED`, `blocking: false`) salvo cuando la retención entre en
  conflicto con otra clase (p. ej. una fila de la clase 4 apuntando al mismo ID), que sigue abortando.
- **HT-4 / C2:** una empresa del inventario referenciada por historia **se archiva** en vez de abortar
  la limpieza; el texto de §3.3 HT-4 y de ADR §6 (aclaración de A8) quedaría actualizado al aprobarse
  B. **R1/R2 siguen sin aplicarse a historia** (no se reasigna ninguna FK histórica).
- **R3:** una regla que referencia un destino retenido ya no bloquea M2 (§6 del ADR: "M2 queda
  bloqueada hasta resolverlo" pasaría a "el destino se archiva y la regla sigue refiriéndolo");
  R1/R2 siguen aplicándose cuando el destino **sí** es eliminable.
- **Orden y transacción:** `DELETE_ORDER`, respaldo previo, manifiesto V1 y verificación por ID y
  contenido (ADR §5.4) no cambian. La única variante es el tamaño de `deletable` (clase 3) vs.
  `retained` (clase 2).
- **Restauración (`org-reorg-restore.ts`):** **sin cambio.** `LEGACY_COLUMNS` (línea 38) exige las
  cinco columnas de la cadena y aborta con "M2 ya se aplicó" si falta alguna (línea 65). Bajo B,
  cuatro de ellas se conservan en M2 (§12.5) pero `Employee.sectorId` **sí** se dropea, así que el
  chequeo sigue distinguiendo "antes" de "después de M2" exactamente igual que hoy. El alcance de la
  restauración (sólo antes de la limpieza, mismos respaldos, re-inserción por ID con la forma previa)
  no cambia.
- **Seed / fixtures / contratos (§2.5, §2.6):** bajo B, `Employee.sectorId` y `User.sectorId` se
  dropean igual y siguen aplicándose los cambios de §4.2; lo que cambia es que el seed **no necesita
  convertir** sectores/áreas/establecimientos archivados: no los toca. El workaround de unicidad de
  `seed.ts:76-88` caduca igual con D-13; bajo B, como `(companyId, code)` se conserva hasta la purga
  (§12.5), ese workaround caduca en la etapa de purga, no en M2.

### 12.8 Límites de la propuesta (por qué no es gratis)

- **La convivencia es permanente:** el modelo queda con dos formas de fila en tres tablas. Todos los
  consumidores nuevos deben seguir respetando la exclusión de legados; los CHECKs sólo impiden
  reubicar/crear mal, no garantizan por sí solos que una pantalla futura no muestre un archivado como
  nodo activo (eso lo siguen haciendo los filtros y `isLegacy`).
- **No libera las decisiones pendientes:** D-1 (C1/C2), D-2, D-3, D-6, A8-5 (fecha de corte) y D-0
  siguen bloqueando B1/B4 de igual manera; HT-5 (QA que referencia inventario) se resuelve igual.
- **El archivo no se purga nunca de forma automática:** retirar las cinco columnas y borrar filas
  archivadas es una etapa propia, con sus propias decisiones y respaldos; si nadie la ordena, el
  archivo queda indefinidamente (costo aceptado y documentado, no deuda oculta).
- **Riesgo de CHECK escritos a mano:** son SQL fuera del modelo Prisma. Mitigación: precedente M1 ya
  verificado estable (A2), G6 en cada entorno y `migrate diff` vacío.
- **Riesgo de divergencia HT-1:** si en `development` hay historia que referencia inventario (esperado
  0), bajo B eso ya no bloquea M2, pero **sí** cambia el tamaño de `deletable` y activa las clases 2/4;
  HT-1 sigue siendo la medición previa obligatoria.

### 12.9 Decisiones que exige la propuesta B (pendientes del usuario)

| Id | Decisión | Si se aprueba / si se rechaza |
|---|---|---|
| **D-B1** | **Aprobar la propuesta B** (archivo en su tabla + CHECKs condicionales) y con ella: levantar la condición de bloqueo de HT-2, actualizar §4.1/§3.3 y ADR §6/§20-hallazgo-2 | Aprueba ⇒ se redacta el DDL de M2 bajo §12.4. Rechaza ⇒ sigue rigiendo el plan A (M2 bloqueada con archivo no vacío) |
| **D-B2** | Retiro de las cinco columnas de la cadena que sí sobreviven a M2 (`Sector.areaId`, `Area.establishmentId`, `Establishment.companyId/businessUnitId`, `Position.sectorId`) y del `@@unique([companyId, code])`: **etapa posterior con conteo 0** (§12.5); incluye si `Position.sectorId` se vacía ya en M2 (variante HT-3) o se conserva con el archivo | Aprueba ⇒ se agrega una etapa de purga al plan de etapas. Rechaza ⇒ se vuelve a la condición de §4.1 (DROP en M2 con abort si hay archivo) |
| **D-B3** | Persistir `isLegacy` también en `Area` y `Establishment` (mismo patrón A8-3) o mantener la clasificación en lectura actual (`orgStructure.repository.ts:192,210`) | Aprueba ⇒ las dos columnas se agregan en la fase aditiva de M2 (§12.4) con backfill `isLegacy = (padre nuevo IS NULL)`, patrón A8-3, y los CHECKs quedan bicondicionales completos; rechaza ⇒ CHECKs reducidos a "al menos un padre" (§12.3) y la regla de archivado queda sólo en servicio |
| **D-B4** | Excluir los archivados de nuevas selecciones **a nivel de base** además de servicio (p. ej. filtro `WHERE "isLegacy" = false` obligatorio en vistas/repositorio) o sólo mantener los CHECKs de forma | Se decide junto con D-B1; sólo-servicio es el mínimo, base-da-defensa-en-profundidad |

Mientras D-B1 no esté resuelta, A8-1 y A8-2 siguen **abiertos** en §10 y el diseño de §12 queda como
propuesta registrada, sin efecto sobre el plan.
