# Performance Standards

Documento fuente para toda decisión de performance, consumo de datos y experiencia de carga en este proyecto. Nace del cierre de la serie de auditoría/saneamiento 9A-9H, extendida en 9I para cerrar el hueco puntual de Notificaciones (`docs/decisions/PERFORMANCE_DATA_LOADING_AUDIT_9A.md`, que documenta el diagnóstico completo, cada corrección aplicada y su evidencia) — este documento es el destilado permanente de esas etapas, no un resumen histórico. Ante cualquier duda de "¿cómo se cachea/pagina/refresca esto?", empezar acá; el documento de auditoría queda como referencia de por qué y con qué evidencia se llegó a cada regla.

## 1. Principios generales

- **No optimizar por optimizar.** Toda mejora de performance debe responder a un problema real, evidenciado por lectura de código o medición — nunca a una sospecha genérica de "esto podría ser más rápido."
- **Medir o justificar antes de cambiar.** Antes de tocar un patrón de carga de datos, confirmar con evidencia concreta (conteo de llamadas, volumen real de filas, lectura del código real) que el cambio resuelve algo — no basarse en suposiciones. Ver §14 sobre qué medir cuando no hay telemetría en vivo.
- **Diferenciar consumo real vs. lentitud percibida.** Un backend que responde en milisegundos puede sentirse lento si la UI blanquea pantallas completas en cada interacción; una pantalla que se siente fluida puede estar escondiendo un problema real de volumen de datos. Diagnosticar cuál es cuál antes de elegir la solución — no son intercambiables.
- **No cargar todo para que "parezca rápido".** Traer de golpe más datos de los necesarios (fetch-all, `take` grandes sin acotar) para evitar una segunda consulta es la trampa más común — cambia un problema de latencia por uno de escalabilidad, que además es más difícil de revertir después.
- **No consultar de a poco si eso hace la UX lenta sin necesidad.** El extremo opuesto también es un error: fragmentar en muchas llamadas pequeñas cuando un endpoint agregado serviría mejor (ver §2.E) genera más idas y vueltas de red de las necesarias.
- **Consultar lo justo, cachear lo correcto, invalidar lo relacionado.** La combinación que resuelve la mayoría de los casos: pedir exactamente lo que la pantalla necesita en ese momento, cachear lo que cambia poco, e invalidar únicamente lo que una mutación realmente afecta — nunca "todo por las dudas" (ver §5).
- **Priorizar consistencia en acciones críticas.** Fichador, aprobaciones, cierres, correcciones post-cierre y exportaciones oficiales nunca sacrifican corrección de datos por velocidad percibida — ver §2.D y §10.
- **Performance incluye backend, frontend y UX de carga.** Un endpoint rápido con un loading que blanquea la pantalla en cada refresh sigue siendo una experiencia lenta; una UX fluida sobre un endpoint que hace N+1 sigue siendo un problema de escalabilidad. Los tres frentes se auditan juntos, nunca por separado.

## 2. Clasificación de datos

Toda decisión de cache/paginación/refresh debe partir de identificar en qué categoría cae el dato. Esta matriz es la misma usada a lo largo de 9A-9G (`docs/decisions/PERFORMANCE_DATA_LOADING_AUDIT_9A.md` §2.2).

### A) Datos estáticos o casi estáticos

**Ejemplos**: empresas, sectores, centros de costo, puestos, categorías salariales, catálogos chicos administrados a mano.

**Estrategia**: cachear con TTL largo (5-10min), reutilizar entre pantallas sin refetch, invalidar sólo al editar esa entidad puntual. Fetch-all sólo está justificado si el volumen real es bajo (confirmado, no supuesto — decenas de filas, no cientos) y el dato es un vocabulario cerrado que no escala con headcount ni con tiempo transcurrido.

**Ejemplo real del proyecto**: `orgStructureApiService.getCatalog()` (familia `org-structure`, TTL 10min, persistido en IndexedDB) — reusado por 5+ pantallas sin refetch redundante gracias a la deduplicación de `cachedData()`.

### B) Datos de configuración

**Ejemplos**: turnos (plantillas), Horas Especiales (reglas), Conceptos Horarios, tipos de novedad, categorías de documento.

**Estrategia**: cache con TTL corto/medio (20-30s en backend si el conjunto de escrituras es cerrado y enumerable; más largo en frontend si el catálogo es realmente de configuración administrada a mano), invalidación explícita en cada mutador, refresh silencioso tras editar (nunca recalcular/recargar toda la pantalla si sólo cambió una regla).

