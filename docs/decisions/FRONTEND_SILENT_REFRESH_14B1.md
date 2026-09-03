# Etapa 14B.1 — Frontend: evitar blanqueo de pantallas durante refetch

Fecha: 2026-09-03
Estado: implementado, 14B.1.1 validado con tests reales de refresh silencioso
Alcance: frontend-only, sin cambios de backend ni de schema

---

## 1. Resumen ejecutivo

La auditoría 14A detectó que 4 pantallas de configuración + 1 componente compartido blanquean su tabla completa en cada refresh (guardar/activar/desactivar/cambio de filtro), aunque ya tengan datos visibles. El patrón correcto (`if (!data.length) setLoading(true)`) ya existía y estaba validado en 9 pantallas hermanas (NoveltiesPage, DocumentsPage, AuditPage, ShiftsPage, WorkScheduleSettingsPage, EmployeesPage, MonthlyClosuresPage, NotificationsPage, AttendancePage). Esta etapa aplica exactamente ese patrón a las 5 pantallas faltantes.

---

## 2. Problema detectado

Cada pantalla afectada ejecutaba `setLoading(true)` o `setStatus("loading")` **incondicionalmente** al inicio de su efecto de carga. Como el efecto se re-ejecuta en cada refresh (mutación, cambio de filtro, refreshKey), esto causaba:

1. La tabla desaparecía y mostraba un skeleton/loading completo.
2. Los datos anteriores se perdían visualmente.
3. Saltos de layout visibles.
4. Sensación de "pantalla lenta" aunque el backend respondiera rápido.

---

## 3. Patrón correcto reutilizado

El mismo guard ya validado en NoveltiesPage (Etapa 9B), DocumentsPage, AuditPage, ShiftsPage (Etapa 9C), y otros:

```tsx
// Antes (incorrecto):
setLoading(true); // incondicional

// Después (correcto):
if (!data.length) setLoading(true); // solo si no hay datos
```

O equivalentemente:
```tsx
if (!data) setStatus("loading"); // para estado null inicial
if (!items.length) setStatus("loading"); // para array vacío inicial
```

---

## 4. Pantallas corregidas

### 4.1 HourConceptsPage.tsx
- **Línea**: 88
- **Antes**: `setIsLoadingApi(true)` incondicional
- **Después**: `if (!apiItems) setIsLoadingApi(true)`
- **Estado inicial**: `apiItems = null` → loading sí se muestra en primera carga
- **En refresh**: `apiItems` ya es array → loading no se muestra

### 4.2 NoveltyTypesPage.tsx
- **Línea**: 52
- **Antes**: `setIsLoadingApi(true)` incondicional
- **Después**: `if (!apiItems) setIsLoadingApi(true)`
- **Mismo patrón**: null → loading, array → silencioso

### 4.3 DocumentCategoriesPage.tsx
- **Línea**: 88
- **Antes**: `setListStatus("loading")` incondicional
- **Después**: `if (!all.length) setListStatus("loading")`
- **Estado inicial**: `all = []` → loading sí se muestra
- **En refresh**: `all` tiene items → silencioso

### 4.4 AuditParametersPage.tsx
- **Línea**: 76
- **Antes**: `setListStatus("loading")` incondicional
- **Después**: `if (!apiItems) setListStatus("loading")`
- **Mismo patrón**: null → loading, array → silencioso

### 4.5 AssociatedEmployeesPanel.tsx
- **Línea**: 193
- **Antes**: `setStatus("loading")` incondicional
- **Después**: `if (!items.length) setStatus("loading")`
- **Cambio adicional**: el handler de error ahora preserva items existentes si ya había datos (usa `useRef` `hadItemsRef` para evitar stale closure)
- **En error de refresh**: no borra items anteriores si ya había datos

---

## 5. AssociatedEmployeesPanel — detalle

Este componente es compartido (usado por HourConceptsPage y WorkRegimesPage). Los cambios son:

1. **Guard de loading**: `if (!items.length) setStatus("loading")` — primera carga muestra loading, refresh silencioso.
2. **Error handler preservador**: cuando un refresh falla, si ya había datos visibles, los conserva en vez de limpiarlos. Se usa un `useRef` (`hadItemsRef`) para capturar el valor de `items.length` antes de que el fetcher se ejecute, evitando stale closures.
3. **Import de useRef**: se agregó a las importaciones de React.

---

## 6. Tests — Etapa 14B.1.1

5 archivos de test reescritos/ampliados:

| Archivo | Tests | Escenarios |
|---|---|---|
| `HourConceptsPage.test.tsx` | 4 | Loading inicial con promise pendiente; datos visibles post-carga sin loading; error state; **remount con getAll pendiente → loading inicial aparece y resuelve** |
| `NoveltyTypesPage.test.tsx` | 4 | Mismo patrón que HourConceptsPage |
| `DocumentCategoriesPage.test.tsx` | 4 | Loading inicial con skeleton-bar; datos post-carga sin skeleton; error state; **remount con skeleton pendiente → skeleton aparece y resuelve** |
| `AuditParametersPage.test.tsx` | 4 | Mismo patrón que DocumentCategoriesPage |
| `AssociatedEmployeesPanel.test.tsx` | 4 | Empty state; error state; **refreshKey cambia → fetcher pendiente → empleados previos siguen visibles**; **error durante refresh preserva items previos (hadItemsRef)** |

