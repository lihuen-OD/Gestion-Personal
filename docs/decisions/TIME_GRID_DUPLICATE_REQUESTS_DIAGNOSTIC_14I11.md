# Etapa 14I.11 — Diagnóstico y fix quirúrgico del duplicado x3 de `GET /employees/:id/time-grid`

## 1. Resumen ejecutivo

El duplicado x3 de `GET /employees/:id/time-grid` (nombrado por 14G.9, listado como P1 sin cerrar por 14I.1/14I.8/14I.10) **seguía existiendo después de 14I.9** — confirmado empíricamente con el journey de Gestión Horaria antes de tocar nada: `GET /api/employees/:id/time-grid` x3 y `GET /api/novelties` x2 en la acción "Abrir edición de horas de un empleado". La causa raíz **no es el bug de `includeDetails`** (ya corregido en 14I.9) sino un segundo bug, independiente, en `EmployeeHoursPage.tsx`: el efecto de "re-sincronización silenciosa post-guardado" usaba un guard `useRef(false)` que se pone en `true` en su primera ejecución para saltarse el mount — pero bajo React 18 `StrictMode` (activo en desarrollo, donde corren los journeys), React vuelve a ejecutar ese mismo efecto una segunda vez con el mismo `refresh` inicial; como el ref ya había quedado en `true` tras la primera pasada, la segunda pasada ya no entraba a la rama de skip y disparaba un fetch real de más.

**Se aplicó un fix mínimo y verificado**: reemplazar el guard "primera ejecución" por una comparación contra el último `refresh` efectivamente sincronizado — robusto a cualquier cantidad de invocaciones del efecto con el mismo valor (StrictMode incluido), sin cambiar el comportamiento observable para el caso real (guardar horas). **Confirmado antes/después con el journey real**: `GET /api/employees/:id/time-grid` x3 → x2, `GET /api/novelties` x2 → ya no aparece como duplicado para esa acción. El x2 remanente es el double-invoke propio de `StrictMode` sobre el efecto de carga inicial (Effect A) — **sin costo en producción** (StrictMode sólo duplica invocaciones en desarrollo; en producción, un usuario real siempre generó 1 sola llamada desde ese efecto), documentado y explícitamente no tocado.

`timeGridCatalogCache` se revisó de nuevo: con el fix de `includeDetails` de 14I.9 ya aplicado, `EmployeeHoursPage.tsx` (único caller real) ahora efectivamente manda `includeDetails=false` de verdad — lo que significa que `getTimeGridCatalogs()` **ya no se ejecuta nunca** en el flujo real de la aplicación (antes del fix de 14I.9 se ejecutaba siempre, aunque su resultado se descartaba; ahora ni siquiera se ejecuta). Esto refuerza, con más evidencia todavía, la conclusión de 14I.8: no hay ningún bug funcional real que justifique tocarla. **No se tocó.**

## 2. Contexto 14I.8/14I.9

- **14I.8** (`6810a7b`) diagnosticó `timeGridCatalogCache` (sin invalidación, TTL 120s) y descubrió, como hallazgo colateral, que `includeDetails: z.coerce.boolean().default(true)` coercionaba cualquier string (incluido `"false"`) a `true` — el bug real y activo de esa etapa.
- **14I.9** (`9299440`) corrigió ese bug puntual con un `z.preprocess` mínimo en `employees.schemas.ts`. Documentó explícitamente como pendiente, sin tocar: el duplicado StrictMode x3 (mismo caller, `EmployeeHoursPage.tsx`) y la invalidación de `timeGridCatalogCache`.
- **14I.10** (`266169e`) no tocó nada de esto — se enfocó en la doble capa de cache de catálogos (`hour-concepts`/`novelty-types`/`document-categories`/`salary-categories`), un tema no relacionado.
- Esta etapa retoma exactamente los 2 pendientes que 14I.9 dejó nombrados, en el orden de prioridad pedido: primero el duplicado x3, después `timeGridCatalogCache` sólo si hay evidencia fuerte.

## 3. Endpoint/caller

- **Ruta**: `GET /employees/:id/time-grid` (sin cambios de contrato en esta etapa).
- **Caller frontend real**: `employeeApiService.getTimeGrid(id, period, options)` (`frontend/src/services/api/employeeApiService.ts:718-733`), consumido exclusivamente por `frontend/src/pages/EmployeeHoursPage.tsx`, en **2 lugares**:
  1. **Effect A** (carga inicial, `useEffect(..., [id, period])`, líneas 144-190): dispara al entrar a la pantalla (navegación `/horas/:id`) y al cambiar de período. Muestra el placeholder "Preparando información".
  2. **Effect B** (re-sincronización silenciosa, `useEffect(..., [refresh])`, líneas 200-227, Etapa 6L.4): dispara **sólo** cuando `refresh` cambia — y `refresh` sólo cambia tras un guardado real de hora normal o desglose manual (`setRefresh((v) => v+1)`, 2 call sites). No bloquea la pantalla, no muestra placeholder.
