# A8 — Preparación de M2 y retiro del modelo anterior

Fecha: 2026-10-08
Rama: `feat/org-location-reorg` (HEAD `46ac79a`, árbol limpio)
Estado: **diagnóstico y diseño previos. Sin ejecución destructiva ni cambios de código.**

> Alcance de este documento: preparar A8 para revisión (ADR `ORG_LOCATION_REORGANIZATION.md`, etapa A8).
> No ejecuta M2, limpieza, restauración, seed ni reconciliación; no escribe en ninguna base;
> no modifica `development` ni producción; no hace push, merge ni despliegue; no toca notificaciones.
> Referencias: ADR §5–§8 (alcance y ensayo), §17.2 (inventario previo), §18–§19 (A7 cerrada, D-5).

## 1. Fuentes verificadas

- `AGENTS.md` y ADR `docs/decisions/ORG_LOCATION_REORGANIZATION.md` (completo, §11–§19).
- `git status` (limpio), `git log` (A7 cerrada en `46ac79a`).
- Esquema real: `backend/prisma/schema.prisma` + migraciones `20261007120000_org_location_expand` (M1)
  y `20261008090000_labor_history_periods` (D-5). **No existe ninguna migración M2** (ni archivo de reversión).
- Reportes de solo lectura sobre la copia aislada `org-location-reorg` (2026-10-08), en `../backups/`
  (fuera del repositorio): `d5-org-reorg-inventory-copy-2026-10-08.json`,
  `d5-coverage-pre-qa-2026-10-08.json`, `d5-engine-before-2026-10-08.json`,
  `d5-engine-after-qa-2026-10-08.json`, `d5-engine-before-vs-after-qa.summary.json`.

## 2. Inventario de dependencias que M2 eliminaría

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
| `User.companyId` | 362 / 368 | SET NULL | — | **Se conserva** (D-14 ratificada: dato administrativo); bajo C2 queda NULL (D-1) |
| `ClockDevice.sectorId` | 1957 / 1974 | SET NULL | `@@index([sectorId])` 1985 | DROP columna + índice; **antes** hay que retirar sus lecturas (§4.2) |

**Se conservan en M2:** `BusinessUnit.companyId` (ambos modelos lo usan), `DoubleHourRule.companyId/sectorId/costCenterId/positionId` (ADR §6),
`EmployeeLegacySectorPeriod` y el resto de tablas de historia, `EmployeeCompany`, `CostCenter*`, `PositionSalaryCategory`.

### 2.2 Padres nuevos que pasan a obligatorios

| Columna | Estado en M1 | M2 |
|---|---|---|
| `Sector.businessUnitId` | nullable, FK RESTRICT | NOT NULL |
| `Area.sectorId` | nullable, FK RESTRICT | NOT NULL |
| `Establishment.zoneId` | nullable, FK RESTRICT | NOT NULL |

### 2.3 Consumidores — backend

| Área | Archivos | Lectura/escritura legacy |
|---|---|---|
| Legajos (selects) | `employees/employees.repository.ts` (106-120, 134-196, 226-281, 330-395, 477-549, 590-613, 632-655, 789-835, 1306-1337) | cadenas `sector.area.establishment.businessUnit`, `position.sectorId` |
| Legajos (filtros) | `employees.repository.ts` 891-978, `employees.schemas.ts` 19-44, 95; `shared/prisma/employeeStructureWhere.ts` 15-71; `shared/prisma/employeeAssociationQuery.ts` 18-65 | `query.sectorId`, "Sector anterior", búsqueda por nombre de sector |
| Legajos (escritura) | `employees.repository.ts` 958-1007; `employees.service.ts` 411-421 (`EMPLOYEE_LEGACY_SECTOR_READ_ONLY`), 789-811, 856, 894 | `sectorId` de sólo lectura, validación derivada de la cadena anterior |
| Puestos | `positions/positions.repository.ts` 14-97 (`positionInclude`, `positionOptionSelect`), 190-198; `positions.service.ts` 35-83 | cadena legada + `sectorId` |
| Estructura | `org-structure/orgStructure.repository.ts` 42-94, 168-187, 304-367; `orgStructure.dependencies.ts`; `reorg/cleanupPlan.ts` 48-84; `reorg/manifest.ts` 14-17 | padres legacy, `isLegacy`, unicidad `companyId+code`, plan de limpieza |
| Motor de horas especiales | `time-entries/timeEntries.repository.ts` 214-378 (`sectorIsLegacy`, `evaluateSpecialHourRulesByDate`); `workforce-management/workforce.service.ts` 142-144; `doubleHourRuleMatching.ts` 123-140 | dimensión sector legado + empresa empleadora; **la resolución por fecha ya lee sólo historia** (`labor-history/laborHistory.service.ts` 212-222) |
| Historia laboral | `labor-history/laborHistory.scope.ts` 42-89; `laborHistory.repository.ts` 45-139 | `LEGACY_SECTOR` como dimensión; tablas de vigencias (se conservan) |
| Usuarios / auth | `users/users.repository.ts` 11-87; `users.schemas.ts` 20, 29; `types/express.d.ts` 10-24 | `companyId` (se conserva); `AuthUser.sectorId` ya no se puebla (sólo fixture en `auth.service.test.ts:43`) |
| Dashboard | `dashboard/dashboard.service.ts` 85-102 (payload `sector`, clave de caché con `companyId`); `dashboard.repository.ts` 238 | columna "Sector anterior" del payload; clave de caché |
| Dispositivos | `clock-devices/clockDevices.repository.ts` 53, 108-119; `clockDeviceAuthentication.ts` 19, 71 | lectura de `sectorId` en credencial → `req.clockDevice.sectorId` |
| Otros filtros | `pending/pending.repository.ts` 49-84; `shifts/holidayWorkAssignment.*.ts` 19-47; `hour-concepts/hourConcepts.schemas.ts` 38-40; `work-regimes/workRegimes.schemas.ts` 79-81 | `sectorId`/`companyId` en listados y candidatos |

