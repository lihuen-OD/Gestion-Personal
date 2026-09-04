# Performance Journey — Legajos (Etapa 14D.1)

Reporte generado automáticamente por `npm run perf:journey:employees`. No editar a mano — se sobreescribe en cada corrida.

## 1. Resumen ejecutivo

Recorrido específico del módulo Legajos: 46/46 acciones cubiertas, 0 salteadas (con motivo documentado cada una), 0 respuestas HTTP >= 400, 0 errores de consola. 3 acción(es) en rango Crítico (> 3000ms) y 1 en rango Lento (2000-3000ms). Este reporte es de medición, no de optimización — ver docs/decisions/EMPLOYEES_FULL_PERFORMANCE_14C3.md para los cambios ya aplicados y §16 abajo para lo que queda como candidato con evidencia nueva.

## 2. Alcance

Exclusivamente el módulo Legajos (listado, detalle, las 12 pestañas del legajo, historiales de campo/bloque, apertura de modales de edición sin guardar, Adjuntos/Documentos). No incluye otros módulos ni un recorrido general de la app (eso lo cubre `npm run perf:journey`, Etapa 14B.3).

## 3. Modo usado

**read-only** (default). No se guardó ningún dato — sólo navegación, apertura de historiales/modales, búsqueda y paginación. Modo `write-safe` evaluado y no implementado esta etapa: ver §15 y la fila "J. Guardados" de la matriz (§4) para el motivo completo.

## 4. Matriz completa del módulo

Relevada leyendo el código real (`EmployeeDetailPage.tsx`, `EmployeeDetailBlocks.tsx`, `FieldHistoryControls.tsx`, `LaborTrackedFields.tsx`, `EmployeeDocumentsPanel.tsx`, `EmployeesPage.tsx`) antes de escribir el journey — Parte 1 del pedido.