- Ninguno de los 2 usa `cachedData`/dedupe — ambos llaman a `apiRequest` directo vía `employeeApiService.getTimeGrid`.
- Journey donde aparece: **`perf:journey:workforce`** (zona "D. Carga de horas"), **no** `perf:journey:employees` (ese journey cubre Legajos, una pantalla distinta que nunca navega a `/horas/:id`) — confirmado leyendo `frontend/e2e/support/workforceManagementJourney.ts:348-487`. Se corrieron ambos de todas formas por instrucción explícita del pedido; sólo `workforce` mide este endpoint.

## 4. Estado de `includeDetails` después de 14I.9

Confirmado correcto — `EmployeeHoursPage.tsx` manda `includeDetails: false` en sus 2 llamadas (línea 151 y 208), y desde 14I.9 el backend lo parsea de verdad como `false` (test de regresión ya existente: `employees.schemas.test.ts`, 7 tests, confirmando `"false"` → `false`). **El duplicado x3 de esta etapa NO estaba inflado por el bug de `includeDetails`** — son 2 causas independientes, ambas viven en el mismo componente pero no se relacionan entre sí: una es un bug de parseo de query param (backend, cerrado en 14I.9), la otra es un bug de guard de efecto (frontend, cerrado en esta etapa).

## 5. Cantidad real de requests antes/después

Medido con el journey real (`npm run perf:journey:workforce`, backend+frontend corriendo localmente, sin escrituras), acción "Abrir edición de horas de un empleado (navega a /horas/:id)":

| Endpoint | Antes (journey previo, ya registrado) | Después (esta etapa, medido de nuevo) |
|---|---|---|
| `GET /api/employees/:id/time-grid` | **x3** | **x2** |
| `GET /api/novelties` (mismo `fetchPeriodNovelties`) | x2 | ya no aparece como duplicado para esta acción |

El x2 remanente de `time-grid` es el double-invoke de `StrictMode` sobre el Effect A (carga inicial) — **no se corrigió a propósito**: es un artefacto exclusivo de desarrollo (`<StrictMode>` en `main.tsx`), sin ningún costo para un usuario real en producción (React sólo duplica la invocación de efectos en modo desarrollo, nunca en un build de producción). Corregirlo requeriría envolver `getTimeGrid` en un mecanismo de dedupe (p. ej. `cachedData`), lo cual se evaluó y se descartó — ver §6.

## 6. Causa raíz del duplicado

**Confirmada por lectura de código y reproducida con un test unitario determinístico** (no sólo inferida del journey):

```tsx
// ANTES (bug):
const skippedFirstRefresh = useRef(false);
useEffect(() => {
  if (!skippedFirstRefresh.current) {
    skippedFirstRefresh.current = true;
    return; // "me salto la primera corrida"
  }
  // ... fetch real ...
}, [refresh]);
```

Bajo `StrictMode` (dev), React ejecuta este efecto dos veces en el mismo mount (mount → cleanup → mount, simulado, sobre la MISMA instancia de componente — el `ref` NO se resetea entre esas 2 pasadas). En la primera pasada, `skippedFirstRefresh.current` es `false` → se pone en `true` y se sale sin fetch. En la **segunda** pasada (el "remount" sintético de StrictMode), `skippedFirstRefresh.current` ya es `true` → la condición de skip ya no se cumple → el efecto **sí** dispara un fetch real, aunque `refresh` no cambió realmente. Sumado a que el Effect A de carga inicial también se duplica por StrictMode (2 fetches reales, sin ningún guard que lo module), el total es 2 (Effect A) + 1 (Effect B, disparo espurio) = **3**.

**Fix aplicado** (`frontend/src/pages/EmployeeHoursPage.tsx`, único archivo productivo tocado):

```tsx
// DESPUÉS (fix):
const lastSyncedRefresh = useRef(refresh);
useEffect(() => {
  if (lastSyncedRefresh.current === refresh) return; // refresh no cambió de verdad
  lastSyncedRefresh.current = refresh;
  // ... fetch real ...
}, [refresh]);
```

En vez de preguntar "¿es ésta la primera vez que corro?", se pregunta "¿cambió realmente `refresh` desde la última vez que sincronicé?". Con `refresh` sin cambiar (el caso de mount/StrictMode), la respuesta es siempre "no" — sin importar cuántas veces React invoque el efecto con ese mismo valor. Cuando un guardado real incrementa `refresh`, la comparación da "sí" exactamente una vez por cada valor nuevo, disparando el fetch real — mismo comportamiento observable que antes para el caso legítimo (re-sincronización post-guardado), sin el falso positivo de StrictMode.

