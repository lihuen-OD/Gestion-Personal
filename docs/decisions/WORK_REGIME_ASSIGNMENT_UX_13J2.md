# Etapa 13J.2 — Reordenar botón "Agregar empleados" y filtros en modal de Régimen Laboral

Fecha: 2026-09-02
Estado: implementado, validado, pendiente de aprobación para commitear
Continúa: `docs/decisions/WORK_REGIME_ASSIGNMENT_UX_13J1.md` (pulido de UX general de este mismo modal, sin tocar el layout puntual corregido acá)
Alcance: corrección chica, exclusivamente visual/frontend, en `AssociatedEmployeesPanel.tsx` y `styles.css`. Cero cambios de backend, de `schema.prisma`, de reglas funcionales de régimen laboral, de fichador, alertas, liquidación, Horas Especiales o Conceptos Horarios.

## 1. Problema visual detectado

En el modal "Empleados con régimen 01 - Agricultura" (Etapa 13J.1), el botón "Agregar empleados" aparecía en una fila propia, separado y visualmente desconectado del bloque de filtros que quedaba justo debajo — la composición se sentía desalineada, con el botón "cortando" el flujo hacia la búsqueda/filtros.

## 2. Causa del layout desordenado

El wrapper del botón reusaba la clase genérica `.form-actions` (`className="form-actions inline-actions"`), pensada en todo el proyecto para la barra de **guardar/cancelar pegada abajo de un formulario**. Dentro de un modal (`.modal-body .form-actions`), esa clase trae:

```css
.modal-body .form-actions{
  position:sticky;
  bottom:-18px;
  margin:8px -18px -18px;
  padding:12px 18px;
  background:#fff;
  border-top:1px solid #edf0f4;
  z-index:2;
}
```

— `position:sticky;bottom:-18px` y márgenes negativos, exactamente lo contrario de lo que necesita un botón de acción **arriba** del panel. `.inline-actions` (otra clase ya existente, pensada para casos como éste) sólo pisaba `justify-content`/`padding`/`margin`, pero no alcanzaba a anular el `border-top`/`background`/posicionamiento sticky heredados de `.form-actions`, que se aplican por tener igual especificidad y venir después en el archivo. El resultado: un botón con un borde superior y un comportamiento de posicionamiento que no le correspondían, separado del resto por ese `padding`/`margin` ajenos a un header.

Confirmado que el problema es específico de esta instancia: la variante `embedded` (usada por `HourConceptsPage`, único otro consumidor de `AssociatedEmployeesPanel`) arma el botón dentro de `.block-card-head` con la clase `.tracked-actions` — no usa `.form-actions` en absoluto, así que nunca tuvo este problema y **no se tocó**.

## 3. Decisión UX tomada

**Alternativa aceptable** del pedido (la más simple y de menor riesgo dado que la corrección debía ser chica): primera fila con el botón alineado a la derecha, segunda fila con los filtros, con separación clara entre ambas — sin agregar texto de contexto a la izquierda (Opción A completa), para no sumar props/estado nuevos a un componente ya compartido por otra pantalla, cuando la alternativa simple ya resuelve el problema reportado por completo.

Se creó una clase dedicada, `.associated-employees-toolbar` (reemplaza a `"form-actions inline-actions"` sólo en la variante `full`, la que usa `WorkRegimesPage`):

```css
.associated-employees-toolbar{
  display:flex;
  justify-content:flex-end;
  align-items:center;
  gap:10px;
  margin:0 0 12px;
}
```

Sin `border-top`, sin `position:sticky`, sin heredar nada de la barra de guardar/cancelar — sólo una fila flex simple, alineada a la derecha, con un margen inferior claro antes del bloque de filtros (que ya tiene su propio fondo/borde redondeado como card, heredado sin cambios).

## 4. Antes/después del layout

**Antes**: `<div className="form-actions inline-actions"><Button>Agregar empleados</Button></div>` — botón con `border-top`, `padding`/`margin` de barra inferior de formulario, separado del bloque de filtros sin ninguna relación visual clara.

**Después**: `<div className="associated-employees-toolbar"><Button>Agregar empleados</Button></div>` — fila simple alineada a la derecha, `margin-bottom:12px`, directamente arriba del bloque de filtros (que conserva su propio fondo gris redondeado). El botón queda claramente identificado como la acción principal del header, sin cortar ni empujar los filtros.

Verificado en vivo (capturas reales, misma base de staging y mismo régimen "01 - Agricultura" de las etapas anteriores): el botón queda arriba a la derecha, los filtros forman un bloque propio debajo, sin superposición ni corte.

## 5. Responsive

Validado en vivo:
- **1440px**: botón arriba a la derecha, filtros en una fila completa debajo — ordenado.
- **1280px**: idéntico, sin overflow horizontal.
- **1024px**: el botón se mantiene arriba a la derecha; los filtros bajan a dos líneas dentro de su propio bloque (comportamiento ya existente de `.filters`, sin tocar) — sin superposición con el botón, sin scroll horizontal, sin que el botón se corte.

## 6. Tests

`frontend/src/pages/WorkRegimesPage.associatedEmployees.test.tsx`: **1 test nuevo** ("Etapa 13J.2 — 'Agregar empleados' vive en su propia toolbar... y los filtros siguen visibles junto a él") que verifica explícitamente:
- el botón está dentro de `.associated-employees-toolbar`;
- el botón **no** está dentro de `.form-actions` (guarda de regresión contra el bug de la barra sticky);
- el buscador y el filtro de vigencia siguen visibles y accesibles junto al botón.

Los 20 tests ya existentes de la Etapa 13J.1 (filtro de vigencia, vista inline de agregar sin modal-sobre-modal, empty/loading/error states, copy, selección) se ejecutaron sin cambios y siguen verdes — nada de esa lógica se tocó, sólo la clase CSS del wrapper. Total: **21/21 verdes** en este archivo, **497/497 verdes** en la suite completa (58 archivos).

## 7. Validaciones ejecutadas

- Frontend `typecheck` (`tsc -b --noEmit`) ✅.
- Frontend `vitest run` ✅ 497/497 (58 archivos).
- Frontend `build` (`vite build`) ✅.
- `git diff --check` ✅ sin errores de espacios en blanco.
- Backend: no se tocó ningún archivo — no aplica ninguna validación de backend en esta etapa.
- Validación visual en vivo contra la base real de staging (login RRHH, régimen "01 - Agricultura"): 1440px/1280px/1024px, vista de agregar empleados sin cambios, sin errores de consola (`page.on("console"/"pageerror")` vacío en toda la sesión).

## 8. Qué NO se tocó

- Backend: ningún archivo de `backend/src`.
- `schema.prisma`: sin cambios, sin migraciones.
- Reglas funcionales de asignación de régimen laboral: mismos endpoints, misma lógica de agregar/finalizar vigencia — sólo cambió una clase CSS del contenedor del botón.
- Fichador, alertas de turnos, liquidación, Horas Especiales, Conceptos Horarios.
- La variante `embedded` de `AssociatedEmployeesPanel` (usada por `HourConceptsPage`) — no tenía este problema, no se modificó.
- `EmployeeRemoteSelector.tsx`, `Modal.tsx`, la vista inline de "Agregar empleados", los 7 columnas de la tabla, el filtro de vigencia, el copy — todo de la Etapa 13J.1, sin cambios en esta corrección.

---

No se tocó backend, `schema.prisma`, fichador, alertas, liquidación, Horas Especiales, Conceptos Horarios, ni reglas funcionales de régimen laboral. No commitear sin aprobación explícita del usuario.