| Zona | Pantalla/acción | Componente | Endpoint esperado | Medible por journey | Se mide esta etapa | Motivo si no se mide |
|---|---|---|---|---|---|---|
| A. Listado | 1-2. Entrar a /legajos, carga inicial de tabla | EmployeesPage.tsx | GET /employees, GET /employees/summary, GET /org-structure | Sí | Sí | — |
| A. Listado | 6-7. Paginación siguiente/anterior | Pagination.tsx / EmployeesPage.tsx | GET /employees?page=N | Sí | Sí | Se saltea en tiempo de ejecución (con motivo explícito en el reporte) si el entorno actual sólo tiene una página de legajos. |
| A. Listado | 8-9. Buscar empleado por texto / limpiar búsqueda | FilterPanel.tsx / EmployeesPage.tsx | GET /employees?search=... | Sí | Sí | El término de búsqueda se toma del primer legajo real de la tabla (no se inventa), y nunca se escribe en el reporte. |
| A. Listado | 10-11. Aplicar filtro por empresa / limpiar filtro | FilterPanel.tsx / EmployeesPage.tsx | GET /employees?companyId=... | Sí | Sí | Se saltea si el catálogo de empresas está vacío en el entorno actual. |
| A. Listado | Cambio de tamaño de página | EmployeesPage.tsx | — | No | No | No existe selector de tamaño de página en la UI actual (pageSize=25 fijo, confirmado leyendo el componente). |
| A. Listado | 12. Confirmar que la tabla no se blanquea durante paginación | EmployeesPage.tsx | — | Sí | Sí | Se verifica leyendo el DOM inmediatamente después del click, antes de esperar la respuesta. |
| B. Detalle | 13. Abrir primer legajo disponible | EmployeesPage.tsx → EmployeeDetailPage.tsx | navegación a /legajos/:id | Sí | Sí | Se usa el primer link real de la tabla, igual que el journey general (14B.3). |
| B. Detalle | 14-15. GET overview / overview-details | EmployeeDetailPage.tsx | GET /employees/:id/overview, GET /employees/:id/overview-details | Sí | Sí | — |
| B. Detalle | 16. GET /audit si se dispara | EmployeeDetailPage.tsx | GET /audit | Sí | Sí | Se dispara solo al entrar (pestaña 0 por defecto) porque tabsThatNeedAudit incluye la pestaña inicial — queda capturado en la ventana de apertura del detalle. |
| B. Detalle | 17-18. Ver cabecera principal / información general | EmployeeDetailPage.tsx | — | Sí | Sí | — |
| B. Detalle | 19. Cambiar entre pestañas/secciones | Tabs.tsx / EmployeeDetailPage.tsx | variable por pestaña | Sí | Sí | Se recorren TODAS las pestañas visibles (incluidas Novedades/Documental/Historial de Eventos/Turnos/Auditoría/Régimen Laboral, fuera de las zonas C-I) para cubrir el ítem 6 del pedido; sólo se abren historiales/ediciones dentro de las zonas C-I explícitamente pedidas. |
| C. Información general | 20. Entrar a la pestaña | EmployeeDetailPage.tsx (tab 0) | sin endpoint propio (ya cargado por overview/overview-details) | Sí | Sí | — |
| C. Información general | 21-23. Historiales visibles de la sección | SectionChangeHistory.tsx | ninguno (filtra client-side sobre GET /audit ya cargado) | No | No | Confirmado en el código: no hay botón 'abrir historial' individual en esta pestaña, el historial se arma filtrando en el cliente los datos de auditoría ya traídos — no hay una acción nueva de red que medir. |
| C. Información general | 24. Abrir edición sin guardar | EmployeeDetailPage.tsx (tab 0) | — | No | No | Esta pestaña es edición inline directa sobre el propio formulario (sin modal separado) — no hay una acción de 'abrir edición' distinta de estar parado en la pestaña. |
| D. Contacto y domicilio | 25. Entrar a la pestaña | EmployeeDetailPage.tsx (tab 1) | sin endpoint propio | Sí | Sí | — |
| D. Contacto y domicilio | 26. Historial de contacto | SectionChangeHistory.tsx | ninguno (mismo mecanismo que Información general) | No | No | Los campos de contacto (teléfono/celular/email/contacto de emergencia) no usan FieldWithHistory — no tienen botón de historial individual, sólo aparecen en la tabla de auditoría pooled de abajo. |
| D. Contacto y domicilio | 27-29. Historial de domicilio, endpoint y tiempo hasta verlo | BlockHistoryTimeline (EmployeeDetailBlocks.tsx) | GET /employees/:id/block-history | Sí | Sí | — |
| D. Contacto y domicilio | 30. Cerrar historial | EmployeeDetailBlocks.tsx | — | Sí | Sí | — |
| D. Contacto y domicilio | 31. Abrir edición de domicilio | EmployeeDetailBlocks.tsx (Modal) | — | Sí | Sí | Se abre y se cierra sin guardar (modo lectura). |
| D. Contacto y domicilio | 32-33. Guardar contacto/domicilio + refetch | EmployeeDetailBlocks.tsx | PATCH /employees/:id/address | Sí | No | Ver Parte 3/9 del reporte: ningún guardado de Legajos es reversible sin control (el historial de campo/bloque es de sólo-agregado, por diseño) — escritura segura queda documentada como pendiente, no implementada esta etapa. |
| E. Datos laborales | 34. Entrar a la pestaña | EmployeeDetailPage.tsx (tab 2) | 8 GET /employees/:id/field-history en paralelo + GET /employees/:id/position-validation (SalaryRangeValidationCard) — ver hallazgos en §16 | Sí | Sí | Hallazgo de esta etapa: a diferencia de los bloques (Domicilio/Responsables/Transporte/Configuración), los 8 campos trackeados de esta pestaña (empresa, sector, centro de costo, puesto, categoría de recibo, categoría interna, convenio, obra social) disparan su field-history automáticamente al entrar a la pestaña, no al abrir 'Historial'. Además, SalaryRangeValidationCard dispara GET position-validation al montar — observado hasta >10s en corridas reales (ver 'Top 10 requests más lentas'). |
| E. Datos laborales | 35. Historial de empresa | MultiCompanyField (LaborTrackedFields.tsx) | GET /employees/:id/field-history (field=companies) | Sí | Sí | — |
| E. Datos laborales | 36. Historial de unidad de negocio | DerivedLaborField (EmployeeDetailPage.tsx) | — | No | No | Campo derivado de sector (sólo lectura), sin historial propio — confirmado en el código, no es una limitación del journey. |
| E. Datos laborales | 37. Historial de establecimiento | DerivedLaborField (EmployeeDetailPage.tsx) | — | No | No | Mismo motivo que unidad de negocio: campo derivado, sin historial propio. |
| E. Datos laborales | 38. Historial de sector | FieldWithHistory (FieldHistoryControls.tsx) | GET /employees/:id/field-history (field=sector) | Sí | Sí | — |
| E. Datos laborales | 39. Historial de puesto | EmployeePositionField (LaborTrackedFields.tsx) | GET /employees/:id/field-history (field=positionId) | Sí | Sí | — |
| E. Datos laborales | 40. Historial de jornada/turno | — | — | No | No | No existe como campo de Datos Laborales — 'Turnos' es una pestaña aparte del módulo Shifts (fuera de alcance de Legajos), confirmado leyendo EmployeeDetailPage.tsx completo. No se inventó un historial que la UI no tiene. |
| E. Datos laborales | 41. Resto de field-history (centro de costo, categoría de recibo, categoría interna, convenio, obra social) | FieldWithHistory (FieldHistoryControls.tsx) | GET /employees/:id/field-history | Sí | Sí | — |
| F. Responsables/Asignaciones | 43. Entrar a la pestaña | EmployeeDetailPage.tsx (tab 3) | sin endpoint propio | Sí | Sí | — |
| F. Responsables/Asignaciones | 44-47. Historial de responsable de carga y de encargado directo, endpoint y tiempo | AssignmentBlock (EmployeeDetailBlocks.tsx) ×2 | GET /employees/:id/block-history | Sí | Sí | A diferencia de Datos Laborales, este patrón SÍ es lazy (fetch real al click 'Ver historial', no al entrar a la pestaña) — confirmado en el código. |
| F. Responsables/Asignaciones | 48-50. Abrir edición de responsables + guardado + refetch | AssignmentBlock (Modal) | PUT /employees/:id/assignments | Sí | Parcial | Se mide abrir el modal (sin guardar). El guardado queda sin medir — mismo motivo que Contacto/Domicilio (historial append-only, sin escritura reversible). |
| G. Transporte | 51. Entrar a la pestaña | EmployeeDetailPage.tsx (tab 4) | sin endpoint propio | Sí | Sí | — |
| G. Transporte | 52-53. Historial de transporte, endpoint y tiempo | TransportBlock (EmployeeDetailBlocks.tsx) | GET /employees/:id/block-history | Sí | Sí | Lazy, mismo patrón que Domicilio/Responsables. |
| G. Transporte | 54-56. Abrir edición + guardado + refetch | TransportBlock (Modal) | PATCH /employees/:id/transport | Sí | Parcial | Se mide abrir el modal (sin guardar). Guardado sin medir, mismo motivo de historial append-only. |
| H. Configuración | 57. Entrar a la pestaña | EmployeeDetailPage.tsx (tab 5) | sin endpoint propio | Sí | Sí | — |
| H. Configuración | 58. Historial de configuración/horas especiales | HoursSpecialBlock (EmployeeDetailBlocks.tsx) | GET /employees/:id/block-history | Sí | Sí | Lazy, mismo patrón que Domicilio/Transporte. |
| H. Configuración | 59. Conceptos horarios asignados | HoursSpecialBlock (EmployeeDetailBlocks.tsx) | — | No | No | Vienen incluidos en overview-details (enabledHourConcepts), no hay un endpoint propio de listado en esta pestaña. |
| H. Configuración | 61-63. Abrir edición + guardado + refetch | HoursSpecialBlock (Modal) | PUT /employees/:id/hour-concepts | Sí | Parcial | Se mide abrir el modal (sin guardar). Guardado sin medir, mismo motivo de historial append-only. |
| I. Adjuntos/Documentos | 64-65. Entrar a Adjuntos, carga de documentos | EmployeeDocumentsPanel.tsx | GET /documents?employeeId=:id | Sí | Sí | — |
| I. Adjuntos/Documentos | 66. Abrir/ver documento existente | EmployeeDocumentsPanel.tsx | descarga desde storage (Google Drive) | Sí | No | Se saltea a propósito: abre una pestaña/descarga externa fuera del control del journey, sin valor de performance del módulo Legajos en sí. |
| I. Adjuntos/Documentos | 67-68. Subir documento / createDocument | DocumentUploadModal.tsx | POST /employees/:id/documents | Sí | Parcial | Se mide abrir el modal 'Agregar documento' (sin subir). No se sube ningún archivo real esta etapa — no existe un fixture de archivo seguro documentado para esto, y subir uno real escribiría un documento permanente en storage + DB. Queda documentado como pendiente para una etapa que defina un fixture explícito. |
| J. Guardados | 69-75. Todos los botones de guardar del módulo | EmployeeDetailPage.tsx + EmployeeDetailBlocks.tsx + FieldHistoryControls.tsx + LaborTrackedFields.tsx | PATCH /employees/:id, PATCH /employees/:id/address, PATCH /employees/:id/transport, PUT /employees/:id/assignments, PUT /employees/:id/hour-concepts, POST /employees/:id/field-history, POST /employees/:id/block-history, POST /employees/:id/documents | Sí | No | Ninguno se mide esta etapa por seguridad de datos: cada uno de estos guardados crea una fila NUEVA y permanente en EmployeeFieldHistory/EmployeeBlockHistory/AuditLog (historial de sólo-agregado, protegido explícitamente por las reglas del proyecto) — no existe una forma de 'restaurar el valor original' sin también borrar ese registro de auditoría, lo que violaría la regla de no perder historial. Evaluado y descartado para modo escritura segura (Parte 3 del pedido, cláusula de 'si es riesgoso, dejarlo documentado como pendiente'). |