**Ejemplo real del proyecto**: `workforce.cache.ts` (`shiftTemplatesCache`/`doubleRulesCache`, TTL 30s cada uno, backend) — implementado en 9C sólo después de enumerar exhaustivamente (grep en todo el backend) los write paths de `ShiftTemplate`/`DoubleHourRule` y confirmar que el conjunto es cerrado (3 funciones cada uno, mismo archivo, sin mutadores externos).

### C) Datos operativos

**Ejemplos**: carga horaria, fichadas, novedades, documentos, bandejas de revisión.

**Estrategia**: consultar por período/filtro (nunca fetch-all de un dataset que crece con el tiempo o con headcount), paginación real si el volumen puede crecer, mantener datos anteriores visibles durante un refresh (nunca blanquear una tabla que ya tiene datos), invalidación puntual (sólo lo que la mutación realmente afecta).

**Ejemplo real del proyecto**: `timeEntryApiService`/`noveltyApiService`/`documentApiService` — paginados con `Pagination.tsx` + `meta:{total,page,pageSize,hasMore}`, cacheados con TTL corto (15-20s backend), con `invalidateTimeEntryDependentCaches`/`invalidateNoveltyDependentCaches` invalidando exactamente las familias relacionadas tras cada mutación.

### D) Datos críticos

**Ejemplos**: fichador (entrada/salida), aprobaciones, cierres, correcciones post-cierre, exportaciones oficiales.

**Estrategia**: consistencia antes que velocidad aparente. Nunca optimistic update riesgoso. Nunca cache sin invalidación 100% segura y testeada — si hay cualquier duda sobre si la invalidación cubre todos los write paths, **no cachear**. Confirmación del backend siempre obligatoria antes de mostrar cualquier resultado. Trazabilidad (auditoría) por sobre todo.

**Ejemplo real del proyecto**: el fichador (`TimeClockPage.tsx`/`timeClockApiService.ts`) — confirmado en 9A/9G que no tiene ningún optimistic update (cada confirmación espera la respuesta real del servidor, con polling a un endpoint de sólo lectura si la red falla, nunca asume éxito) y ningún dato sensible al timestamp está cacheado. Ver §10.

### E) Datos agregados

**Ejemplos**: dashboard, reportes, métricas, KPIs.

**Estrategia**: un endpoint agregado por pantalla (nunca N llamadas del frontend, una por card, cuando el backend puede resolverlo en un único `Promise.all`), cache corto (30s salvo justificación explícita), invalidación relacionada (no exhaustiva "por las dudas" — ver §5), refresh manual o al entrar, nunca automático/silencioso salvo que la pantalla tenga un filtro interactivo real que lo amerite.

**Ejemplo real del proyecto**: `GET /dashboard/metrics` — un único endpoint, `dashboard.service.ts:calculateMetrics` hace `Promise.all` de 15 queries, cacheado 30s en backend (`dashboard.cache.ts`) y otros 30s en frontend (`dashboardMetricsApiService.ts`). El patrón de referencia confirmado correcto en 9A y re-confirmado sin cambios en 9G.

## 3. Reglas frontend obligatorias

- Separar carga inicial de refresh — son dos estados distintos, con distinto tratamiento visual.
- Loading grande (skeleton de página/sección completa) sólo en carga inicial real, cuando todavía no hay ningún dato en pantalla.
- No blanquear tablas/cards/listas durante un refresh si ya hay datos cargados — el patrón: `if (!data.length) setLoading(true)` antes de cada fetch que también se usa para refrescos (ver ejemplos en §6).
- Mantener los datos anteriores visibles mientras llega la respuesta nueva — es una consecuencia directa de no re-encender el loading grande, no requiere estado adicional.
- Mostrar un indicador discreto de actualización cuando corresponda (no siempre es necesario — evaluar caso por caso; no agregar un indicador nuevo si el guard de no-blanquear ya resuelve la experiencia).
- Errores localizados por sección — un fallo en una parte de la pantalla no debe ocultar ni invalidar visualmente el resto de las secciones que sí cargaron bien.
- No renderizar errores como texto suelto fuera de contexto — siempre dentro de la card/sección/formulario al que corresponden (`ErrorState`, `div.form-error` embebido, nunca un mensaje flotando en el layout).
- Búsquedas con debounce (`useDebouncedValue`, 250-400ms) cuando disparan una consulta al backend.
- No poner objetos/funciones recreados en cada render dentro de las dependencias de un `useEffect` si eso genera loops o refetch innecesario — extraer valores derivados a un `const`/`useMemo` cuando corresponda, sin sobre-ingeniería.
- No hacer fetch duplicado al mismo endpoint en el montaje inicial.
- No recargar catálogos si sólo cambió un filtro operativo (búsqueda, página, período) que el catálogo no usa — mapear qué dependencia usa qué llamada antes de decidir si van en el mismo efecto (ver §11).
- No bloquear toda la página por una acción local (guardar una celda, aprobar un ítem de una bandeja) — sólo la sección/fila afectada debe reaccionar visualmente.
- No cargar catálogos pesados al montar la pantalla si sólo se usan al abrir un modal — diferir la carga a cuando el modal se abre (ver ejemplo en §6).
- No usar optimistic update en acciones críticas (categoría D) — ver §2.D y §10.
- Para calendarios, definir una estrategia explícita antes de implementar — ver §7.