### 2.4 Consumidores — frontend

| Área | Archivos | Lectura legacy |
|---|---|---|
| Filtros de estructura | `components/employees/structureFilters/employeeStructureFilters.ts` (23-89), `EmployeeStructureFilterControls.tsx` (35-91) | `legacySectorId → params.sectorId`, "Sector anterior" |
| Páginas | `EmployeesPage.tsx` (62-98), `HolidayWorkAssignmentsPage.tsx` (164, 345), `WorkScheduleSettingsPage.tsx` (62-474), `DashboardPage.tsx` (32, 51, 119), `PuestosPage.tsx` (28, 57), `UsersPage.tsx` (41-267) | filtros/selectores por sector anterior; columna "Sector anterior"; filtro muerto de Nivel 2 |
| Servicios API | `employeeApiService.ts`, `positionApiService.ts` (38-160, campos `derived*`), `orgStructureApiService.ts` (34-267, padres legacy y `pendingReload`), `holidayWorkAssignmentApiService.ts` (48-78), `workforceApiService.ts` (110-148), `userApiService.ts` (15-106), `apiClient.ts` (34-41) | parámetros, campos derivados de la cadena, etiquetas de error |
| Tipos | `types/orgStructure.types.ts`, `types/position.types.ts` (36-63), `types/index.ts` (10-17), `types/associatedEmployee.types.ts` | columnas y `derived*Id` |
| Organización | `components/org-structure/orgStructureEntities.ts` (82-188), `orgScopePath.ts`, `orgStructureTree.ts`, `OrgStructureTable.tsx`, `orgStructureTree.fixtures.ts` | padres legacy, etiquetas "Pendiente de recarga" |
| Caché | `services/cache/cacheKey.ts` 19-37 | `sectorId` en el alcance de la clave (hoy siempre `null`) |
| Datos demo / fixtures | `data/mockOrgStructure.ts`, `data/mockPositions.ts`, `data/mockData.ts`, `services/employeeMockService.ts`, `services/api/dashboardMetricsApiService.ts:11` | forma legacy completa |

### 2.5 Scripts, seed, fixtures y contratos de prueba

- `backend/prisma/seed.ts`: escribe `User.sectorId` (93, 99), `Position.sectorId` (349), `Employee.sectorId` (366);
  y busca el establecimiento por zona "porque `companyId` único no admite `companyId IS NULL`" (76-88) — workaround que caduca con D-13.
- `backend/scripts/org-reorg/*` e `org-reorg-*.ts`: dependen del modelo anterior por diseño (se retiran después de B4).
  `org-reorg-restore.ts:38` declara `LEGACY_COLUMNS` (5 columnas) — **sólo válido antes de M2**.
- `backend/scripts/labor-history/simulatedReaders.ts`: simula la eliminación de columnas para comparar el motor.
- E2E: `frontend/e2e/support/adminConfigurationJourney.ts:592` (contrato `GET /positions?sectorId=`),
  `performanceEmployeesJourney.ts:249` (contrato `GET /employees?companyId=`).