## 5. Acciones cubiertas

| Acción | Zona | Ruta | Visible | Network idle | Requests | Errores consola | Escritura |
|---|---|---|---|---|---|---|---|
| Login (acceso rápido RRHH) | Login | `blank` | 493ms | 5101ms | 6 | 0 | No |
| Entrar a /legajos | A. Listado | `/` | 74ms | 3504ms | 6 | 0 | No |
| Paginación — Siguiente | A. Listado | `/legajos` | 46ms | 129ms | 0 | 0 | No |
| Paginación — Anterior | A. Listado | `/legajos` | 36ms | 120ms | 0 | 0 | No |
| Buscar empleado por texto | A. Listado | `/legajos` | 21ms | 424ms | 0 | 0 | No |
| Limpiar búsqueda | A. Listado | `/legajos` | 17ms | 419ms | 0 | 0 | No |
| Aplicar filtro (Empresa) | A. Listado | `/legajos` | 16ms | 99ms | 1 | 0 | No |
| Limpiar filtro (Empresa) | A. Listado | `/legajos` | 13ms | 96ms | 0 | 0 | No |
| Abrir primer legajo disponible | B. Detalle | `/legajos` | 838ms | 4532ms | 8 | 0 | No |
| Cambiar a pestaña "Información General" | C. Información general | `/legajos/:id` | 24ms | 108ms | 0 | 0 | No |
| Cambiar a pestaña "Contacto y Domicilio" | D. Contacto y domicilio | `/legajos/:id` | 21ms | 103ms | 0 | 0 | No |
| Abrir historial de Domicilio actual | D. Contacto y domicilio | `/legajos/:id` | 1818ms | 1902ms | 2 | 0 | No |
| Cerrar historial de Domicilio actual | D. Contacto y domicilio | `/legajos/:id` | 27ms | 110ms | 0 | 0 | No |
| Abrir edición de Domicilio actual | D. Contacto y domicilio | `/legajos/:id` | 45ms | 126ms | 0 | 0 | No |
| Cambiar a pestaña "Datos Laborales" | E. Datos laborales | `/legajos/:id` | 38ms | 120ms | 0 | 0 | No |
| Revelar historial de Empresa (ya precargado) | E. Datos laborales | `/legajos/:id` | 2810ms | 2893ms | 17 | 0 | No |
| Revelar historial de Centro de costo (ya precargado) | E. Datos laborales | `/legajos/:id` | 19ms | 102ms | 0 | 0 | No |
| Revelar historial de Sector (ya precargado) | E. Datos laborales | `/legajos/:id` | 25ms | 108ms | 0 | 0 | No |
| Revelar historial de Puesto (ya precargado) | E. Datos laborales | `/legajos/:id` | 26ms | 110ms | 0 | 0 | No |
| Revelar historial de Categoría de recibo (ya precargado) | E. Datos laborales | `/legajos/:id` | 36ms | 117ms | 0 | 0 | No |
| Revelar historial de Categoría interna (ya precargado) | E. Datos laborales | `/legajos/:id` | 12ms | 95ms | 0 | 0 | No |
| Revelar historial de Convenio (ya precargado) | E. Datos laborales | `/legajos/:id` | 26ms | 110ms | 0 | 0 | No |
| Revelar historial de Obra Social (ya precargado) | E. Datos laborales | `/legajos/:id` | 24ms | 107ms | 0 | 0 | No |
| Cambiar a pestaña "Responsables / Asignaciones" | F. Responsables/Asignaciones | `/legajos/:id` | 13ms | 96ms | 0 | 0 | No |
| Abrir historial de Encargado directo actual | F. Responsables/Asignaciones | `/legajos/:id` | 1799ms | 1881ms | 3 | 0 | No |
| Cerrar historial de Encargado directo actual | F. Responsables/Asignaciones | `/legajos/:id` | 23ms | 105ms | 0 | 0 | No |
| Abrir historial de Responsable de carga horaria actual | F. Responsables/Asignaciones | `/legajos/:id` | 800ms | 882ms | 2 | 0 | No |
| Cerrar historial de Responsable de carga horaria actual | F. Responsables/Asignaciones | `/legajos/:id` | 10ms | 91ms | 0 | 0 | No |
| Abrir edición de Encargado directo actual | F. Responsables/Asignaciones | `/legajos/:id` | 14ms | 96ms | 0 | 0 | No |
| Abrir edición de Responsable de carga horaria actual | F. Responsables/Asignaciones | `/legajos/:id` | 31ms | 114ms | 0 | 0 | No |
| Cambiar a pestaña "Transporte" | G. Transporte | `/legajos/:id` | 36ms | 119ms | 0 | 0 | No |
| Abrir historial de Transporte actual | G. Transporte | `/legajos/:id` | 807ms | 890ms | 2 | 0 | No |
| Cerrar historial de Transporte actual | G. Transporte | `/legajos/:id` | 30ms | 112ms | 1 | 0 | No |
| Abrir edición de Transporte actual | G. Transporte | `/legajos/:id` | 12ms | 93ms | 0 | 0 | No |
| Cambiar a pestaña "Configuración Horaria" | H. Configuración | `/legajos/:id` | 35ms | 119ms | 0 | 0 | No |
| Abrir historial de Conceptos horarios adicionales | H. Configuración | `/legajos/:id` | 1300ms | 1383ms | 3 | 0 | No |
| Cerrar historial de Conceptos horarios adicionales | H. Configuración | `/legajos/:id` | 31ms | 114ms | 0 | 0 | No |
| Abrir edición de Conceptos horarios adicionales | H. Configuración | `/legajos/:id` | 12ms | 93ms | 0 | 0 | No |
| Cambiar a pestaña "Ausentismo / Novedades" | Otras pestañas del legajo (fuera de zonas C-I) | `/legajos/:id` | 35ms | 118ms | 0 | 0 | No |
| Cambiar a pestaña "Gestión Documental" | I. Adjuntos/Documentos | `/legajos/:id` | 30ms | 114ms | 0 | 0 | No |
| Abrir modal 'Agregar documento' (sin subir archivo) | I. Adjuntos/Documentos | `/legajos/:id` | 43ms | 125ms | 0 | 0 | No |
| Cambiar a pestaña "Historial de Eventos" | Otras pestañas del legajo (fuera de zonas C-I) | `/legajos/:id` | 34ms | 115ms | 0 | 0 | No |
| Cambiar a pestaña "Turnos" | Otras pestañas del legajo (fuera de zonas C-I) | `/legajos/:id` | 19ms | 101ms | 2 | 0 | No |
| Cambiar a pestaña "Auditoría" | Otras pestañas del legajo (fuera de zonas C-I) | `/legajos/:id` | 33ms | 115ms | 3 | 0 | No |
| Cambiar a pestaña "Régimen Laboral" | Otras pestañas del legajo (fuera de zonas C-I) | `/legajos/:id` | 11ms | 94ms | 0 | 0 | No |
| Volver al listado | A. Listado | `/legajos/:id` | 57ms | 139ms | 3 | 0 | No |