## 4. Reglas backend obligatorias

- Todo endpoint de listado que pueda crecer en volumen debe soportar paginación real (`page`/`take`/`skip` + `count`), no un `take` fijo alto como sustituto.
- Usar filtros por período/empresa/sector/centro de costo/estado cuando el dominio lo permita — nunca traer todo y filtrar en el cliente si el volumen puede crecer.
- Evitar includes de más de 2-3 niveles de profundidad sin necesidad — confirmar que cada nivel se consume realmente en el frontend antes de aceptarlo.
- Evitar N+1 queries — una consulta por fila dentro de un loop es una señal de alerta inmediata, resolver con `include`/`select`/agregación en una sola query.
- Cache backend sólo con invalidación explícita — nunca agregar un cache de lectura sin, en el mismo cambio, agregar la invalidación en cada mutador relacionado (ver §5).
- TTL corto (20-30s) para datos agregados/dashboard y para configuración con escritura frecuente; TTL medio/largo (5-10min) sólo para catálogos verdaderamente estáticos.
- No cachear datos críticos (categoría D) si puede afectar trazabilidad o mostrar un estado incorrecto — ver §2.D.
- Exportaciones deben estar acotadas por período/filtro — nunca un `SELECT *` sin límite temporal o de alcance.
- No usar un `take` grande (cientos/miles) sin justificación documentada en el propio código (comentario explicando por qué ese número, y qué lo acota) — ver ejemplo en §6.
- Preferir un endpoint agregado (`Promise.all` interno) sobre que el frontend dispare N llamadas pequeñas para una misma vista de KPIs/dashboard.
- Agregar tests de invalidación de cache cuando se agrega un cache nuevo (hit en la segunda lectura, invalidación tras cada mutador, vuelve a leer de la fuente real después de invalidar).
- Agregar tests de paginación/meta cuando se agrega paginación (pagina correctamente, respeta `take`/`page`, respeta filtros, `meta` correcta, caso sin resultados).

## 5. Reglas de cache

**Cuándo cachear**: cuando el dato se lee con más frecuencia de la que cambia, y el conjunto de escrituras que lo invalida es enumerable con confianza (grep de todo el backend, no sólo el módulo dueño — ver el criterio aplicado en 9C para `shiftTemplates`/`doubleRules`).

**Cuándo NO cachear**: cuando el conjunto de escrituras no se puede enumerar con confianza (ver el caso de `closures()` en 9C, que quedó deliberadamente sin cachear por esa misma razón), o cuando el dato es crítico (categoría D) y una lectura stale podría traducirse en una decisión de negocio incorrecta.

**TTL recomendado por tipo de dato** (valores ya en uso en el proyecto, no aspiracionales):

| Tipo de dato | TTL típico | Dónde |
|---|---|---|
| Catálogo estático (empresas, sectores, puestos, conceptos, categorías) | 5-10min | Frontend (`cachePolicy.ts`), persistido en IndexedDB |
| Configuración con escritura ocasional (turnos, reglas de horas especiales) | 30s | Backend (`ttlCache.ts`), sin persistir |
| Datos operativos (time-entries, novedades, documentos, pendientes) | 10-20s backend, 30s frontend | Ambos lados, TTL corto porque cambian seguido |
| Agregados/dashboard | 30s | Backend + frontend (doble cache, redundante pero no incorrecto — ver §9) |
| Datos críticos (fichador, aprobaciones) | Sin cache | Nunca |