- Frontend fixtures: `orgStructureTree.fixtures.ts` y los `mock*` de §2.4.

### 2.6 Contratos y documentos a actualizar en el mismo cambio

- `docs/BACKEND_API_CONTRACTS.md`: 49, 187, 203-230, 278-283, 416-429, 715-747, 769-781, 1060, 1172, 1694, 1750-1784.
- `docs/DATABASE_STANDARDS.md`: 60-66, 82-93, 174-178 (modelo actual descrito como "en transición").
- `docs/ARCHITECTURE_STANDARDS.md`: 65.
- `docs/PROJECT_CONTEXT.md`: 212, 357, 800-807, 939.
- `docs/SECURITY_STANDARDS.md`: 79-81 (`req.clockDevice.sectorId`, invariante "metadato, no autorización").
- `docs/PERFORMANCE_NETWORK_OPTIMIZATION_PLAN.md`: 240, 380 (contrato de filtros e índice `Employee(sectorId, status)`).
- `AGENTS.md:76` / `CLAUDE.md:69`: regla "modelo actual" (`Position.sectorId` / `Employee.sectorId`).
- `docs/decisions/HOLIDAY_WORK_ASSIGNMENTS_12D.md` (19-91) y `FICHADOR_STANDALONE_PWA_PLAN.md` (203-366, 1171, 1711-1716).

### 2.7 Tests que ejercitan columnas legacy (muestra representativa)

- Backend: `employees.repository.test.ts`, `employees.service.test.ts`, `employees.laborAssignment.test.ts`,
  `structureChanges.noRecalculation.test.ts`, `employeeStructureWhere.test.ts`, `employeeAssociationQuery.test.ts`,
  `positions.repository.test.ts`, `positions.service.test.ts`, `orgStructure.*.test.ts`, `reorg/cleanupPlan.test.ts`,
  `reorg/manifest.test.ts`, `doubleHourRuleScope.characterization.test.ts`, `workforce.service.test.ts`,
  `laborHistory.scope.test.ts`, `clockDevice.schema.test.ts` (**afirma `ON DELETE SET NULL` de `ClockDevice.sectorId`**),
  `dashboard.service.test.ts` (clave de caché sin `sectorId`), `auth.service.test.ts`, `pending.service.test.ts`,
  `holidayWorkAssignment.*.test.ts`, `hourConcepts.*.test.ts`, `workRegimes.*.test.ts`.
- Frontend: `employeeStructureFilters.test.ts`, `PuestoIdentificationTab.test.ts`, `OrgStructurePage.test.tsx`,
  `PuestosPage.filters.test.ts`, `WorkScheduleSettingsPage.test.tsx`, `HolidayWorkAssignmentsPage.test.tsx`,
  `positionApiService.test.ts`, `orgStructureApiService.test.ts`, `cacheKey.test.ts`, `associatedEmployeeMapper.test.ts`.

## 3. Tablas históricas: períodos, evidencia y referencias

### 3.1 Las siete tablas de D-5 (migración `20261008090000`)

`EmployeePositionPeriod`, `EmployeeCostCenterPeriod`, `EmployeeLegacySectorPeriod`,
`EmployeeEmployerPeriod`, `EmployeeEmployerPeriodCompany`, `PositionOrgScopePeriod`,
`PositionOrgScopePeriodNode`.

- Todas las FKs hacia legajo, puesto, estructura y centro de costo son **RESTRICT**;
  autoría (`createdByUserId`) es `SetNull`.
- **Regla inamovible (ADR §19.3, ya implementada en `cleanupPlan.ts:17-19, 74-83, 116-118`):**
  la historia no se borra, no se vacía y no se re-clava para liberar una referencia.
  `HISTORY_REFERENCES_INVENTORY` es un bloqueo de limpieza, no un tratamiento.

### 3.2 Catálogo actual vs. datos para resolver el pasado

| Tipo de referencia | Ejemplos | Tratamiento |
|---|---|---|
| **Catálogo actual** (se puede limpiar/reemplazar con decisión) | `DoubleHourRule.companyId/sectorId/positionId`, vínculos `CostCenter*`, `PositionSalaryCategory`, cadena interna `Sector.areaId`… | R1/R2/R3, `DELETE_LINKS`, `CHAIN` (ADR §5-§6) |
| **Datos para resolver el pasado** (nunca se tocan) | las 7 tablas de vigencias + `EmployeeFieldHistory`/`EmployeeBlockHistory` (texto), `AuditLog`, `SpecialHourRuleApplication`, cierres, horas, desgloses | `HISTORY` / fuera de alcance |
| **Modelo nuevo** (aparece después de la limpieza) | `PositionOrgScope`, `EmployeeWorkLocation(+Establishment)` | Si apunta a un ID del inventario, hoy cae en `BLOCK` (`UNCLASSIFIED_OR_NEW_DEPENDENCY`): o se retiene el destino o se retira la fila nueva (ver §5) |