## 6. Acciones no cubiertas y motivo

Ninguna — todas las acciones planificadas se ejercitaron.

## 7. Top 10 acciones más lentas

| Acción | Zona | Visible | Network idle | Rango |
|---|---|---|---|---|
| Login (acceso rápido RRHH) | Login | 493ms | 5101ms | Crítico |
| Abrir primer legajo disponible | B. Detalle | 838ms | 4532ms | Crítico |
| Entrar a /legajos | A. Listado | 74ms | 3504ms | Crítico |
| Revelar historial de Empresa (ya precargado) | E. Datos laborales | 2810ms | 2893ms | Lento |
| Abrir historial de Domicilio actual | D. Contacto y domicilio | 1818ms | 1902ms | Medio |
| Abrir historial de Encargado directo actual | F. Responsables/Asignaciones | 1799ms | 1881ms | Medio |
| Abrir historial de Conceptos horarios adicionales | H. Configuración | 1300ms | 1383ms | Medio |
| Abrir historial de Transporte actual | G. Transporte | 807ms | 890ms | OK |
| Abrir historial de Responsable de carga horaria actual | F. Responsables/Asignaciones | 800ms | 882ms | OK |
| Buscar empleado por texto | A. Listado | 21ms | 424ms | OK |

## 8. Top 10 requests más lentas