**Invalidación obligatoria**: toda función de escritura sobre una entidad cacheada debe invalidar su cache de lectura en el mismo cambio que la introduce. Antes de escribir esa función, enumerar (grep, no suposición) todos los mutadores existentes de esa tabla en **todo** el backend, no sólo en el módulo que se está tocando.

**Cache frontend vs. backend**: son capas independientes — invalidar una no invalida la otra automáticamente. `frontend/src/services/cache/` (con familias por dominio, `invalidateCacheFamily`) es el mecanismo del lado del cliente; `backend/src/shared/cache/ttlCache.ts` es el del servidor. Una mutación que afecta un dato cacheado en ambos lados necesita invalidar **los dos** explícitamente — el hallazgo corregido en 9G (`workforceApiService.reviewCorrection` invalidaba el backend vía `auditService.register()` pero no el frontend) es el ejemplo concreto de este error.

**Stale-while-revalidate**: el patrón ya implementado en `frontend/src/services/cache/cachedData.ts` — sirve el valor cacheado (aunque esté vencido) mientras revalida en segundo plano, deduplicando revalidaciones concurrentes. Es el mecanismo preferido para catálogos y datos operativos; no reinventar una variante propia por módulo.

**Riesgos de datos stale**: acotados siempre por el TTL — el peor caso nunca es "para siempre desactualizado", es "hasta que el TTL expire". Esto cambia la severidad de un hueco de invalidación de "bug crítico" a "detalle de latencia" **siempre y cuando el TTL sea corto** (por eso datos agregados/configuración usan TTL de 20-30s, no minutos). Documentar el hueco igual, aunque no se corrija, si el write path es de alta frecuencia (ver el hallazgo del fichador en §10).

**Ejemplos del proyecto** (referencia rápida — ver §2 para el detalle de cada categoría):
- Dashboard: `dashboard.cache.ts` (backend) + `cachePolicies.dashboardMetrics` (frontend), 30s cada uno.
- Time-entries: `timeEntries.cache.ts`, 4 caches (list 15s, summary 20s, periodEmployees 20s, attendanceSummary 10s).
- Workforce (shiftTemplates/doubleRules): `workforce.cache.ts`, 30s cada uno (backend, agregado en 9C).
- Catálogos (org-structure, hour-concepts, positions, etc.): `cachePolicy.ts` del frontend, 5-10min.

## 6. Reglas de paginación

**Cuándo paginar**: cuando el dato es operativo (categoría C) o puede crecer con headcount/tiempo transcurrido/uso diario — no esperar a que el volumen ya sea un problema, paginar desde el diseño inicial de la pantalla.

**Cuándo fetch-all está permitido**: sólo para catálogos administrados a mano (categoría A/B) con expectativa realista de bajo volumen (decenas de filas, no cientos) — nunca para datos operativos.

**Cómo justificar fetch-all**: documentar en el propio código (comentario) o en un doc de decisión el volumen actual confirmado (no estimado) y la razón por la que ese dato no escala con el tiempo/headcount. Ejemplo real: Conceptos Horarios/Tipos de novedad/Categorías de documento quedaron fetch-all en 9E porque son vocabularios cerrados (HourConcept=5, NoveltyType=1, DocumentCategory=1 filas confirmadas) — documentado con esa evidencia, no con una suposición.

**Formato esperado de `meta`** (convención única en todo el proyecto, no inventar una variante por endpoint):
```json
{ "total": 0, "page": 1, "pageSize": 25, "hasMore": false }
```
Request: parámetros `page`/`take` (no `pageSize` del lado del request — esa es la convención ya establecida, aunque sea ligeramente inconsistente entre nombre de request y de response; no "corregirla" sin necesidad real, documentado como detalle menor desde 9A).

**Búsqueda con debounce**: toda paginación con búsqueda de texto debe debouncear esa búsqueda antes de disparar la consulta (ver §3).

**Filtros server-side**: si una pantalla expone un filtro en la UI, ese filtro debe resolverse en el backend antes de paginar — un filtro que sólo funciona client-side sobre una página ya recortada da resultados incorrectos. Antes de paginar una pantalla con múltiples filtros, confirmar que **todos** se resuelven server-side (ver el caso de Puestos en 9E, donde 3 filtros de jerarquía organizacional se aceptaban en la query pero nunca se traducían a un `where` real — se corrigió como parte de habilitar la paginación real, no después).

