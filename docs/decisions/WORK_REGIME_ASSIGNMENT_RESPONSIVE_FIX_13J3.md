# Etapa 13J.3 — Rediseño responsive y corrección de bugs reales del módulo "Empleados con régimen"

Fecha: 2026-09-03
Estado: implementado, validado en vivo contra backend real, pendiente de aprobación para commitear
Continúa: `docs/decisions/WORK_REGIME_ASSIGNMENT_UX_13J1.md`, `docs/decisions/WORK_REGIME_ASSIGNMENT_UX_13J2.md`
Alcance: frontend únicamente. No se tocó ningún archivo backend en esta etapa — los dos bugs reales ("Finalizar vigencia no funciona" y "modal detrás") eran 100% de frontend (diagnóstico completo en §3).

## 1. Resumen ejecutivo

Se reportaron tres problemas en uso real: mobile roto, "Finalizar vigencia" que no parecía funcionar, y el modal de confirmación apareciendo detrás del modal principal. El diagnóstico encontró que los dos últimos eran **la misma causa**: `AppDialogHost` (el componente que renderiza cualquier `confirmAction()` de toda la app) se monta en `main.tsx` antes que `<App/>`, y sin portal, su `<Modal>` cae en ese lugar del árbol — como comparte el mismo `z-index` (80) que cualquier otro `.modal-backdrop`, el modal que ya estaba abierto (el de "Empleados con régimen", montado después) le ganaba el empate por orden de aparición en el DOM y lo tapaba: el usuario no podía ver ni tocar "Finalizar vigencia" en la confirmación real, así que la acción nunca llegaba a ejecutarse. El roto de mobile tuvo una causa distinta y más sutil: una regla CSS de la Etapa 13J.1 (`.modal:has(.associated-employees-panel){width:...}`) quedó ubicada, en el archivo, **después** de las media queries que debían acotarla en mobile — con la misma especificidad e `!important`, ganaba el empate por orden de aparición sin importar si su propia media query aplicaba, calculando un modal de ~100px de ancho en un celular real. Se corrigieron ambos, más dos bugs CSS latentes descubiertos en el camino (`.form-wide` rompiendo el layout de "Agregar empleados", y `.people-search-toolbar` con una regla mobile que nunca tuvo efecto), y se agregó una vista de cards para mobile (la tabla de 7 columnas no entra en un modal angosto). Todo verificado en vivo, con Playwright, contra el backend real de staging, en 5 anchos (1440/1280/768/430/390) — sin scroll horizontal, sin errores de consola, con un ciclo real de asignar→ver vigente→finalizar→ver histórico completado contra la base de datos real.

## 2. Problemas reales observados (tal como se reportaron)

1. Mobile roto: título cortado, filtros desbordados, tabla ilegible, botón "Agregar empleados" cortado.
2. "Finalizar vigencia" parecía no hacer nada.
3. El modal/cartel de confirmación aparecía detrás del modal principal.

## 3. Diagnóstico técnico (con evidencia)