| Método | Path | Status | Duración |
|---|---|---|---|
| GET | `/api/employees/:id/position-validation` | 200 | 12825ms |
| GET | `/api/employees/:id/position-validation` | 200 | 7130ms |
| GET | `/api/employees/:id/overview-details` | 200 | 3956ms |
| GET | `/api/employees/:id/overview-details` | 200 | 3777ms |
| GET | `/api/positions` | 200 | 3091ms |
| GET | `/api/employees/:id/field-history` | 200 | 2980ms |
| GET | `/api/employees/:id/field-history` | 200 | 2751ms |
| GET | `/api/employees/:id/field-history` | 200 | 2728ms |
| GET | `/api/dashboard/metrics` | 200 | 2723ms |
| GET | `/api/employees/:id/field-history` | 200 | 2680ms |

## 9. Endpoints repetidos (misma acción o distintas)

| Endpoint | Llamadas totales |
|---|---|
| `GET /api/employees/:id/field-history` | 16 |
| `GET /api/employees/:id/block-history` | 10 |
| `GET /api/workforce/notifications-unread-count` | 6 |
| `GET /api/audit` | 3 |
| `GET /api/employees` | 3 |
| `GET /api/employees/:id/overview` | 2 |
| `GET /api/employees/:id/overview-details` | 2 |
| `GET /api/employees/:id/position-validation` | 2 |
| `GET /api/documents` | 2 |
| `GET /api/workforce/shift-templates` | 2 |