El motor de horas especiales **ya no lee columnas del catálogo para el pasado**:
`loadEngineScopeHistory` (`laborHistory.service.ts:212-222`) carga sólo las vigencias de las siete tablas,
sin fallback a `Employee.sectorId` ni a `EmployeeCompany`. Por eso M2 puede retirar la columna
`Employee.sectorId` sin romper la resolución histórica: la dimensión "sector anterior" se resuelve
desde `EmployeeLegacySectorPeriod`.

### 3.3 FKs RESTRICT que impiden limpiar estructura o puestos

| FK | Bloquea el borrado de | ¿Puede sobrevivir a M2? |
|---|---|---|
| `EmployeePositionPeriod.positionId` | Position | **Sí**: un puesto sin `sectorId` (columna dropeada) y sin alcances queda "pendiente de recarga" y es válido |
| `PositionOrgScopePeriod.positionId` | Position | Sí (igual que arriba) |
| `DoubleHourRule.positionId/companyId/sectorId` | Position / Company / Sector | Company y Sector **sólo** si sobreviven con su forma nueva |
| `EmployeeLegacySectorPeriod.sectorId` | Sector | **No**, salvo que el sector reciba `businessUnitId` (NOT NULL en M2) |
| `PositionOrgScopePeriodNode.{companyId,businessUnitId,sectorId,area,areaSector}` | Company / BU / Sector / Area | Company y BU sí; **Sector y Area no** (necesitan su padre nuevo) |
| `EmployeeEmployerPeriodCompany.companyId` | Company | Sí si C1; en C2 bloquea el borrado de la empresa |
| `PositionOrgScope.*` (modelo nuevo, todas Restrict) | Company / BU / Sector / Area | Igual que arriba (Company/BU sí, Sector/Area no) |
| `EmployeeWorkLocation.zoneId`, `EmployeeWorkLocationEstablishment.establishmentId` | Zone / Establishment | Zone sí; Establishment sólo con `zoneId` |
| `Area.sectorId`, `Sector.businessUnitId`, `Establishment.zoneId` (M1, modelo nuevo) | Sector / BU / Establishment | Bloquean cuando un nodo **nuevo** apunta a un nodo del inventario (p. ej. un `Area` de QA con `sectorId` a un sector viejo): clasificar como fila nueva (retirar) o retener el destino |

**Tratamiento propuesto (preserva la evidencia):**

- **HT-1 — Precondición de limpieza:** antes de congelar el inventario, listar todas las filas de las
  siete tablas de historia (y de `PositionOrgScope`) que apunten a IDs candidatos. En `development`
  antes de B3 el resultado debe ser **0** (la historia se crea con el código nuevo y la ventana es sin
  escrituras). Un resultado distinto aborta.
- **HT-2 — Retención con clausura:** si hay historia que referencia un registro, se excluye del
  inventario junto con sus ancestros (`retainedClosure`, ya implementado). **Pero la retención no es
  un final:** un `Sector`/`Area`/`Establishment` retenido queda con forma vieja y M2 lo rechazaría
  (NOT NULL del padre nuevo). Para esos casos hace falta una decisión explícita (A8-1, §9):
  reubicar el nodo retenido en el árbol nuevo como INACTIVO, auditado, antes de M2 — nunca
  re-apuntar la historia ni borrarla.
- **HT-3 — Puestos retenidos:** se conserva la fila, se vacía `Position.sectorId` y no se le exige
  alcance; sigue como "Pendiente de recarga" hasta que la recarga manual lo reemplace. La guarda de M2
  debe admitirlos (sólo prohíbe `Position.sectorId NOT NULL`, no puestos sin alcance).
- **HT-4 — Empresas (sólo C2):** la historia de empleadora (`EmployeeEmployerPeriodCompany`) y una
  `DoubleHourRule` hacia la empresa obligan a R1/R3 (o a conservar la empresa): nunca NULL y nunca
  borrado de historia.
- **HT-5 — Divergencia de la copia:** en la copia de ensayo existen filas de QA que referencian
  registros del inventario (`PositionOrgScope` → UN antigua; 4 filas de historia de empleadora →
  empresas en C2). No son evidencia real: se resuelven excluyendo los IDs QA del inventario congelado
  o reteniendo sus destinos, y se documenta que en `development` no existirán.

