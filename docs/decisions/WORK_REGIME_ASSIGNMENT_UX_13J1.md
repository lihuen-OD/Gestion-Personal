# Etapa 13J.1 — Pulido profesional de UX para asignación de Régimen Laboral

Fecha: 2026-09-02
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/WORK_REGIME_ASSIGNMENT_CONSISTENCY_13J.md` (funcionalidad de la Etapa 13J, sin cambios en esta etapa)
Alcance: frontend/UX de la asignación de Régimen Laboral (`WorkRegimesPage.tsx`, `AssociatedEmployeesPanel.tsx`, `EmployeeRemoteSelector.tsx`, `Modal.tsx`, CSS asociado). Cero cambios de backend, de `schema.prisma`, de reglas funcionales de asignación, de fichadas, alertas, liquidación, Horas Especiales, Conceptos Horarios o grilla/export/bandeja.

## 1. Resumen ejecutivo

La Etapa 13J dejó la funcionalidad de asignación de régimen correcta (fuente de verdad única, filtro de vigencia, agregar/finalizar desde ambas pantallas), pero la UI quedó desprolija: "Agregar empleados" abría un `<Modal>` **dentro de otro `<Modal>`** (dos overlays oscuros encimados), la lista de legajos era una "caja dentro de caja" con demasiados bordes, el texto de ayuda salía en mayúsculas gritadas, la tabla de "Empleados asociados" tenía 9 columnas angostas que cortaban palabras a la mitad (`Administraci` / `on Central`), y la acción de baja era una X roja sin ningún contexto que se leía como "eliminar".

Se corrigió todo eso sin tocar una sola línea de backend ni de reglas funcionales: el modal "Agregar empleados" ahora es una **vista interna del mismo modal** (nunca un segundo overlay — verificado en vivo: `document.querySelectorAll(".modal-backdrop")` da `1` antes y después de abrirlo), la tabla bajó de 9 a 7 columnas (sin CUIL ni Estado, que no aportaban a esta pantalla), el modal se ensanchó de 960px a 1100px para esas columnas, el copy se revisó completo (sin mayúsculas, sin "Eliminar" para una acción que conserva historial), y la acción de baja pasó de un ícono X rojo a un ícono de calendario neutro con tooltip "Finalizar vigencia". Verificado en vivo contra la base real de staging con capturas de pantalla en 1440px, 1280px y 1024px. 20 tests frontend nuevos/reescritos, 496/496 verdes.

## 2. Problema visual detectado

1. **Modal sobre modal**: `AssociatedEmployeesPanel` (ya dentro del modal "Empleados asociados" de `WorkRegimesPage`) abría su propio `<Modal title="Agregar empleados">` al hacer clic en "Agregar empleados" — dos `.modal-backdrop` oscuros superpuestos.
2. **Modal "Agregar empleados"**: buscador y filtro de estado desalineados, texto "MOSTRANDO LOS PRIMEROS 20 LEGAJOS..." en mayúsculas (por una regla CSS `.people-search>small{text-transform:uppercase}` pensada para otra cosa, aplicada sin querer a los 4 textos de ayuda del buscador), filas de resultados con su propio borde+radio+fondo blanco DENTRO de un contenedor que ya tenía su propio borde+sombra ("caja dentro de caja"), checkboxes de 20px con borde fino apenas visibles, botón "Agregar seleccionados" deshabilitado sin ninguna explicación visible.
3. **Modal "Empleados asociados"**: tabla de 9 columnas (Legajo/Empleado/CUIL/Sector/Centro de costo/Empresa/Estado/Vigencia/Acciones) en un modal de 960px — "Administracion Central" se cortaba a la mitad por `overflow-wrap:anywhere` (regla genérica de `.table-shell`, correcta como red de seguridad pero fea cuando el problema real es demasiadas columnas angostas); acción de baja = ícono `X` rojo (`danger-link`) sin tooltip descriptivo más allá del título nativo del navegador; vigencia mostrada como "01/09/2026 — -" en una sola línea.
4. **Copy**: técnico/brusco en varios lugares ("Mostrando los primeros 20 legajos", mayúsculas, "Quitar todas", "Sin legajos seleccionados").

## 3. Diagnóstico (Parte 1 del pedido, con evidencia)

1. **Estructura del modal de empleados asociados**: `WorkRegimesPage.tsx` renderiza un único `<Modal>` que contiene `<AssociatedEmployeesPanel>` (filtros + tabla + paginación).
2. **Estructura del modal de agregar empleados (antes)**: `AssociatedEmployeesPanel` mantenía su propio estado `addOpen` y, al activarse, renderizaba un **segundo** `<Modal title="Agregar empleados">` — confirmado leyendo el componente completo antes de tocar nada.
3. **¿Modal sobre modal?**: sí, confirmado en el código (dos `<Modal>` anidados) y confirmado visualmente antes de la corrección.
4. **¿Conviene modal anidado, panel interno, drawer, paso dentro del mismo modal o vista expandida?**: se evaluaron las 3 opciones sugeridas. Se eligió la **Opción A (vista interna dentro del mismo modal)** — ver §4 (Decisión UX).
5. **Cómo se renderiza la tabla**: `<TableShell minWidth={880}><table>...</table></TableShell>`, con CSS genérico `.table-shell>table tbody td{white-space:normal;overflow-wrap:anywhere}` — SIEMPRE permite cortar palabras si la columna no entra, en vez de scroll horizontal, cuando el ancho de columna calculado es menor al de la palabra más larga.
6. **Por qué se cortan textos de columnas**: 9 columnas angostas en un modal de 960px — ninguna columna individual tenía espacio para "Administracion Central" sin partirse. No era un bug de la regla CSS (que es una red de seguridad genérica y correcta para evitar overflow horizontal descontrolado en cualquier tabla del proyecto) sino de **demasiadas columnas** en esta pantalla puntual.
7. **Cómo se manejan las acciones de finalizar vigencia**: botón `<button className="table-icon-action danger-link"><X/></button>` — mismo patrón visual que usa `HourConceptsPage` para "Eliminar" (borrado real, sin historial) y que `EmployeeWorkRegimePanel.tsx` (Legajo) usa para "Cerrar vigencia" — la semántica de color rojo="destructivo" es correcta para el primer caso, no para los otros dos.
8. **Cómo se muestra la selección de empleados**: `EmployeeRemoteSelector` ya tenía contador ("X persona(s) seleccionada(s)") y estado vacío ("Sin legajos seleccionados.") — la mecánica ya existía, sólo el copy y el estilo necesitaban ajuste.
9. **Cómo se muestran los estados empty/loading/error**: genéricos y correctos en su mecánica (`EmptyState`/`LoadingState`/`ErrorState`), pero el texto vacío no distinguía "no hay vigentes" de "no encontramos nada con esos filtros" (mismo string fijo para los dos casos).
10. **Comportamiento en pantallas chicas**: sin problemas de overflow horizontal (el `.filters` y el `.people-search-toolbar` ya envuelven en `flex-wrap`/`grid` responsive existente), pero con las 9 columnas + modal de 960px el corte de palabras empeoraba visualmente cuanto más angosta la ventana.
11. **Tests frontend existentes**: `WorkRegimesPage.associatedEmployees.test.tsx` (10 tests, de la Etapa 13J) cubría la lógica de filtro/agregar/finalizar pero ninguno verificaba la ausencia de modal-sobre-modal, el copy exacto, ni los nuevos estados de la vista de agregar — se reescribió y amplió a 20 tests (ver §9).

## 4. Decisión UX tomada

**Opción A — vista interna dentro del mismo modal**, la recomendada por el pedido. Se descartaron:
- **Drawer lateral (Opción B)**: no existe ningún patrón de drawer en el proyecto (`grep -r "drawer"` sin resultados) — habría que inventar un mecanismo de overlay nuevo, contra la regla explícita de "no inventar estilos aislados si ya hay clases existentes".
- **Modal único reemplazando el anterior (Opción C)**: cierra/reabre el modal, con el parpadeo visual que eso implica, y pierde el estado de filtros de la lista sin necesidad.

La Opción A se implementó extendiendo `AssociatedEmployeesPanel` (ya usado por `WorkRegimesPage` y `HourConceptsPage`) con un prop `addMode?: "modal" | "inline"` (default `"modal"`, **sin cambios para HourConceptsPage**, que no está anidado dentro de otro modal y para el que el modal propio sigue siendo correcto). Con `addMode="inline"` (usado sólo por `WorkRegimesPage`), el panel reemplaza su contenido completo por el formulario de alta en el mismo lugar — mismo estado (`selected`, `addOpen`), mismo `EmployeeRemoteSelector`, sin abrir un segundo `<Modal>`. Un callback `onAddModeChange` avisa a `WorkRegimesPage` para que el `<Modal>` exterior cambie su título/subtítulo (nuevo prop `subtitle` en `Modal.tsx`, reutilizable por cualquier otro modal del proyecto que lo necesite).

## 5. Cambios en "Empleados asociados"

- **Header**: título `Empleados con régimen 01 - Agricultura` (antes "Empleados asociados a..."), subtítulo `Consultá empleados vigentes o históricos asociados a este régimen.` — vía el nuevo prop `subtitle` de `Modal`.
- **Acción "Agregar empleados"**: sin cambio de ubicación (ya estaba separada de los filtros, en su propia fila) — ahora abre la vista interna en vez de un segundo modal.
- **Filtros**: sin cambios de layout — búsqueda + sector + centro de costo + empresa + vigencia, alineados en la misma barra (`renderFilterExtra`, de la Etapa 13J).
- **Tabla**: bajó de 9 a 7 columnas — **se sacaron CUIL y Estado** (nuevos props `showCuilColumn`/`showEmployeeStatusColumn` en `AssociatedEmployeesPanel`, default `true` = sin cambios para `HourConceptsPage`; `WorkRegimesPage` los pasa en `false`). Quedan: Legajo, Empleado, Sector, Centro de costo, Empresa, Vigencia, Acciones — exactamente las columnas sugeridas por el pedido. El modal se ensanchó de 960px a 1100px (`.modal:has(.associated-employees-panel)`, mismo patrón ya usado para `.address-edit-layout`) para darles aire.
- **Vigencia**: badge + dos líneas ("Desde 01/09/2026" / "Hasta -") en vez de un rango en una sola línea.
- **Acción de baja**: ícono `CalendarOff` (calendario tachado, en vez de `X`), tono neutro (gris, azul en hover — igual que "Ver legajo", **no** rojo), tooltip/aria-label "Finalizar vigencia". Sólo visible en filas vigentes (`canRemove`, ya de la Etapa 13J).
- **Confirmación**: título "Finalizar asignación de régimen", texto "¿Querés finalizar la asignación de "{régimen}" para {empleado}? Esta acción cierra la vigencia del régimen a partir de hoy, pero conserva el historial.", botón "Finalizar vigencia" — nunca dice "Eliminar".
- **Empty states**: `No hay empleados vigentes con este régimen.` (filtro Vigentes, sin resultados) / `No hay empleados históricos con este régimen.` (filtro Históricos) / `Este régimen todavía no tiene empleados asociados.` (filtro Todos) / `No encontramos empleados con esos filtros.` (cuando el usuario tiene una búsqueda/sector/centro de costo/empresa activos) — antes era un único texto fijo para todos los casos. Nuevo prop genérico `emptyText: string | ((hasActiveFilters: boolean) => string)` en `AssociatedEmployeesPanel`.

## 6. Cambios en "Agregar empleados"

- **Sin modal sobre modal** — ver §4.
- **Header**: "Agregar empleados al régimen" / "Seleccioná los empleados que tendrán este régimen desde la fecha indicada." (título/subtítulo del `<Modal>` exterior, vía `onAddModeChange`).
- **Copy de "primeros 20"**: "Mostramos hasta 20 resultados. Usá el buscador para encontrar más empleados." (antes "Mostrando los primeros 20 legajos. Escribí para filtrar la lista.", en mayúsculas por la regla CSS §3.6).
- **Lista de resultados**: filas planas (sin borde ni fondo propio, sólo hover/selección) en vez de "caja dentro de caja"; checkbox refinado (18px, borde 1.5px, se llena de color primario + tilde blanco al seleccionar); cada fila ahora también muestra sector/empresa (si están cargados) y un badge de estado (Activo/Inactivo) — nuevo prop `showEmployeeDetails` en `EmployeeRemoteSelector` (opt-in, sólo lo usa `AssociatedEmployeesPanel`; los otros 4 usos del selector —Novedades, Documentos, Turnos, Reglas de carga horaria— quedan visualmente idénticos).
- **Selección**: contador "N empleado(s) seleccionado(s)" (antes "N persona(s) seleccionada(s)"), vacío "No hay empleados seleccionados." (antes "Sin legajos seleccionados."), "Seleccionar resultados visibles" (antes "Seleccionar resultados"), "Limpiar selección" (antes "Quitar todas").
- **Vigencia desde**: label + helper "Fecha desde la cual este régimen queda activo para los empleados seleccionados." (antes sin ningún texto de ayuda).
- **Botón deshabilitado con motivo visible**: "Seleccioná al menos un empleado para continuar." (sin selección) o el hint de `addExtraDisabledHint` ("Indicá la fecha de vigencia desde para continuar.", si falta la fecha) — nunca queda apagado sin explicación. Nuevos props `addExtraDisabled`/`addExtraDisabledHint`.
- **Volver**: el botón "Cancelar" pasa a decir "Volver a empleados asociados" en modo `inline` (mismo botón, label condicional por `addMode`).

## 7. Copy final usado

| Elemento | Antes | Ahora |
|---|---|---|
| Título modal lista | "Empleados asociados a 01 - Agricultura" | "Empleados con régimen 01 - Agricultura" |
| Subtítulo modal lista | (no existía) | "Consultá empleados vigentes o históricos asociados a este régimen." |
| Título modal/vista agregar | "Agregar empleados" | "Agregar empleados al régimen" |
| Subtítulo vista agregar | (no existía) | "Seleccioná los empleados que tendrán este régimen desde la fecha indicada." |
| Hint "primeros 20" | "Mostrando los primeros 20 legajos. Escribí para filtrar la lista." (mayúsculas por CSS) | "Mostramos hasta 20 resultados. Usá el buscador para encontrar más empleados." |
| Selección vacía | "Sin legajos seleccionados." | "No hay empleados seleccionados." |
| Contador | "N persona(s) seleccionada(s)" | "N empleado(s) seleccionado(s)" |
| Seleccionar todo lo visible | "Seleccionar resultados" | "Seleccionar resultados visibles" |
| Limpiar selección | "Quitar todas" | "Limpiar selección" |
| Vigencia desde (helper) | (no existía) | "Fecha desde la cual este régimen queda activo para los empleados seleccionados." |
| Botón deshabilitado (hint) | (no existía) | "Seleccioná al menos un empleado para continuar." / "Indicá la fecha de vigencia desde para continuar." |
| Acción de baja | "Finalizar asignación" (ícono X rojo) | "Finalizar vigencia" (ícono calendario tachado, neutro) |
| Confirmación — título | "Finalizar asignación" | "Finalizar asignación de régimen" |
| Confirmación — texto | "¿Querés finalizar la vigencia de "X" para Y a partir de hoy (fecha)? Se conserva el historial." | "¿Querés finalizar la asignación de "X" para Y? Esta acción cierra la vigencia del régimen a partir de hoy, pero conserva el historial." |
| Empty (vigentes) | "Este régimen todavía no tiene empleados asociados con este filtro de vigencia." | "No hay empleados vigentes con este régimen." |
| Empty (históricos) | ídem | "No hay empleados históricos con este régimen." |
| Empty (todos) | ídem | "Este régimen todavía no tiene empleados asociados." |
| Empty (filtros de búsqueda) | ídem | "No encontramos empleados con esos filtros." |

## 8. Responsive

Validado en vivo (capturas reales, no sólo revisión de CSS) en:
- **1440px**: layout completo, sin cortes de texto, filtros en una sola fila.
- **1280px**: idéntico, sin overflow horizontal.
- **1024px**: filtros envuelven a dos filas (comportamiento ya existente de `.filters`/`.people-search-toolbar`, sin tocar); la tabla sigue sin scroll horizontal; "Administracion Central" vuelve a partirse a la mitad dentro de su propia celda en este ancho puntual (columna angosta + palabra larga) — mejor que antes (7 columnas en vez de 9, menos frecuente) pero no eliminado del todo a este ancho. Documentado como riesgo pendiente (§12), no resuelto en esta etapa para no tocar la regla genérica `.table-shell` (afecta a todas las tablas del proyecto) ni inventar anchos fijos por columna sin pedido explícito.
- Mobile: no se validó (la app no tiene un layout mobile dedicado para pantallas de configuración/administración — mismo criterio que el resto del proyecto, fuera del alcance de esta etapa).

## 9. Tests frontend

`frontend/src/pages/WorkRegimesPage.associatedEmployees.test.tsx` reescrito: **20 tests** (antes 10), todos verdes. Cubre los 19 puntos pedidos en la Parte 7:

1. Título/subtítulo del modal de empleados asociados.
2. Default = vigentes (`status=current`).
3. Filtro Históricos (`status=historical`) y Todos (`status=all`) refetchean correctamente.
4. Badge "Vigente" nunca aparece junto con "Histórica" bajo el mismo filtro.
5. **"Agregar empleados" no abre un segundo overlay** — `document.querySelectorAll(".modal-backdrop")` y `.modal` dan `1` antes y después.
6. La vista de agregar muestra el buscador y el filtro de Estado.
7. El copy "Mostramos hasta 20 resultados..." está visible.
8. Seleccionar empleados incrementa el contador (1 → 2).
9. "Agregar seleccionados" arranca deshabilitado con el motivo visible, se habilita al seleccionar.
10. "Limpiar selección" vacía la selección y el contador.
11. "Vigencia desde" visible con su texto de ayuda.
12. Agregar empleado llama a `assign` con el mismo endpoint que usa el Legajo, y vuelve a la vista de lista.
13. "Finalizar vigencia" pide confirmación — se verificó el título/texto/botón exactos pasados a `confirmAction`.
14. Confirmar la baja llama a `closeAssignment` con `employeeId`/`assignmentId`/fecha de hoy.
15. Nunca aparece el texto "Eliminar" ni un botón "Quitar".
16. Empty state de vigentes con el texto específico.
17. Empty state por filtros de búsqueda con un texto distinto al de "sin vigentes".
18. El copy de "primeros 20" no está en mayúsculas (se compara contra su propia versión `.toUpperCase()`).
19. Loading state (skeleton) y error state (mensaje, no listado vacío silencioso) siguen funcionando.

Además: "Desde"/"Hasta" en dos líneas, "Volver a empleados asociados" regresa a la lista.

Suite completa frontend: **496/496 verdes** (58 archivos) — sin regresiones en `WorkRegimesPage.test.tsx`, `WorkRegimesPage.filters.test.ts`, `AssociatedEmployeesPanel.helpers.test.ts`, `EmployeeRemoteSelector.test.ts`, `HourConceptsPage.copy.test.ts`/`.filters.test.ts`, `EmployeeWorkRegimePanel.test.ts`.

## 10. Validación visual

Se pudo usar el navegador real (Playwright headless contra los mismos `npm run dev` de backend/frontend levantados para la Etapa 13J, reutilizando la sesión RRHH ya autenticada contra la base real de staging). Se documentaron con capturas:

1. Modal "Empleados asociados" (título/subtítulo, tabla de 7 columnas, "Administracion Central" sin cortarse, badges Vigente/Histórica, vigencia en dos líneas).
2. Vista "Agregar empleados" (buscador, filtro de Estado, hint "Mostramos hasta 20...", "No hay empleados seleccionados.", "Vigencia desde" con su helper, botón deshabilitado con el motivo visible).
3. Tabla con datos reales (régimen "01 - Agricultura" del propio caso reportado en la Etapa 13J).
4. Filtros (Vigentes/Históricos/Todos, sector/centro de costo/empresa con datos reales del catálogo).
5. Selección (checkbox relleno, fila resaltada, contador "1 empleado seleccionado", botón habilitado).
6. Confirmación de finalizar vigencia: verificada mediante el test unitario (`confirmAction` llamado con título/texto/botón exactos) — el diálogo en sí es un mecanismo genérico ya existente en el proyecto (`services/appDialog.ts`, usado por decenas de acciones), no se modificó su render; no se logró capturarlo a tiempo en una screenshot puntual por la naturaleza asíncrona del evento, sin impacto en la validación (cubierto igual por el test).
7. Responsive básico en 1440px/1280px/1024px (ver §8).
8. **Confirmado sin dos modales encimados** — `document.querySelectorAll(".modal-backdrop")` = 1 en todo momento, verificado tanto en el test automatizado como en el script de Playwright real.
9. **Sin errores de consola** — `page.on("console"/"pageerror")` no capturó ningún error durante toda la navegación (login, listado, modal, filtros, agregar, buscar, seleccionar).

## 11. Qué NO se tocó

- Backend: ningún archivo de `backend/src` fue modificado en esta etapa.
- `schema.prisma`: sin cambios, sin migraciones.
- Reglas funcionales de asignación de régimen: mismos endpoints, misma validación de solapamiento, mismo comportamiento de `resolveActiveWorkRegime` — sólo cambió cómo se presenta.
- Fichadas, alertas de turnos, liquidación, Horas Especiales, Conceptos Horarios, grilla/export/bandeja, asignaciones de feriado.
- `EmployeeWorkRegimePanel.tsx` (Legajo): no está en el alcance pedido (que lista sólo `WorkRegimesPage.tsx` y sus modales) — su acción "Cerrar vigencia" sigue con ícono `X` y tono rojo, igual que antes de esta etapa (ver Riesgos, §12).
- Los otros 4 usos de `EmployeeRemoteSelector` (Novedades, Documentos, Turnos, Reglas de carga horaria): sin cambios visuales — el nuevo detalle por fila es opt-in (`showEmployeeDetails`) y sólo lo activa `AssociatedEmployeesPanel`.
- `HourConceptsPage.tsx`: sin cambios de comportamiento — todos los nuevos props de `AssociatedEmployeesPanel` tienen default idéntico al comportamiento previo (`addMode="modal"`, `showCuilColumn`/`showEmployeeStatusColumn=true`, `removeActionTone="danger"`).

## 12. Riesgos pendientes

- **Inconsistencia visual Legajo vs. Régimen Laboral**: la acción "Cerrar vigencia" del Legajo (`EmployeeWorkRegimePanel.tsx`) sigue usando ícono `X` rojo, mientras que la misma acción conceptual en Régimen Laboral ahora usa `CalendarOff` neutro. No se tocó porque el pedido acota el alcance a `WorkRegimesPage.tsx` y sus modales — queda como mejora sugerida para una etapa futura si se quiere alinear también el Legajo.
- **Corte de palabra residual a 1024px**: "Administracion Central" (y textos igual de largos) puede seguir partiéndose a la mitad en viewports angostos, aunque con mucha menos frecuencia que antes (7 columnas en vez de 9, modal más ancho). No se tocó la regla genérica `.table-shell>table tbody td{overflow-wrap:anywhere}` (afecta a todas las tablas del proyecto) ni se fijaron anchos por columna, para no exceder el alcance pedido.
- **"Agregar empleados" no es atómico entre varios seleccionados a la vez**: ya documentado en la Etapa 13J (`Promise.all` por empleado) — sin cambios en esta etapa, fuera de alcance (UX, no lógica).
- **Sin captura de pantalla del diálogo de confirmación**: cubierto por test unitario en su lugar (ver §10, punto 6) — es un mecanismo genérico y no nuevo, riesgo bajo.

---

No se tocó backend, `schema.prisma`, fichador, alertas, liquidación, Horas Especiales, Conceptos Horarios, grilla/export/bandeja, asignaciones de feriado, ni reglas funcionales de asignación de régimen. No commitear sin aprobación explícita del usuario.