1. **Modal "Empleados con régimen"**: `WorkRegimesPage.tsx` → `<Modal>` (`components/ui/Modal.tsx`) envolviendo `<AssociatedEmployeesPanel variant="full">`.
2. **Vista "Agregar empleados"**: el mismo `AssociatedEmployeesPanel`, en modo `addMode="inline"` (Etapa 13J.1) — reemplaza el contenido del panel dentro del mismo `<Modal>`, nunca abre uno nuevo.
3. **Acción "Finalizar vigencia"**: botón en la tabla (o, desde esta etapa, en la card) → `removeItem()` en `AssociatedEmployeesPanel.tsx` → `confirmAction(...)` (`services/appDialog.ts`, dispara un `CustomEvent` global) → si se confirma, `onRemoveEmployee(item)` → en `WorkRegimesPage.tsx`, `workRegimeApiService.closeAssignment(employeeId, assignmentId, hoy)`.
4. **API que se llama**: `PATCH /employees/:employeeId/work-regimes/:assignmentId/close` — la misma que ya usa el Legajo (Etapa 13J), sin cambios de contrato.
5. **¿La API responde correctamente?**: sí — probado en vivo contra el backend real (§10): el `PATCH` se ejecuta, la fila se cierra (`effectiveTo` seteado), nunca se borra.
6. **¿El problema estaba en el handler frontend?**: no en la lógica en sí (`onRemoveEmployee`/`closeAssignment` ya estaban bien desde la Etapa 13J) — el problema era que el usuario **nunca llegaba a poder confirmar**, por el punto 11-13.
7. **¿Invalidación/refetch?**: correcto — `reload()` incrementa `retry`, el `useEffect` de fetch depende de `retry`, se vuelve a pedir la lista con el mismo filtro de vigencia activo.
8. **¿El problema estaba en el backend?**: no. Ningún archivo de `backend/src` fue tocado ni necesitó cambios.
9. **¿El empleado queda finalizado en base pero no se actualiza la UI?**: no era el caso — el problema era anterior: la confirmación ni se podía tocar.
10. **¿El empleado ni siquiera se finaliza?**: correcto, ese era el síntoma — porque la confirmación (tapada) nunca se podía aceptar.
11. **¿Qué modal/dialog se usa para confirmar?**: `AppDialogHost.tsx` (`components/ui/AppDialogHost.tsx`), montado una única vez en `main.tsx`, escucha un evento global (`APP_DIALOG_EVENT`) que dispara `confirmAction()`/`promptAction()` desde cualquier parte de la app, y renderiza su propio `<Modal>`.
12. **¿Por qué la confirmación aparecía detrás?**: `main.tsx` monta `<AppDialogHost/>` **antes** que `<App/>`:
    ```tsx
    <AuthProvider>
      <ApiErrorNotice />
      <AppDialogHost />   {/* ← acá */}
      <App />             {/* ← el modal de Régimen Laboral vive acá adentro */}
    </AuthProvider>
    ```
    Sin portal, el `<Modal>` de `AppDialogHost` renderiza en ESE lugar del árbol — un nodo del DOM que aparece **antes** que el de `<App/>`. Cuando dos elementos `position:fixed` (ambos `.modal-backdrop`) comparten el mismo `z-index` (80, ver `styles.css`, "Final modal centering pass"), gana visualmente el que está **después** en el DOM — en este caso, siempre el modal de la página (`<App/>`), sin importar que la confirmación se haya disparado después en el tiempo. El usuario veía el modal de "Empleados con régimen" tapando por completo a la confirmación real.