## 4. Cambios propuestos para M2 (diseño; aún no implementar)

### 4.1 DDL de la migración (archivo único, en `reorg-r2`)

1. **Guarda previa** (aborta antes de cualquier DDL; deja la migración `failed` hasta `migrate resolve`):
   - `SELECT` que falla si existe algún valor viejo: `Sector.areaId IS NOT NULL`, `Area.establishmentId IS NOT NULL`,
     `Establishment.companyId IS NOT NULL`, `Establishment.businessUnitId IS NOT NULL`,
     `Position.sectorId IS NOT NULL`, `Employee.sectorId IS NOT NULL`, `User.sectorId IS NOT NULL`,
     `ClockDevice.sectorId IS NOT NULL`;
   - y si existe algún registro con forma vieja que no puede hacerse NOT NULL:
     `Sector.businessUnitId IS NULL`, `Area.sectorId IS NULL`, `Establishment.zoneId IS NULL`
     (aquí es donde fallaría un nodo retenido por historia sin resolver — §3.3 HT-2);
   - el alcance exacto depende de D-1 y D-14 (A8-2, §9): `User.companyId` sólo se exige no nulo si C1
     conserva empresas; `Establishment.companyId` y `User.sectorId` siempre deben estar vacíos antes del
     DROP, porque M2 los elimina en ambos modos (D-13 ya movió la unicidad de establecimiento a `(zoneId, code)`)
     y la guarda existe para que esos datos no se descarten en silencio.
2. **DROP** de las columnas e índices/únicos de §2.1.
3. **NOT NULL** en `Sector.businessUnitId`, `Area.sectorId`, `Establishment.zoneId`.
4. **Nuevo `@@unique([zoneId, code])`** en `Establishment` (D-13 ratificada) y eliminación del
   `@@unique([companyId, code])`.
5. Sincronización de `schema.prisma` (relaciones, selects y comentarios), `prisma validate`,
   regeneración del cliente.
6. **No toca:** `DoubleHourRule.*`, tablas de historia, `EmployeeCompany`, `CostCenter*`,
   `BusinessUnit.companyId`, legajos, horas, cierres, documentos, historiales.
7. Reversión: sólo restaurando el respaldo previo (ADR §7).

### 4.2 Cambios de código exigidos por A8 (retiro de consumidores)

- **Backend:** retirar cadenas legacy de `employees.repository.ts` y `positions.repository.ts`;
  `buildWhere`/`buildOrgChartWhere`/`buildOptionsWhere` sin `sectorId`; eliminar
  `assertLegacySectorUnchanged` y la validación derivada de la cadena; quitar `sectorId` de los schemas
  de listado/opciones/alta; dashboard sin payload `sector` ni `companyId` en la clave (D-14);
  `pending.repository.ts` sin `employee.sectorId`; filtros de convocatorias/regimenes/conceptos sin
  `sectorId` (o pasados sólo a "Sector anterior" mientras exista); **retirar la lectura de
  `ClockDevice.sectorId`** (`clockDevices.repository.ts:53`, `clockDeviceAuthentication.ts`, `express.d.ts:24`)
  y actualizar `clockDevice.schema.test.ts:84`.
- **Motor:** conservar `DoubleHourRule.sectorId` (ADR §6); la rama `LEGACY_SECTOR` del motor y
  `EmployeeLegacySectorPeriod` pueden conservarse como camino de resolución histórica — decidir si se
  retira código muerto o se mantiene (A8-3, §9).
- **Frontend:** filtros y selects "Sector anterior" (§2.4), campos `derived*` de puestos, etiquetas de
  padres legacy de Organización, columna "Sector anterior" y filtro muerto de Nivel 2 del dashboard,
  `cacheKey.ts` sin `sectorId`, datos demo/fixtures, etiquetas de error de `apiClient`.
- **Seed:** quitar los `sectorId` de `seed.ts` (93, 99, 349, 366) y el workaround de unicidad (76-88).
- **Contratos/docs:** actualizar §2.6 en el mismo cambio.
- **Tests:** adaptar §2.7; los que afirman `SET NULL` o la cadena legacy pasan a afirmar su ausencia.

### 4.3 Qué no cambia en A8

- Nada de notificaciones (postergadas por instrucción expresa).
- Motor de horas especiales, cierres protegidos y locks de §18.1 (salvo retiro de lecturas legacy).
- Permisos (`employeeAccessWhere` por responsable de carga) y `EmployeeAssignment`.