## 10. Dónde se blanquea pantalla

- **Cambiar a pestaña "Contacto y Domicilio"** (D. Contacto y domicilio)
- **Revelar historial de Empresa (ya precargado)** (E. Datos laborales)
- **Revelar historial de Centro de costo (ya precargado)** (E. Datos laborales)
- **Revelar historial de Sector (ya precargado)** (E. Datos laborales)
- **Revelar historial de Puesto (ya precargado)** (E. Datos laborales)
- **Revelar historial de Categoría de recibo (ya precargado)** (E. Datos laborales)
- **Revelar historial de Categoría interna (ya precargado)** (E. Datos laborales)
- **Revelar historial de Convenio (ya precargado)** (E. Datos laborales)
- **Revelar historial de Obra Social (ya precargado)** (E. Datos laborales)
- **Abrir historial de Encargado directo actual** (F. Responsables/Asignaciones)
- **Abrir historial de Responsable de carga horaria actual** (F. Responsables/Asignaciones)
- **Abrir historial de Transporte actual** (G. Transporte)
- **Abrir historial de Conceptos horarios adicionales** (H. Configuración)
- **Cambiar a pestaña "Ausentismo / Novedades"** (Otras pestañas del legajo (fuera de zonas C-I))
- **Cambiar a pestaña "Gestión Documental"** (I. Adjuntos/Documentos)
- **Cambiar a pestaña "Turnos"** (Otras pestañas del legajo (fuera de zonas C-I))
- **Cambiar a pestaña "Régimen Laboral"** (Otras pestañas del legajo (fuera de zonas C-I))