**No hacer paginación falsa**: nunca recortar en el frontend un array ya fetcheado completo y llamarlo "paginación" cuando el volumen real puede crecer — eso no resuelve el problema de payload/query, sólo lo esconde visualmente.

## 7. Reglas para calendarios

- **Mes visible + cache/precarga** cuando el volumen puede crecer — es la estrategia por defecto para cualquier calendario nuevo.
- **Año completo** sólo si el volumen es bajo y está explícitamente justificado (mismo criterio de evidencia que fetch-all en §6) — no es la opción por defecto.
- **Refresh silencioso tras mutación**: el calendario debe refrescarse automáticamente después de crear/editar/eliminar el dato que muestra, sin que el usuario tenga que cambiar de mes o recargar la página, y sin blanquear la grilla mientras llega la respuesta nueva.
- **Invalidar el calendario relacionado** tras cualquier mutación de la entidad que representa — igual criterio que cualquier otro dato operativo (§5).
- **No navegar automáticamente** salvo que la UX lo requiera explícitamente (por ejemplo, saltar al mes actual al entrar es razonable; saltar de mes solo durante la edición no lo es).
- **No bloquear toda la pantalla** por el refresh del calendario — sólo la grilla debe reaccionar visualmente.

**Ejemplo del proyecto (Horas Especiales)**: `SpecialHourRulesCalendarMonth.tsx` implementa exactamente este patrón desde la Etapa 8B — un `refreshToken` prop (incrementado por el padre tras cada mutación exitosa de una regla) más un `hasLoadedCurrentMonth` ref que distingue "primera carga de este mes" (sí muestra el skeleton completo) de "refresh por mutación" (silencioso, mantiene la grilla anterior visible, muestra un aviso discreto si el refresh falla sin perder los datos ya mostrados). Es el único calendario real de la app hoy y el patrón de referencia a copiar — 9A/9F documentaron extraerlo a un hook reusable (`useSilentRefresh` o similar) como pendiente para cuando aparezca un segundo calendario que lo necesite; no se hizo antes por no generalizar sin un segundo caso real que lo justifique.

## 8. Reglas para formularios y mutaciones

- Doble submit protegido — `useAsyncAction` (o un guard equivalente) en cada acción que dispara una mutación, para que un doble click no dispare dos requests.
- Loading visible en el botón/acción específica que se está ejecutando, no en toda la pantalla.
- No bloquear toda la pantalla por una mutación — sólo el formulario/fila/card afectada debe mostrar el estado de guardado.
- Errores dentro del formulario/card correspondiente, nunca como un mensaje suelto fuera de contexto (mismo criterio que §3).
- Después de guardar, invalidar sólo los datos relacionados — enumerar qué cache/familia toca esa mutación antes de decidir qué invalidar (§5), nunca "invalidar todo por las dudas".
- No recargar catálogos salvo que la mutación efectivamente los cambie — un guardado de un registro operativo no necesita recargar el catálogo de sectores/empresas que usó para completar un select.
- Mantener filtros y contexto del usuario durante y después de una mutación — período, búsqueda, página seleccionada no deben resetearse ni perderse por el simple hecho de haber guardado algo.

## 9. Reglas para dashboards/reportes/exportaciones

- Dashboard con endpoint agregado — un único `GET` que resuelve todas las métricas de la vista en el backend (`Promise.all` interno), nunca N llamadas del frontend por card.
- Cache corto (30s salvo justificación) — un dashboard es una vista de "estado aproximado ahora mismo", no un reporte financiero exacto al segundo.
- Exportaciones sólo bajo acción del usuario — el archivo (Excel/CSV) se genera al hacer click, nunca automáticamente al entrar a la pantalla. Nota: una tabla de **vista previa** que se carga al entrar (para mostrar qué se va a exportar) es un patrón válido y distinto — lo que no debe pasar es que el archivo final se descargue/genere sin una acción explícita del usuario.
- Exportaciones acotadas por período/filtro — nunca un export sin límite temporal o de alcance (ver el caso ya confirmado correcto de `findForExport`, `take:5000`, acotado por período+empleado+estado, documentado en el propio código desde 8F).
- No disparar ningún export al montar la pantalla.
- Separar horas reales de valores liquidables en cualquier métrica/reporte/exportación que muestre ambos — nunca mostrar un valor liquidable (multiplicado por Horas Especiales) como si fuera la hora real trabajada. El dashboard de este proyecto, en particular, no muestra ningún valor liquidable — sólo horas reales cargadas y cobertura, lo cual elimina el riesgo de mezcla por diseño (ver `dashboard.repository.ts:sumLoadedHours`, confirmado pass-through puro sin multiplicar por `appliedMultiplier`).
- No usar datos inflados para métricas reales — cualquier KPI de "horas trabajadas"/"horas cargadas" debe leer siempre el campo de horas reales (`TimeEntry.hours`, nunca un derivado multiplicado), consistente con la corrección de la Etapa 8F.