## 5. Bloqueos concretos hoy (reporte de solo lectura 2026-10-08, copia)

El plan de limpieza devuelve `blocking: true` en ambos modos:

| Modo | Código | Detalle |
|---|---|---|
| C1 y C2 | `UNCLASSIFIED_OR_NEW_DEPENDENCY` | 1 fila de `PositionOrgScope.businessUnitId` apunta a una UN del inventario (QA de A5) |
| C2 | `UNCLASSIFIED_OR_NEW_DEPENDENCY` | 2 filas de `PositionOrgScope.companyId` → empresas del inventario |
| C2 | `RULE_WITHOUT_DECISION` | Regla "Domingos" (`c96b0fe1-84bd-43a8-8dac-d7f70fe206f6`) referencia `companyId` sin decisión R1/R2/R3 |
| C2 | `OUTSIDE_RECORD_DEPENDS_ON_INVENTORY` | 1 `BusinessUnit` nuevo depende de una empresa del inventario |
| C2 | `HISTORY_REFERENCES_INVENTORY` | 4 filas de `EmployeeEmployerPeriodCompany` apuntan a empresas del inventario (§3.3 HT-5) |

Otros bloqueos:

- **D-0** — sin `NEON_API_KEY`/project/branch ids, `org-reorg-cleanup` y `org-reorg-restore` no corren
  ni en dry-run (identidad NO VERIFICADA).
- **D-1** — modo C1/C2 sin elegir: el inventario, la guarda de M2 y el tratamiento de "Domingos" dependen de él.
- **D-3** — rastro de la limpieza (sólo `AuditLog` vs historial visible) define la salida del script.
- **D-6** — sin variantes de puestos definidas, la recarga de puestos (B4) no puede cerrarse.
- **D-15 / fichador** — las lecturas de `ClockDevice.sectorId` deben retirarse **antes** de M2.
- **5 fechas sin evidencia** — §6.
- **Índices** — al dropear `Employee([status, sectorId])` y `([sectorId])`, verificar según
  `docs/PERFORMANCE_STANDARDS.md` que los planos de listados sigan cubiertos por `@@index([status])` (817).

## 6. Las cinco fechas históricas sin evidencia

Fuente: `d5-coverage-pre-qa-2026-10-08.json` y comparación `d5-engine-before-vs-after-qa.summary.json`
(78 pares fecha-legajo: 73 idénticos, 5 en `MISSING`, 0 cambios de valor).

| # | Legajo | Fecha | Dimensión faltante | Regla |
|---|---|---|---|---|
| 1 | 16 | 2026-07-05* | `EMPLOYER` (empresa empleadora) | "Domingos" |
| 2 | 13 | 2026-08-02* | `EMPLOYER` | "Domingos" |
| 3 | 02 | 2026-08-09* | `EMPLOYER` | "Domingos" |
| 4 | 03 | 2026-08-09* | `EMPLOYER` | "Domingos" |
| 5 | 03 | 2026-08-16* | `EMPLOYER` | "Domingos" |

\* domingos: fechas en las que la regla semanal "Domingos" coincide y, al no haber vigencia de empleadora
registrada, el motor responde `409 SPECIAL_HOUR_SCOPE_HISTORY_MISSING` en lugar de inventar el pasado.
(Sin cobertura están los 36 legajos de la copia; éstos cinco son los únicos pares donde una dimensión
restringida decide.)

- **Impacto registrado (A3):** 5 `TimeEntry` (40 h), 2 desgloses (360 min) y **un cierre `ENVIADO`**.
  Las filas conservan su multiplicador x2 almacenado: el `MISSING` afecta a operaciones futuras sobre
  esas fechas, no a lo ya escrito.
- **Qué falta:** una `EmployeeEmployerPeriod` (+ `EmployeeEmployerPeriodCompany`) con vigencia que
  cubra la fecha, para el legajo indicado. Nada más: la dimensión es sólo la empleadora.
- **Operaciones bloqueadas para esos 5 pares:** carga o edición de horas, alta/edición de desgloses,
  recálculo de desgloses automáticos, reinterpretación por cambio de regla o convocatoria a feriado,
  `reconcile-special-hours --apply`, reconstrucción de snapshot del cierre afectado y catch-ups del
  fichador que resuelvan esa fecha. El cierre `ENVIADO` está además protegido por §18.1.