**Verificación de que el test realmente detecta el bug** (no es un test tautológico): se revirtió temporalmente el fix, se corrió el test nuevo (§12) — falló, esperando 2 llamadas y recibiendo 3 (timeout de `waitFor`). Se restauró el fix — el test vuelve a pasar. Confirma que el test es una regresión real, no un placebo.

## 7. `timeGridCatalogCache`

- **Dato cacheado**: sin cambios respecto a 14I.8 — todos los `NoveltyType` activos (con `finnegansLinks`) + todos los `HourConcept` activos, catálogo global sin scope de usuario, TTL 120s, sin invalidación explícita.
- **Consumo frontend**: reconfirmado nulo — `EmployeeHoursPage.tsx` sigue descartando los 3 campos gateados por `includeDetails` (`novelties`, `noveltyTypes`, `hourConcepts` del nivel superior de la respuesta), armando su propio estado desde `fetchPeriodNovelties()` (llamadas separadas y bien cacheadas) y desde `grid.employee.hourConcepts`/`grid.normalConcept`.
- **Cambio de contexto real desde 14I.8**: con el fix de `includeDetails` de 14I.9 ya en producción, `EmployeeHoursPage.tsx` ahora manda `includeDetails=false` **efectivo** (antes, por el bug, siempre viajaba como `true` sin que la UI lo supiera). Esto significa que la rama `query.includeDetails ? getTimeGridCatalogs() : Promise.resolve(null)` de `employees.repository.ts::findTimeGrid` **ya no toma nunca la rama de `getTimeGridCatalogs()`** en el flujo real de la aplicación — la función queda, hoy, sin ningún caller real que la ejecute (ni siquiera "se ejecuta pero se descarta" como antes de 14I.9 — ahora directamente no se ejecuta).
- **Mutadores que deberían invalidarla, si se decidiera hacerlo alguna vez**: `noveltyTypesService.create/update` y `hourConceptsService.create/update/remove` (los únicos 2 modelos que alimentan el catálogo) — ninguno de `shifts`/`regimes`/`positions`/`cost centers`/`salary categories` aporta datos a esta cache específica (confirmado leyendo `getTimeGridCatalogs()`: sólo consulta `noveltyType`/`hourConcept`).
- **¿Bug funcional real o sólo staleness potencial de baja prioridad?** Ninguno de los dos, en rigor — no hay ni siquiera staleness potencial hoy, porque la función que poblaría la cache no se ejecuta nunca desde el único caller real. Sigue siendo, con más evidencia todavía que en 14I.8, **prioridad baja, sin justificación para tocarla**. **No se tocó**, por instrucción explícita ("no tocar timeGridCatalogCache por prolijidad") y porque no hay evidencia de un mutador obvio con impacto funcional real que lo amerite.

## 8. Cambio aplicado

**`frontend/src/pages/EmployeeHoursPage.tsx`** — único archivo de producción tocado. Se reemplazó el guard `useRef(false)` ("primera ejecución") del efecto de re-sincronización silenciosa por una comparación contra el último `refresh` sincronizado (`useRef(refresh)` + `if (lastSyncedRefresh.current === refresh) return;`). Ninguna otra línea del componente fue tocada — ni el Effect A de carga inicial, ni los cálculos de horas, ni los modales, ni ningún handler de guardado.

**`frontend/src/pages/EmployeeHoursPage.test.tsx`** — se agregó 1 test nuevo (`"Etapa 14I.11: bajo React.StrictMode no dispara un tercer getTimeGrid espurio al montar (x2 esperado, no x3)"`), el único test del archivo que renderiza explícitamente bajo `<StrictMode>` (a diferencia de `renderPage()`, que no lo hace) para reproducir el double-invoke real y fijar el comportamiento correcto.

## 9. Qué NO se cambió

- El Effect A de carga inicial (`useEffect(..., [id, period])`) — su double-invoke bajo StrictMode queda como artefacto de desarrollo aceptado, sin costo en producción, no corregido a propósito (ver §5/§10).
- `timeGridCatalogCache`, `getTimeGridCatalogs()`, cualquier archivo de `employees.repository.ts`/`.service.ts`/`.controller.ts`/`.schemas.ts` — cero líneas de backend tocadas en esta etapa.
- `includeDetails` — sin cambios adicionales, el fix de 14I.9 ya cubre esto, sólo se releyó/reconfirmó (§4).
- Ningún cálculo de horas, ningún concepto horario, ninguna hora especial, ningún select de repositorio, ningún DTO/shape de respuesta.
- Ningún otro componente de la pantalla (modales de carga de hora, desglose manual, novedades) — sólo el efecto de re-sincronización, sin tocar su lógica de negocio interna.
- Fichador, Gestión Horaria productiva (cálculos/aprobaciones/cierres reales), Carga Horaria, Horas Especiales, Turnos/Regímenes, RBAC, Prisma schema, `relationJoins`, doble capa de cache (14I.10).
- No se ejecutó ninguna escritura real — los journeys corridos son de navegación/lectura (confirmado: 0 respuestas ≥400, sin acciones de guardado ejecutadas).