## 10. Reglas para el fichador

- **Consistencia y timestamp real tienen prioridad absoluta sobre velocidad percibida.** Ninguna optimización de este documento aplica al fichador si compromete esto.
- **No optimistic update riesgoso.** Toda confirmación de fichada espera la respuesta real del backend antes de mostrar cualquier resultado al empleado. Si la red falla, se hace polling a un endpoint de sólo lectura hasta obtener un estado terminal real — nunca se asume éxito del lado del cliente.
- **No cachear confirmaciones críticas** ni ningún dato sensible al timestamp (estado de fichada actual, hora de entrada/salida) — ninguna capa de cache (frontend ni backend) debe interponerse entre una lectura de estado de fichada y la fuente real.
- **No cambiar el flujo del fichador sin tests** — y, en el contexto de esta serie de performance, sin una etapa explícitamente dedicada y autorizada a tocar ese módulo (ver el punto siguiente).
- **Hallazgo pendiente documentado (Etapa 9G)**: `clockInResolved`/`clockOutResolved` (el fichador por DNI sin foto, en `backend/src/modules/time-entries/timeEntries.service.ts`) y el job en `setInterval` `expireOpenWorkShifts` (`backend/src/modules/time-entries/clockPunchMaintenance.ts`) escriben `TimeEntry` sin llamar `auditService.register()` — a diferencia de su hermano con foto (`clockPhotoPunch`, que sí usa el helper `scheduleClockAudit()`). Como `auditService.register()` es el punto central que invalida el cache de dashboard, estos 2 caminos no lo invalidan — acotado siempre a los 30s del TTL del dashboard, nunca a un dato incorrecto en `TimeEntry` (el valor real se escribe siempre bien). **Es deuda puntual futura, no un bloqueo actual** — no corregir esto como parte de ninguna etapa de performance genérica; requiere una etapa dedicada al fichador, con autorización explícita para tocar ese módulo específico. Ver `docs/decisions/PERFORMANCE_DATA_LOADING_AUDIT_9A.md` §18.7 para el detalle completo con citas de archivo:línea.

## 11. Checklist obligatorio para futuras etapas frontend

Antes de dar por terminada cualquier pantalla nueva o cambio a una existente que cargue datos:

- [ ] ¿Qué endpoints llama esta pantalla al entrar?
- [ ] ¿Qué endpoints llama al cambiar filtros?
- [ ] ¿Qué endpoints llama al mutar (crear/editar/eliminar/aprobar/rechazar)?
- [ ] ¿Hay llamadas duplicadas al mismo endpoint en el montaje inicial?
- [ ] ¿Hay loading inicial separado de refresh, o un único flag que blanquea todo siempre?
- [ ] ¿Se blanquean datos ya visibles durante un refresh (filtro, mutación, poll)?
- [ ] ¿Hay debounce en las búsquedas que consultan al backend?
- [ ] ¿Hay paginación si la lista puede crecer con headcount/tiempo/uso?
- [ ] ¿Los catálogos se cachean, o se recargan en cada montaje/mutación sin necesidad?
- [ ] ¿Los catálogos pesados usados sólo por un modal se cargan al montar la pantalla o al abrir el modal?
- [ ] ¿Los errores están localizados por sección, o hay un mensaje suelto fuera de contexto?
- [ ] ¿Se mantiene el contexto del usuario (filtros, período, página) durante y después de una mutación?

## 12. Checklist obligatorio para futuras etapas backend