- **Cómo se resuelven (sólo con evidencia):** documentación real de la empleadora en esa fecha
  (recibos de sueldo, planillas, contratos, exportación Finnegans). Con ella se registra la vigencia
  con fecha y motivo vía el flujo existente de Datos Laborales (controles de fecha/motivo de A7),
  segmentando si hubo cambios de empleadora. Después, `coverage` debe bajar a 0 y un dry-run del
  motor debe confirmar que el multiplicador almacenado no cambia.
- **Prohibido:** inicializar masivamente los 32 legajos ni adivinar vigencias (ADR §19.3, §19.5).

## 7. Precondiciones y orden del ensayo (actualizado a la luz de D-5)

D-5 está ratificada e implementada (§18-§19): el motor resuelve por fecha con historia y nunca con
valores actuales. Esto **cambia el plan anterior de §12.4**: la verificación de equivalencia ya no puede
asumir motor "por valores actuales", y aparecen dos compuertas nuevas (historia y cobertura).

### 7.1 Precondiciones (todas antes de escribir)

1. Identidad: copia aislada, host comprobado antes de cada escritura; `development` y producción intactos (D-12).
2. Identidad administrativa Neon verificada (D-0) para limpieza/restauración, incluso en dry-run.
3. Respaldo doble (rama Neon + `pg_dump`) con SHA-256 y **restauración probada** (B0).
4. `migrate status` en solo lectura muestra exactamente las aditivas esperadas de `reorg-r1`
   (`org_location_expand` + `labor_history_periods`) y **ninguna M2**.
5. Inventario congelado + clasificación de dependencias desde el catálogo (fail closed): 0 FKs sin clasificar.
6. Historia: 0 filas de las siete tablas apuntando a IDs a borrar (HT-1); si no, decisión explícita A8-1.
7. `decisions.json` completo: modo C1/C2 (D-1) y un tratamiento R1/R2/R3 por regla afectada; D-3 decidido.
8. Backend detenido, ventana sin escrituras, actor humano (`--actor-user-id` RRHH activo).
9. Línea base de reconciliación (`reconcile-special-hours` dry-run) corrida con el motor histórico,
   registrando los 5 `MISSING` preexistentes como estado esperado.
10. Etapa de fichador/D-15 cerrada: ninguna lectura de `ClockDevice.sectorId` en ejecución.
11. Copia de ensayo: filas QA (§3.3 HT-5) clasificadas antes de congelar el inventario.

### 7.2 Orden del ensayo

1. **Respaldo** doble + restauración probada (B0).
2. **Migraciones aditivas** (`reorg-r1`: M1 + historia) → manifiesto previo/posterior → drift vacío.
3. **Inventario congelado** + clasificación de dependencias (incl. historia, `PositionOrgScope`, reglas).
4. **Tratamiento de dependencias:** decisiones R1/R2/R3 aplicadas (destinos nuevos cargados antes si R1),
   retenciones resueltas (HT-2/HT-3), `decisions.json` firmado.
5. **Limpieza autorizada:** dry-run → revisión → `--apply --backup` → **V1** (§5.4 del ADR) →
   prueba de restauración → limpieza final. Dentro de la misma transacción: equivalencia del motor
   **histórico** (0 cambios; los 5 `MISSING` siguen `MISSING`).
6. **M2** (`reorg-r2`): `migrate status` → `deploy` → guarda SQL pasa → columnas dropeadas,
   NOT NULL y `(zoneId, code)` aplicados.
7. **Recarga manual:** Organización → Ubicaciones → Puestos → Legajos (con sus ubicaciones de trabajo),
   y apertura de historia laboral **sólo con evidencia**.
8. **Verificaciones:** V2 por ID y contenido; reporte de cobertura de historia
   (`unresolvedEmployeeDates` ≤ 5, tendiendo a 0 a medida que se cargue evidencia);
   motor en dry-run sin cambios de valor; `migrate status` al día; typecheck/test/build verdes en `reorg-r2`;
   QA visual de las pantallas afectadas contra `docs/reference-ui/`; contratos de §2.6 actualizados.

### 7.3 Qué cambió respecto del plan de §12.4

- Paso 3 (inventario) ahora incluye historia y `PositionOrgScope` como clasificación obligatoria.
- Paso 5 exige motor **histórico** y acepta sólo los 5 `MISSING` preexistentes (no "0 diferencias a secas").
- Paso 6 (M2) queda después de comprobar que ningún registro con forma vieja sobrevive (HT-2/HT-3).
- Paso 7 agrega apertura de historia con evidencia; sin ella, la recarga deja fechas bloqueadas como §6.
- La restauración (`org-reorg-restore`) sigue siendo válida **sólo antes de M2** (`LEGACY_COLUMNS`).