13. **¿`Modal` usa portal?**: no, nunca lo usó — renderiza `<div className="modal-backdrop">` en el lugar exacto del árbol de React donde se lo invoca. Es correcto para modales que se abren directamente desde una página (nunca hay otro modal abierto al mismo tiempo), pero se rompe en el único caso real de "modal dentro de modal": una confirmación disparada desde un modal ya abierto.
14. **z-index de modal principal/backdrop/confirmación**: los tres comparten el mismo `.modal-backdrop{z-index:80!important}` — no hay ninguna escala de capas (`--z-modal`, `--z-dialog`, etc.) en el proyecto; confirmado con `grep -n "z-index" styles.css` completo.
15. **Clases CSS que afectaban el ancho mobile**: `.modal:has(.associated-employees-panel){width:min(1100px,calc(100vw - var(--app-sidebar-width) - 48px))!important}` (Etapa 13J.1) — ubicada, en el archivo, **después** de las media queries de `@media(max-width:980px)`/`@media(max-width:640px)` que la Etapa 13J.1 ya había extendido para intentar acotarla. Con la misma especificidad de selector y el mismo `!important`, dos reglas empatan y gana la que aparece **más tarde en el archivo** — sin importar si su propia media query aplica al viewport actual. Confirmado en vivo (Playwright, 430px, antes del fix): el modal medía ~100px de ancho.
16. **Breakpoint "mobile" del proyecto**: `620px` es el que ya usa el resto de la app (`.filters` pasa a apilarse en una columna a `max-width:620px`, ver `WorkRegimesPage.filters`/`page-wrap`/etc.) — se reusó el mismo valor para las reglas nuevas, no se inventó uno propio.
17. **¿Patrón existente de "tabla → cards" en mobile?**: no existe en el proyecto (`grep` exhaustivo por `mobile-card`/`table-mobile`/`data-label`/`card-list` sin resultados) — se construyó uno nuevo, mínimo, específico de `AssociatedEmployeesPanel`, opt-in (§5).
18. **Tests que cubrían mobile antes de esta etapa**: ninguno — no había ningún test de layout/responsive para este módulo.
19. **Tests que cubrían "Finalizar vigencia" antes de esta etapa**: la Etapa 13J tenía un test que verificaba que `confirmAction` se llamaba con los argumentos correctos, pero con `confirmAction` **mockeado** — nunca ejercitaba el `AppDialogHost` real, así que nunca podía detectar el bug de superposición (§7).
20. **Validación visual real posible**: sí — backend y frontend de desarrollo ya corriendo (`localhost:4002`/`localhost:5174`), con datos reales de staging y usuario seed RRHH (`docs/LOCAL_DEVELOPMENT.md`). Se usó Playwright real (no un mock de navegador) en las 5 resoluciones pedidas.

### 3.1 Dos bugs adicionales encontrados en el camino (no reportados, pero bloqueaban el mismo objetivo)

- **`.form-wide{grid-column:span 2}`** (clase que `EmployeeRemoteSelector` se agrega a sí mismo por default, `wide=true`) fuerza a `.form-stack` (grid de 1 columna implícita) a crear 2 columnas implícitas para poder cumplir ese span — todo lo que viene después (el campo "Vigencia desde", su ayuda, el hint de deshabilitado, los botones) se repartía entre esas 2 columnas en vez de apilarse en una fila cada uno. En desktop se veía "raro pero pasable"; en mobile quedaba roto (texto partido, botones a mitad de ancho). Confirmado con `getComputedStyle` en vivo.
- **`.people-search-toolbar`** (buscador + filtro "Estado" de `EmployeeRemoteSelector`) es `display:grid`, pero su regla mobile (`@media(max-width:700px)`) decía `flex-direction:column` — una propiedad que no tiene ningún efecto sobre un contenedor grid. El buscador y el filtro de estado nunca se apilaban en mobile, en ninguno de los 6 lugares donde se usa `EmployeeRemoteSelector`.

## 4. Decisión UX

**Modal detrás de confirmación (Parte 7 del pedido)**: Opción A, portal — `createPortal(<Modal>...</Modal>, document.body)` en `AppDialogHost.tsx`. Es la opción más simple y consistente con el proyecto: no requiere una escala de z-index nueva (que no existe hoy, y crearla sólo para este caso sería un parche aislado, lo que el pedido pide evitar explícitamente), no requiere convertir la confirmación en un flujo inline dentro de cada panel que la use (rompería el patrón `confirmAction()` reusado en toda la app), y resuelve el problema de raíz para **cualquier** confirmación disparada desde dentro de un modal ya abierto, no sólo ésta.

**Mobile (Parte 2 del pedido)**: cards en vez de tabla, opt-in vía `enableMobileCards` (default `false` — cero cambio de comportamiento para quien no lo pide). Se evaluó (y se descartó) intentar que la tabla "entre" comprimiendo columnas — con 7 columnas y datos reales (nombres, sectores, centros de costo), no hay compresión razonable que la haga legible en ~360px de ancho útil.

## 5. Desktop