- [ ] ¿El endpoint puede crecer en volumen (headcount, tiempo transcurrido, uso operativo)?
- [ ] ¿Necesita paginación real (`page`/`take`/`skip`+`count`), o un `take` fijo alcanza con evidencia de volumen bajo?
- [ ] ¿Necesita filtros server-side (período/empresa/sector/centro de costo/estado)?
- [ ] ¿Tiene índices adecuados para los filtros que realmente se usan?
- [ ] ¿Tiene includes de más de 2-3 niveles de profundidad? ¿Se consume cada nivel en el frontend?
- [ ] ¿Puede generar N+1 (una query dentro de un loop)?
- [ ] ¿Necesita cache? Si sí — ¿se enumeraron **todos** los write paths de esa tabla en todo el backend, no sólo en el módulo dueño?
- [ ] ¿Cómo se invalida ese cache? ¿En qué mutadores exactos?
- [ ] ¿Es un dato crítico (categoría D)? Si sí — no cachear, no optimistic update.
- [ ] ¿Tiene tests de paginación/cache/invalidación si se agregó alguno de los tres?
- [ ] ¿Las exportaciones que expone están acotadas por período/filtro?

## 13. Checklist obligatorio para code review

Reglas de rechazo — no aprobar un cambio si:

- Introduce una pantalla nueva con fetch-all injustificado (sin evidencia de volumen bajo documentada).
- Usa loading global para lo que es un refresh local de una sección.
- Agrega un cache sin invalidación (o con invalidación no verificada contra todos los write paths reales).
- Agrega una búsqueda que consulta al backend sin debounce.
- Agrega un endpoint de listado potencialmente grande sin paginación.
- Agrega una exportación sin acotar por período/filtro.
- Agrega optimistic update en una acción crítica (categoría D) sin justificación explícita y revisada.
- Deja textos técnicos (nombres de tabla/campo, códigos de error crudos, "schema", "payload", "backend") visibles al usuario final, o errores renderizados fuera de contexto.

Ver también la sección "Performance" ya existente en `docs/CODE_REVIEW_CHECKLIST.md` — estas reglas la complementan, no la reemplazan.

## 14. Performance budgets orientativos

No son límites estrictos ni bloqueantes — son puntos de referencia para detectar cuándo algo se está saliendo del patrón esperado sin necesitar telemetría en producción:

- **Pantalla operativa normal**: 1 llamada principal de datos + catálogos ya cacheados (no cuentan como llamadas "nuevas" si están dentro de su TTL).
- **Dashboard/vista de KPIs**: 1 endpoint agregado — más de 2-3 llamadas en el montaje es señal de que algo debería agregarse en el backend.
- **Tablas potencialmente grandes**: paginadas desde el diseño inicial, no como corrección posterior.
- **Búsqueda con consulta al backend**: debounce de 250-400ms.
- **Cache de dashboard/agregados**: 30s salvo justificación documentada de por qué necesita otro valor.
- **Cache de configuración**: TTL corto/medio (20s-10min según qué tan seguido se edita) con invalidación explícita siempre.
- **Exportaciones**: bajo demanda (click del usuario), nunca automáticas al entrar a la pantalla.
- **Fichador**: sin cache riesgoso, nunca — no hay presupuesto de performance que justifique relajar esto.

## 15. Deudas pendientes

- **Fichador (Etapa 9G, ver §10)**: `clockInResolved`/`clockOutResolved` sin foto y el cron `expireOpenWorkShifts` no registran auditoría y por eso no invalidan el cache de dashboard (acotado a 30s de staleness, dato real siempre correcto). Deuda puntual futura — requiere etapa dedicada y autorizada al fichador.
- **`MonthlyClosuresPage` (Etapa 9E/9G)**: paginación pendiente hasta definir explícitamente el alcance de "seleccionar todos" bajo paginación (página visible vs. todo el período) — es una decisión de producto, no un cambio mecánico de performance. `MonthlyTimeClosure` sigue siendo la única tabla de esta auditoría con una trayectoria de crecimiento predecible por tiempo transcurrido (~12 filas/mes con la plantilla de empleados actual); vigilar su conteo real como condición de reapertura.
- **Mega-efecto de `HoursPage` (Etapa 9F)**: ya separado en 3 efectos por dependencia real — riesgos residuales documentados: el banner de error compartido entre 2 efectos podría, en un caso angosto, mostrar sólo uno de dos fallos simultáneos; la Bandeja de revisión sigue sin un `ErrorState` dedicado con retry propio (mismo comportamiento que antes de la etapa).
- **4 patrones de cache backend distintos conviviendo** (`ttlCache.ts` compartido, el patrón "fetch≤500+slice en JS" de positions/hour-concepts, el patrón `listCache` propio de novelty-types/document-categories, y el caso aislado de `employees.repository.ts`): los 4 funcionan correctamente hoy (invalidación verificada exhaustiva en los 4) — es deuda de consistencia arquitectónica, no un bug, documentada desde 9A y no resuelta a propósito (habría sido un refactor sin un bug detrás que lo justifique).
- **Catálogos con backend ya listo para paginar pero frontend sin usarlo** (Conceptos Horarios, Tipos de novedad, Categorías de documento — ver 9E/9F): si el volumen alguna vez crece más allá de "vocabulario cerrado chico", el trabajo de habilitarlo es 100% frontend, el backend ya soporta el patrón dual filtrado/cacheado.
- **`Exportar resumen` sin `onClick` en `DashboardPage.tsx`** (encontrado en 9G): no es un bug de performance, es una funcionalidad faltante — fuera del alcance de esta serie, documentado para una etapa de UX/producto futura.
- **Botón de refresh manual del Dashboard**: nunca implementado (era una sugerencia de UX de 9A, no un bug) — el doble cache de 30s+30s puede tardar hasta ~60s en reflejar una mutación reciente; aceptado como correcto para una pantalla no crítica (categoría E).