## 11. Dónde hay loading global

Ninguno detectado — el único loading de página completa del proyecto es el `<Suspense>` de code-splitting entre rutas (`App.tsx`), no algo propio de una acción dentro de Legajos.

## 12. Dónde hay loading localizado

- **Abrir historial de Domicilio actual** (D. Contacto y domicilio)
- **Abrir historial de Encargado directo actual** (F. Responsables/Asignaciones)
- **Abrir historial de Responsable de carga horaria actual** (F. Responsables/Asignaciones)
- **Abrir historial de Transporte actual** (G. Transporte)
- **Abrir historial de Conceptos horarios adicionales** (H. Configuración)

## 13. Qué historiales se midieron

- **Abrir historial de Domicilio actual** (D. Contacto y domicilio) — visible 1818ms, 2 request(s).
- **Cerrar historial de Domicilio actual** (D. Contacto y domicilio) — visible 27ms, 0 request(s).
- **Revelar historial de Empresa (ya precargado)** (E. Datos laborales) — visible 2810ms, 17 request(s).
- **Revelar historial de Centro de costo (ya precargado)** (E. Datos laborales) — visible 19ms, 0 request(s).
- **Revelar historial de Sector (ya precargado)** (E. Datos laborales) — visible 25ms, 0 request(s).
- **Revelar historial de Puesto (ya precargado)** (E. Datos laborales) — visible 26ms, 0 request(s).
- **Revelar historial de Categoría de recibo (ya precargado)** (E. Datos laborales) — visible 36ms, 0 request(s).
- **Revelar historial de Categoría interna (ya precargado)** (E. Datos laborales) — visible 12ms, 0 request(s).
- **Revelar historial de Convenio (ya precargado)** (E. Datos laborales) — visible 26ms, 0 request(s).
- **Revelar historial de Obra Social (ya precargado)** (E. Datos laborales) — visible 24ms, 0 request(s).
- **Abrir historial de Encargado directo actual** (F. Responsables/Asignaciones) — visible 1799ms, 3 request(s).
- **Cerrar historial de Encargado directo actual** (F. Responsables/Asignaciones) — visible 23ms, 0 request(s).
- **Abrir historial de Responsable de carga horaria actual** (F. Responsables/Asignaciones) — visible 800ms, 2 request(s).
- **Cerrar historial de Responsable de carga horaria actual** (F. Responsables/Asignaciones) — visible 10ms, 0 request(s).
- **Abrir historial de Transporte actual** (G. Transporte) — visible 807ms, 2 request(s).
- **Cerrar historial de Transporte actual** (G. Transporte) — visible 30ms, 1 request(s).
- **Abrir historial de Conceptos horarios adicionales** (H. Configuración) — visible 1300ms, 3 request(s).
- **Cerrar historial de Conceptos horarios adicionales** (H. Configuración) — visible 31ms, 0 request(s).