Sin cambios de fondo respecto a la Etapa 13J.2 (header, toolbar del botón, filtros, tabla de 7 columnas) — la única corrección fue devolverle al ancho del modal (`min(1100px,...)`) su ubicación correcta en la cascada (§3.15), y arreglar el layout de "Vigencia desde" en la vista de agregar (§3.1).

## 6. Tablet (768px)

Validado en vivo: el modal usa `min(960px,calc(100vw-40px))` (regla ya existente de la sección "Final modal centering pass", ahora correctamente aplicada también a este modal), los filtros se acomodan en 2-3 líneas dentro de su propio bloque con fondo, sin cortar texto, sin scroll horizontal de página. La tabla puede requerir scroll horizontal interno dentro de su propio contenedor (`.table-shell{overflow-x:auto}`, mecanismo ya existente) si el ancho es ajustado — comportamiento explícitamente aceptado por el pedido ("Tabla puede mantenerse si entra bien").

## 7. Mobile (430px / 390px)

- Modal full-screen: `width:100vw;height:100dvh` (no `100vh` — evita el corte por la barra de direcciones de navegadores móviles), sin `border-radius`, sin márgenes — sólo para este modal (`:has(.associated-employees-panel)`), el resto de los modales del proyecto no cambia.
- Header: título/subtítulo en su propio bloque, ya no se parte palabra por palabra (la causa real era el ancho de ~100px, no el propio texto — con el ancho corregido, el wrapping normal del navegador alcanza).
- Botón "Agregar empleados": ancho completo, alineado con los filtros (`.associated-employees-toolbar` pasa a `justify-content:stretch` bajo 620px).
- Filtros: apilados verticalmente, cada uno a ancho completo (mecanismo ya existente de `.filters` a `max-width:620px`, ahora visible porque el modal ya no mide ~100px).
- Lista: **cards**, no tabla — cada card muestra nombre completo, "Legajo N", Sector/Centro de costo/Empresa como filas etiqueta-valor, el badge de vigencia con Desde/Hasta debajo, y las acciones "Ver legajo"/"Finalizar vigencia" como botones con texto visible (reusando el componente `Button` ya existente, no iconos sueltos).
- Sin scroll horizontal de página en ningún ancho probado (1440/1280/768/430/390 — confirmado con `document.documentElement.scrollWidth === clientWidth` en los cinco).

## 8. Vista "Agregar empleados"

- Sin modal sobre modal (ya lo garantizaba la Etapa 13J.1, `addMode="inline"` — sin cambios de mecanismo, sólo se corrigió el layout interno).
- Buscador + filtro "Estado" ahora sí se apilan en mobile (fix de `.people-search-toolbar`, §3.1).
- "Vigencia desde" + su texto de ayuda: lado a lado en desktop/tablet, apilados en mobile (`.add-vigency-field`, nuevo, con su propio breakpoint a 620px) — antes quedaban descolocados por el bug de `.form-wide` (§3.1).
- El hint "Seleccioná al menos un empleado para continuar." y los botones "Volver a empleados asociados"/"Agregar seleccionados" ahora ocupan el ancho completo del formulario en vez de quedar encogidos a la mitad (mismo fix, beneficia también a Conceptos Horarios — ver §9).

## 9. Finalizar vigencia

Funcionalmente sin cambios respecto a la Etapa 13J (mismo endpoint, mismo copy) — se corrigió el bug de superposición (§3.12, §4) y se agregó lo que faltaba:
- **Guard contra doble click**: nuevo estado `removingId` en `AssociatedEmployeesPanel.tsx` — mientras hay una baja en curso, el botón de esa fila/card se deshabilita y muestra "Finalizando...", y `removeItem()` ignora clicks adicionales mientras `removingId` esté seteado.
- **Error visible**: ya existía (`notice` + `getUserErrorMessage`), verificado que sigue funcionando y que la fila no queda en un estado a medio camino (sigue "Vigente", el botón se re-habilita).
- Verificado en vivo contra el backend real (§10): asignar → aparece vigente → finalizar → confirmación visible y tocable → deja de estar vigente → aparece en históricos con el historial anterior intacto.