## 16. Historial de la serie y estado de cierre

Ver `docs/decisions/PERFORMANCE_DATA_LOADING_AUDIT_9A.md` para el diagnóstico completo, cada corrección aplicada con su evidencia, y el detalle etapa por etapa (9A auditoría, 9B quick wins, 9C cache backend, 9E paginación, 9F HoursPage, 9G dashboard/reportes, 9H este documento + cierre formal, 9I Notificaciones — hueco puntual que había quedado fuera de la auditoría original). Este documento (`PERFORMANCE_STANDARDS.md`) es el que rige hacia adelante; el de auditoría queda como registro histórico de cómo se llegó a estas reglas.

## 17. Notificaciones

Reglas específicas cerradas en la Etapa 9I (`docs/decisions/PERFORMANCE_DATA_LOADING_AUDIT_9A.md` §20), después de confirmar que el endpoint de listado (`GET /workforce/notifications`) hacía fetch-all con `take:200` fijo, sin paginación ni filtro server-side.

- **La campanita nunca carga todo.** En este proyecto la campanita (`AppShell.tsx`) no es un dropdown con preview — es un ícono con badge que sólo llama al endpoint de contador (`unreadCount`, liviano, ya usa el índice `[recipientUserId, status, createdAt]`) y al click navega a la pantalla completa. Si en el futuro se agrega un dropdown con preview de notificaciones, debe cargar sólo las últimas 10-20 + `unreadCount`, nunca la lista completa — mismo criterio que cualquier otra pantalla operativa (§2.C).
- **Vista completa: paginación real o infinite scroll, nunca fetch-all.** `NotificationsPage.tsx` pagina con `page`/`take` (`take:20` por página, máximo seguro 100 forzado por schema) vía un botón "Cargar más" que agrega, no reemplaza — preferido sobre `Pagination.tsx` (prev/next) porque la pantalla es un feed de tarjetas, no una tabla.
- **Filtro de estado server-side.** `status=NO_LEIDA|LEIDA` se resuelve en el `where` del backend, nunca filtrando en el cliente sobre una página ya recortada (mismo criterio de §6 "no hacer paginación falsa").
- **Marcado como leído actualiza local y puntual.** Marcar una notificación como leída actualiza el ítem en memoria y dispara el evento `app:notifications-changed` (que refresca sólo el contador de la campanita) — nunca recarga la lista completa ni bloquea la pantalla. Con manejo de error local (no revienta silenciosamente si falla la escritura).
- **No blanquear durante refresh/filtro/paginación.** Mismo guard `if (!items.length) setStatus("loading")` que el resto de la app (§3) — cambiar el filtro o pedir la página siguiente con notificaciones ya visibles no blanquea la lista.
- **Nunca notificaciones de otro usuario.** El `where` siempre incluye `recipientUserId: user.id` server-side — no hay ningún camino donde el filtro de usuario dependa del cliente.
- **Sin cache, deliberado.** Los write paths de `SystemNotification` están dispersos en 5+ módulos (novedades, cierres/correcciones, carga horaria, inasistencias, evaluación de turnos) — no es un conjunto cerrado y enumerable con confianza (criterio de §5), así que queda sin cachear ni en frontend ni en backend, igual que `closures()` en 9C.
- **"Marcar todas como leídas" no existe hoy.** Si se pide en el futuro, es una funcionalidad de negocio nueva (endpoint bulk + botón), no un cambio de carga — no confundir con el alcance de este documento.