## 10. Contrato API preservado

Sin cambios — el fix es puramente frontend, sobre CUÁNDO se dispara una llamada ya existente, nunca sobre qué pide o qué shape espera. `GET /employees/:id/time-grid` sigue exactamente igual (ruta, query params, shape de respuesta).

## 11. RBAC/scope preservado

Sin cambios — no se tocó ningún middleware, rol ni `employeeAccessWhere`.

## 12. Tests/validaciones

**Frontend** (único lado tocado):
- `npm test` ✅ **802/802** (81 archivos) — incluye el archivo modificado (`EmployeeHoursPage.test.tsx`, 25/25, +1 test nuevo) y confirma cero regresiones en el resto de la suite.
- `npx tsc -p tsconfig.e2e.json --noEmit` ✅ sin errores.
- `npm run build` ✅ (`tsc -b && vite build`) sin errores.
- `npm run perf:journey:employees` ✅ passed (~47s) — journey obligatorio según el pedido; no mide este endpoint (Legajos nunca navega a `/horas/:id`), corrido igual por instrucción explícita.
- `npm run perf:journey:workforce` ✅ passed (~1.1min) — **el journey real que mide este endpoint**: confirma la reducción x3→x2 documentada en §5, con `git restore` inmediato de los reportes regenerados (`WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.{md,json}`, `EMPLOYEES_PERFORMANCE_JOURNEY_14D1.{md,json}`), mismo protocolo de toda la serie 14I.
- 0 respuestas HTTP ≥400 y 0 errores de consola en ambos journeys (confirmado leyendo el reporte regenerado antes de restaurarlo).

**Backend**: no se tocó ningún archivo — `npx prisma validate`/`npm run typecheck`/`npm test`/`npm run build` de backend no eran necesarios y no se corrieron (nada que validar del lado del backend).

**Verificación de que el test nuevo detecta el bug real** (no placebo): revertido temporalmente el fix → el test falla (timeout esperando 2, recibe 3) → restaurado el fix → el test pasa. Documentado en §6.

## 13. Riesgos pendientes

- Ninguno introducido — el fix es mínimo, verificado en 3 capas independientes (test unitario determinístico con reproducción de la falla, suite completa sin regresiones, journey real end-to-end).
- El x2 remanente de `time-grid` (StrictMode, Effect A) sigue ahí, sin costo en producción — si en el futuro se decide eliminarlo también (p. ej. con `cachedData` de TTL muy corto para dedupe in-flight), habría que evaluar con cuidado el riesgo de mostrar datos de horas ligeramente obsoletos en un remount legítimo (no StrictMode) — no se aplicó en esta etapa por ser un cambio de mayor superficie sobre una pantalla que edita datos operativos/payroll-adyacentes, y por no tener costo real hoy (ver §5/§6).
- `timeGridCatalogCache` sigue sin invalidación — confirmado, con más evidencia todavía, que no hay bug funcional real (§7); documentado, no autorizado a tocar en esta etapa.

## 14. Recomendación para 14I.12

- **No hay una etapa de `timeGridCatalogCache` que recomendar** — cada diagnóstico sucesivo (14I.1, 14I.8, esta etapa) refuerza la misma conclusión: sin caller real, sin impacto funcional, no vale la pena tocarla.
- **Si se quiere cerrar el x2 remanente de `time-grid`** (Effect A, StrictMode-only, cero costo en producción): evaluar `cachedData` con TTL muy corto (dedupe in-flight puro) específicamente para el Effect A de `EmployeeHoursPage.tsx` — requiere una etapa dedicada, con tests explícitos de que un remount legítimo (cambio real de `id`/`period`) sigue trayendo datos frescos, dado que esta pantalla edita datos operativos. No es urgente (sin costo en producción hoy).
- El inventario de hallazgos P1 de over-fetch/duplicados nombrados originalmente por 14I.1 (`employeeOrgChartSelect`, ya cerrado sin acción en 14I.5; `timeGridCatalogCache`, cerrado sin acción en 14I.8/esta etapa; duplicado x3 de `time-grid`, cerrado parcialmente en esta etapa) queda, con esta etapa, prácticamente agotado — no se recomienda una 14I.12 de "más hallazgos de 14I.1", sino evaluar si la serie 14I ya cumplió su objetivo original y puede darse por cerrada, salvo que aparezca un hallazgo nuevo real.