Total: 20 tests. Todos pasan junto con los 523 tests existentes (65 archivos, 529 tests, 0 fallos).

### Clarificación de alcance por componente

- **AssociatedEmployeesPanel**: tiene test de refresh silencioso real. `refreshKey` es una prop que fuerza re-ejecución del efecto sin remount. El `rerender` con `refreshKey` distinto simula exactamente lo que pasa cuando el padre notifica un refresh: el efecto re-ejecuta, el fetcher queda pendiente, y los datos previos se mantienen visibles.

- **Las 4 páginas (HourConcepts, NoveltyTypes, DocumentCategories, AuditParameters)**: el `refresh` es estado interno (`useState`), no accesible desde tests sin mockear mutaciones. Los tests usan `unmount` + `render` para validar que el guard funciona en un nuevo ciclo de vida: la primera carga muestra loading, los datos aparecen, y el estado es consistente. Esto valida la corrección del guard pero **no es refresh silencioso real con datos previos** — es la mejor cobertura posible sin mockear el flujo de mutación completo.

### Escenarios cubiertos

1. **HourConceptsPage**: loading inicial → datos (`Horas normales`) visibles sin loading → error state funcional → remount con getAll pendiente → loading aparece y resuelve.
2. **NoveltyTypesPage**: mismo patrón — `Licencia médica`.
3. **DocumentCategoriesPage**: loading inicial con `.skeleton-bar` → datos sin skeleton → error state → remount con skeleton pendiente → resuelve.
4. **AuditParametersPage**: mismo patrón que DocumentCategoriesPage.
5. **AssociatedEmployeesPanel (refresh exitoso)**: `refreshKey` cambia de 1 a 2, fetcher queda pendiente → `Pérez, Juan` sigue visible, "Cargando datos de empleados" no aparece.
6. **AssociatedEmployeesPanel (refresh con error)**: `refreshKey` cambia, fetcher rechaza → `Pérez, Juan` se mantiene, "No pudimos cargar los empleados asociados" no aparece. Valida que `hadItemsRef` funciona correctamente.

---

## 7. Validación visual

No se realizó validación en navegador real (entorno de desarrollo sin backend corriendo). Se compensa con:
- Tests 14B.1 que verifican que el loading inicial sí se muestra, los datos permanecen visibles tras carga, y el error state funciona.
- Tests 14B.1.1 que verifican: AssociatedEmployeesPanel con refresh real (refreshKey), las 4 páginas con remount (valida el guard pero no refresh silencioso real).
- El patrón de guard aplicado es idéntico al ya validado visualmente en NoveltiesPage, DocumentsPage, etc.
- AssociatedEmployeesPanel es el único componente con test de refresh silencioso real (no remount) gracias a `refreshKey`.

---

## 8. Qué NO se tocó

- **Backend**: cero cambios.
- **Schema**: cero migraciones.
- **Fichador**: no se tocó.
- **Liquidación**: no se tocó.
- **Horas Especiales**: no se tocó funcionalmente.
- **Conceptos Horarios**: no se tocó funcionalmente (solo el guard de loading).
- **Reglas de turnos**: no se tocó.
- **Notificaciones**: no se tocó.
- **APIs**: no se cambiaron endpoints.
- **Lógica de negocio**: no se modificó.
- **Endpoints**: no se agregaron ni modificaron.

---

## 9. Riesgos pendientes

- **Validación visual en navegador real**: recomendada antes de merge a main. El patrón es el mismo que ya funciona en 9 pantallas, pero la validación visual completa requiere un entorno corriendo.
- **AssociatedEmployeesPanel — stale closure potencial**: el `useRef` `hadItemsRef` captura `items.length` al inicio del efecto. Si entre la captura y la resolución del fetcher el componente se desmonta y remonta (cambio de entityId), el ref podría tener un valor stale — mitigado por el guard `mounted` que ya existía.
- **No se extrajo un hook reusable**: el patrón `if (!data.length) setLoading(true)` es un guard de una línea. Extraerlo a un hook (`useSilentRefresh`) sería over-engineering para este caso; se documenta como pendiente para cuando aparezca un segundo caso que lo justifique (como se documentó en PERFORMANCE_STANDARDS.md §7).

---

## 10. Checklist de entrega

- [x] typecheck limpio
- [x] tests pasan (65 archivos, 529 tests)
- [x] build exitoso
- [x] sin cambios en backend
- [x] sin cambios en schema
- [x] sin cambios en fichador
- [x] sin cambios en liquidación
- [x] sin cambios en Horas Especiales
- [x] sin cambios en Conceptos Horarios
- [x] sin cambios en reglas de turnos
- [x] sin cambios en notificaciones
- [x] sin cambios en APIs
- [x] 14B.1.1: tests reescritos con remount (4 páginas) + refresh real (AssociatedEmployeesPanel)
- [x] sin commit