## 8. Separación del trabajo

### 8.1 Preparación que puede hacerse ahora (sin ejecución destructiva)

- Este documento y su puntero en el ADR §11.
- Inventario de dependencias congelado en §2 (backend, frontend, scripts, seed, fixtures, contratos, tests).
- Diseño de la guarda de M2 (§4.1) y de los tratamientos HT-1…HT-5 (§3.3), a ratificar.
- Lista de cambios de código por archivo (§4.2) como plan de A8.
- Corridas de solo lectura en la copia (inventario/coverage/manifest) — ya realizadas el 2026-10-08.
- Actualizar `decisions.json` cuando se decidan D-1/D-3.

### 8.2 Ejecución que depende de decisiones pendientes

| Decisión | Qué bloquea |
|---|---|
| **D-1** (C1/C2) | modo del inventario, contenido de la guarda de M2, `EmployeeCompany`/`CostCenterCompany`, tratamiento R1/R3 de "Domingos", borrado de empresas |
| **D-2** (zona completa) | ampliación de ubicaciones y su recarga (no el DDL de M2) |
| **D-3** (rastro visible vs `AuditLog`) | salida del script de limpieza; si se elige historial visible, ampliarlo antes de B1 |
| **D-6** (variantes de puestos por alcance) | redacción de la recarga de puestos y el cierre de B4 |
| **D-0** (Neon, §8.3) | limpieza/restauración, incluso dry-run |

### 8.3 Comprobación administrativa de identidad Neon pendiente (D-0)

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
- adelantar la limpieza a este bloque: aquí sólo se diagnostica y diseña.

Nota de ingeniería: la autorización habilita la *eliminación explícita* de esas filas de configuración
en el orden del plan; no convierte a `CASCADE` en atajo de la transacción (la limpieza sigue borrando
de forma explícita y ordenada, con manifiesto V1).

## 10. Decisiones pendientes con ejemplos breves

| Id | Decisión | Ejemplo |
|---|---|---|
| D-1 | C1 o C2 | C1 conserva LOSOD y "Domingos" sin cambios; C2 obliga a R1 (recargar empresa antes) o R2 (lista de 32 legajos) |
| D-2 | Zona completa | ¿"Todos los establecimientos de Zona Norte" se marca explícitamente o una lista vacía lo significa? (Hoy: lista vacía se rechaza) |
| D-3 | Rastro de la limpieza | Sólo `AuditLog` (script actual) vs filas en el historial visible del legajo |
| D-6 | Puestos por alcance | ¿Un "Gerente de O'Dwyer" y uno "de Tropa" son dos puestos o uno con dos alcances? (Hoy: una función con alcance distinto = puesto distinto) |
| **A8-1** | Nodo retenido por historia con forma vieja | Si `EmployeeLegacySectorPeriod` apunta a un Sector del inventario: ¿reubicarlo como INACTIVO auditado antes de M2, o excluirlo y postergar M2? (Borrar historia está prohibido) |
| **A8-2** | Alcance exacto de la guarda de M2 | ¿La guarda exige `User.companyId IS NOT NULL` bajo C1? ¿Admite puestos sin alcance? |
| **A8-3** | Destino del código `LEGACY_SECTOR` | Tras M2 nadie puede tener sector anterior: ¿se retira `sectorIsLegacy` del motor y el selector "Sector anterior" de la UI, o se conservan para leer historia? |
| **A8-4** | Índices tras el DROP | Confirmar planos de listados con `@@index([status])` (Employee 817) antes de eliminar `[status, sectorId]` y `[sectorId]` |

## 11. Criterio de cierre de este bloque

- [x] Inventario de dependencias completo (§2) con backend, frontend, scripts, seed, fixtures, contratos y tests.
- [x] Tratamiento de tablas históricas y FKs RESTRICT definido sin borrar evidencia (§3).
- [x] Precondiciones y orden del ensayo revisados a la luz de D-5 (§7).
- [x] Cinco fechas sin evidencia documentadas con sus bloqueos y su resolución (§6).
- [x] Trabajo separado en ahora / dependiente de decisiones / Neon (§8).
- [x] Autorización de limpieza registrada con sus límites (§9).
- [ ] A8 en revisión (este documento + puntero del ADR).
- Siguiente paso tras la revisión: codificar M2 y el retiro de consumidores en `reorg-r2`, probarlos en la
  copia aislada, y recién entonces ejecutar el ensayo completo de §7.