## 10. Validación visual real (Parte 10 del pedido)

Backend (`localhost:4002`) y frontend (`localhost:5174`) de desarrollo, ya corriendo, contra la base de datos real de staging (Neon) — login real como `admin@losod.local` (RRHH, seed de `docs/LOCAL_DEVELOPMENT.md`), régimen real "01 - Agricultura" (el mismo de las etapas anteriores).

- **1440 / 1280 / 768 / 430 / 390px**: capturas de pantalla reales del modal "Empleados con régimen" en cada ancho. `document.documentElement.scrollWidth === clientWidth` en los cinco (sin scroll horizontal).
- **Vista "Agregar empleados"**: capturada en 1440 y 390px, sin scroll horizontal.
- **Confirmación de "Finalizar vigencia"**: capturada VISIBLE y arriba del modal principal (el modal principal se ve atenuado/borroso detrás) — antes del fix, esta captura era imposible de lograr sin el portal.
- **Acción real contra backend**: no había empleados vigentes al momento de probar (el único vigente de la Etapa 13J.2, legajo 27/28, ya había rotado a histórico por el paso natural de los días entre etapas) — se reasignó legajo 28 desde la propia UI ("Agregar empleados", fecha de hoy), se confirmó que apareció como vigente, se finalizó su vigencia desde la UI con la confirmación real, y se confirmó por API (`GET /employees/:id/work-regimes`) que el empleado conserva **ambas** asignaciones históricas (la de la Etapa 13J.2 y la de esta prueba) — ninguna se borró:
  ```
  id=76f36934 from=2026-09-03 to=2026-09-03   (creada y cerrada en esta verificación)
  id=5e3860fb from=2026-09-01 to=2026-09-02   (de la Etapa 13J.2, intacta)
  ```
- **Consola del navegador**: sin errores en ninguno de los pasos (`page.on("pageerror")`/`page.on("console", type==="error")` — array vacío en toda la sesión).
- **Modal detrás**: confirmado que NO ocurre — `confirmHeading.closest(".modal-backdrop").parentElement === document.body` (portal) y el modal principal `.contains(confirmHeading) === false`.

## 11. Tests

**Nuevo**: `frontend/src/components/ui/AppDialogHost.test.tsx` (3 tests) — el diálogo real renderiza fuera de cualquier contenedor local (portal a `document.body`), confirmar resuelve `true`, cancelar resuelve `false`.

**Nuevo**: `frontend/src/pages/WorkRegimesPage.finalizeVigencyRealDialog.test.tsx` (2 tests) — end-to-end con el `AppDialogHost`/`confirmAction` **reales** (no mockeados, a diferencia del resto de los tests de esta pantalla): la confirmación se ve arriba del modal principal y confirmar llama a `closeAssignment`; cancelar no llama a la API.

**Ampliado**: `frontend/src/pages/WorkRegimesPage.associatedEmployees.test.tsx` (+7 tests, ahora 27) — cards de mobile (existen, muestran nombre/legajo/sector/centro de costo/empresa/vigencia, ofrecen "Ver legajo"/"Finalizar vigencia" con texto visible, "Agregar empleados" funciona igual), doble-click en "Finalizar vigencia" llama la API una sola vez y deshabilita el botón ("Finalizando..."), error al finalizar muestra mensaje sin dejar la fila inconsistente. Los tests ya existentes de la Etapa 13J.1/13J.2 se ajustaron para escopear las queries a tabla o cards por separado (`withinTable()`/`withinCards()`) — ahora que ambas vistas conviven en el DOM (CSS decide cuál se ve), un texto como "Vigente" aparece dos veces.