## 14. Qué guardados se pudieron medir

Ninguno — modo `read-only` (ver §3/§15). Se midió la apertura de los modales de edición (sin guardar) donde existen; ver acciones "Abrir edición de ..." en §5.

## 15. Qué guardados quedaron pendientes

Ver fila "J. Guardados" de la matriz (§4) y el punto 9 de la matriz de este documento — los 8 endpoints de guardado del módulo quedan documentados como pendientes, no medidos esta etapa.

## 16. Recomendaciones para próxima etapa de optimización

- 3 endpoint(s) en rango Crítico detectados en este recorrido, priorizar antes de cualquier otra optimización:
  - `GET /api/employees/:id/position-validation` — máx 12825ms, promedio 9978ms, 2 llamada(s) en este recorrido.
  - `GET /api/employees/:id/overview-details` — máx 3956ms, promedio 3867ms, 2 llamada(s) en este recorrido.
  - `GET /api/positions` — máx 3091ms, promedio 3091ms, 1 llamada(s) en este recorrido.
- Hallazgo de esta etapa (no medido antes con esta granularidad): visitar la pestaña "Datos Laborales" dispara **8 GET /employees/:id/field-history en paralelo** (empresa, sector, centro de costo, puesto, categoría de recibo, categoría interna, convenio, obra social) de forma automática, sin que el usuario haya pedido ver ningún historial — el botón 'Historial' de cada campo sólo revela un panel ya cargado. Esto es distinto del patrón de Domicilio/Responsables/Transporte/Configuración (lazy, sólo al hacer click en 'Ver historial'). Candidato directo para una etapa de optimización dedicada: evaluar diferir esos 8 fetches a que el usuario abra cada 'Historial' individualmente, como ya funciona en los bloques lazy.
- Cruzar los endpoints Crítico/Lento de este journey contra los logs reales de la Etapa 14B.2 (`slow:true`/`error:true`) antes de decidir la causa — este es un recorrido puntual de un solo usuario, sin concurrencia.

## 17. Riesgos

- Journey de un solo usuario, sin concurrencia — no reemplaza logs de producción/staging bajo uso real.
- Datos reales del entorno de staging (Neon): la disponibilidad de una segunda página, catálogo de empresas, legajos con historial no vacío, etc. varía según el estado real de la base — algunas acciones pueden quedar salteadas en una corrida y cubiertas en otra, sin que eso sea un bug del journey.
- `visibleMs`/`networkIdleMs` son proxies aproximados (mismo criterio que 14B.3), no mediciones exactas de percepción de usuario.
- Ninguna escritura se ejecutó — los tiempos de guardado reales (Zona J) siguen sin medición en vivo, documentados como pendientes.

## 18. Validaciones ejecutadas

Ver docs/decisions correspondiente a esta etapa para el detalle completo de comandos corridos (`npx prisma validate`, `typecheck`, `test`, `build` en backend y frontend, `git diff --check`).

## Ambiente

- Generado: 2026-09-04T11:39:59.153Z
- Frontend: http://localhost:5174
- Backend: http://localhost:4002/api
- Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.
- Usuario: Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)
- Comando: `npm run perf:journey:employees (desde frontend/)`