**Ampliado**: `frontend/src/pages/HourConceptsPage.copy.test.ts` (+1 test) — confirma que `HourConceptsPage.tsx` no activa `enableMobileCards`/`showCuilColumn`/`showEmployeeStatusColumn` en su uso de `AssociatedEmployeesPanel` (mismo patrón de test por código fuente que ya usa ese archivo, sin jsdom).

**No se agregaron tests de CSS Grid/layout** (el bug de `.form-wide`, el de `.people-search-toolbar`, el de la ubicación de la regla de ancho en la cascada) — jsdom no evalúa layout real (`getComputedStyle` en jsdom no calcula grids/flexbox), así que un test unitario no puede detectar ni proteger contra este tipo de bug. Se verificaron y quedan documentados exclusivamente por inspección visual en navegador real (§10) — es la limitación correcta a asumir, no un hueco de cobertura resoluble con más tests unitarios.

Suite completa: **509/509 verdes** (60 archivos). Typecheck y build sin errores.

## 12. Qué NO se tocó

- Backend: ningún archivo de `backend/src`. Ningún endpoint nuevo ni modificado.
- `schema.prisma`: sin cambios, sin migraciones.
- Fichador, alertas de turnos, liquidación, Horas Especiales, Conceptos Horarios, grilla/export/bandeja.
- Reglas funcionales de asignación de régimen (quién puede asignar/finalizar, qué fecha se usa, qué valida el backend) — sin cambios.
- El resto de los modales del proyecto (`Modal.tsx` en sí no se tocó — sólo se envolvió el `<Modal>` de `AppDialogHost` en un portal, en `AppDialogHost.tsx`) — ningún otro modal de la app cambia de comportamiento.
- La variante `embedded` de `AssociatedEmployeesPanel` (HourConceptsPage) — sin `enableMobileCards`, sigue exactamente igual (test dedicado, §11); el fix de `.form-wide`/`.people-search-toolbar` la beneficia (corrige un bug que también tenía) sin cambiar su estructura.

## 13. Riesgos pendientes

- **Portal + StrictMode**: `main.tsx` envuelve todo en `<React.StrictMode>`; `createPortal` es compatible y ya es el patrón estándar de React para este caso — sin riesgo conocido, pero es la primera vez que este proyecto usa un portal, documentado acá para quien lo encuentre después.
- **Un solo `z-index` global para modales**: el fix resuelve el caso real (confirmación sobre modal) mediante DOM order + portal, no agregando una escala de capas. Si en el futuro se necesitara apilar tres niveles (ej. confirmación sobre confirmación, hoy no ocurre en la app), este mecanismo seguiría funcionando por orden de montaje, pero sería el momento de evaluar una escala de z-index real en vez de seguir dependiendo del orden del DOM.
- **`.form-wide`/`.people-search-toolbar` sin auditoría completa de los otros 5 usos**: se verificó visualmente sólo `AssociatedEmployeesPanel` (el que motivó el hallazgo); `NoveltyModal`, `DocumentUploadModal`, `ShiftEmployeesPanel` y `WorkScheduleSettingsPage` deberían verse igual o mejor (el fix de `.people-search-toolbar` es un no-op-a-real, no puede empeorar nada), pero no se tomó una captura de cada uno — riesgo bajo, documentado por transparencia.
- **Datos reales de staging modificados**: la verificación en vivo (§10) asignó y finalizó una vigencia real para el empleado legajo 28 (régimen "01 - Agricultura"). No se borró nada (el historial completo queda intacto, ver §10) — es el mismo tipo de acción, reversible, que ya se había hecho en las etapas 13J/13J.2 para verificar el mismo flujo.

---

No se tocó backend, `schema.prisma`, fichador, alertas, liquidación, Horas Especiales, Conceptos Horarios, grilla/export/bandeja ni reglas funcionales de régimen laboral. No commitear sin aprobación explícita del usuario.
