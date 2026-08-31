# Etapa 12C — UX de clasificación en Horas Especiales

Fecha: 2026-08-31
Estado: implementado, validado (incluida verificación visual contra la base real), pendiente de aprobación para commitear
Continúa: `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12A.md` (diagnóstico/diseño), `docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12B.md` (backend/schema/API, ya commiteado como `c6864b0`)

## 1. Resumen ejecutivo

12B dejó `DoubleHourRule.kind` funcionando en backend con un campo mínimo en el formulario (sólo lo necesario para compilar tipos). 12C mejora esa UX para que RRHH pueda entender y editar la clasificación sin errores: se renombró el campo a **"Clasificación"** (antes "Tipo de día especial"), se actualizó el copy a la versión aprobada, se agregó un aviso contextual sólo cuando se elige "Feriado", un aviso informativo (no bloqueante) cuando alguna regla sigue en "Otro", un filtro por clasificación que actúa sobre la tabla y sobre el calendario mensual a la vez, y la clasificación de cada regla queda visible como tooltip discreto en los chips del calendario. Verificado contra la base real (Neon staging, sin escribir nada): las dos reglas reales ("Domingos", "Feriados") siguen en `Otro`, el filtro por "Feriado" correctamente no encuentra nada y muestra el mensaje vacío esperado, sin errores de consola. +14 tests frontend (429→443... nota: el total ya venía en 429 antes de 12B/12C por trabajo previo — ver §9 para el detalle exacto de esta etapa), todos verdes. No se tocó backend (no hizo falta ningún fix), no se tocó el motor de liquidación, no se tocó Turnos, no se crearon asignaciones de feriado, no se modificó la notificación "Sin actividad registrada".

## 2. Qué problema UX resolvía

Desde 12B, el campo de clasificación existía pero era mínimo: label técnico ("Tipo de día especial"), copy genérico, sin ayuda contextual, sin manera de encontrar rápido qué reglas seguían sin clasificar. El problema de negocio real: las 2 reglas existentes en producción ("Domingos", "Feriados") quedaron en `OTRO` por diseño (nunca se infiere por nombre — ver 12A/12B), pero RRHH necesita:
1. Entender qué significa cada clasificación sin leer documentación técnica.
2. Saber cuándo una clasificación tiene consecuencia futura real (Feriado → Turnos).
3. Encontrar fácilmente qué reglas siguen sin clasificar para decidir si corresponde reclasificarlas.

## 3. Cómo se muestra la clasificación

- **Formulario** ([WorkScheduleSettingsPage.tsx](../../frontend/src/pages/WorkScheduleSettingsPage.tsx)): campo "Clasificación" en la sección "Datos principales", junto a Multiplicador/Prioridad — `<select>` con las 4 opciones (Feriado, Domingo, Jornada especial, Otro).
- **Tabla de reglas**: columna "Clasificación" (antes "Tipo"), con un `Badge` de tono `neutral` (mismo componente ya usado para el estado Activa/Inactiva) — sin colores agresivos, sin convertirlo en alerta.
- **Calendario mensual** ([SpecialHourRulesCalendarMonth.tsx](../../frontend/src/components/workforce/SpecialHourRulesCalendarMonth.tsx)): la clasificación se agregó al `title` (tooltip nativo) de cada chip de regla — `"Feriado · Prioridad 1"` en vez de sólo `"Prioridad 1"`. Se eligió el tooltip sobre un badge/línea visible en la grilla para no sobrecargar visualmente un componente ya denso (grilla de 7×6 celdas con chips de superposición/conflicto) — ninguna de las 3 opciones sugeridas en el pedido es obligatoria, y esta es la que menos espacio ocupa.

## 4. Cómo se edita

Sin cambios de flujo respecto a 12B, sólo de copy/label:
- Crear regla: el `<select>` arranca en "Otro" (`emptyRuleForm.kind = "OTRO"`), igual que el resto del formulario usa defaults seguros.
- Editar regla: `editRule()` precarga `rule.kind = item.kind` — el valor real guardado, nunca inferido del nombre (verificado con test: una regla llamada "Domingo" pero clasificada `FERIADO` precarga "Feriado", no "Domingo").
- Guardar: `kind` viaja siempre en el payload de `createDoubleHourRule`/`updateDoubleHourRule`, tal como ya hacía 12B.
- Si el backend devuelve un `kind` distinto al que el formulario tenía antes de recargar, se respeta (no hay ningún estado local que lo pise — `load()` siempre reconstruye `rules` desde la respuesta real).

## 5. Copy final usado

- Ayuda base (siempre visible): **"El nombre es sólo descriptivo. La clasificación indica cómo otros módulos interpretan estas fechas."**
- Ayuda condicional (sólo si `kind === "FERIADO"`): **"Las fechas clasificadas como Feriado podrán usarse más adelante para asignar quiénes trabajan un feriado en Turnos."**
- Aviso informativo, no bloqueante (sólo si alguna regla visible tiene `kind === "OTRO"`, arriba de la tabla): **"Las reglas en 'Otro' se aplican para liquidación, pero no aparecerán como feriados para futuras asignaciones de Turnos."**
- Filtro: label **"Filtrar por clasificación"**, opciones Todas/Feriado/Domingo/Jornada especial/Otro.
- Mensaje de tabla vacía por filtro: **`No hay reglas clasificadas como "{clasificación}".`** — distinto del mensaje genérico `"Todavía no hay reglas de horas especiales."` cuando no hay ninguna regla en absoluto, para que RRHH entienda si el filtro no tiene resultados o si la pantalla está realmente vacía.
- Ningún copy usa `DoubleHourRule`, `enum`, `kind`, `API`, `schema` ni `backend` — verificado con test dedicado.

## 6. Cómo se evita depender del nombre

Sin cambios respecto a 12A/12B — reconfirmado explícitamente en esta etapa con evidencia nueva:
- El formulario nunca autocompleta ni sugiere una clasificación en base a lo que RRHH escribe en "Nombre de la regla" — no existe ningún `onChange` de `name` que toque `rule.kind`.
- Test dedicado: una regla real llamada **"Domingo"** pero con `kind: "FERIADO"` guardado precarga "Feriado" al editar (no "Domingo").
- Test dedicado: una regla real llamada **"Feriados"** con `kind: "OTRO"` se lista en la tabla con el badge "Otro", nunca "Feriado" — y una llamada **"Pedro"** con `kind: "FERIADO"` se lista como "Feriado".
- **Verificado contra datos reales de producción** (ver §8): las 2 reglas reales, "Domingos" y "Feriados", aparecen ambas con badge "Otro" en la captura de pantalla tomada contra la base conectada — ninguna se "adivinó" por su nombre, ni siquiera la que se llama literalmente "Feriados".

## 7. Filtro por clasificación — decisión

Se evaluó y **sí se implementó**, por una razón concreta de negocio: el problema que motiva esta etapa es que RRHH necesita encontrar qué reglas existentes (hoy, todas) siguen en "Otro" para decidir si corresponde reclasificarlas — sin un filtro, tendría que leer badge por badge en una tabla que puede crecer. Se implementó como:
- Un `<select>` "Filtrar por clasificación" (Todas/Feriado/Domingo/Jornada especial/Otro) arriba de la tabla de reglas, filtrando client-side sobre `rules` (ya fetch-all — catálogo de configuración chico, mismo criterio ya usado desde 8B para este mismo listado, sin volver a consultar el backend).
- El mismo filtro se pasa como prop `kindFilter` a `SpecialHourRulesCalendarMonth`, que lo usa para pedir el calendario con `doubleHourRulesCalendar(from, to, kind)` — el filtro `kind` que `calendarPreview` ya soporta desde 12B — así la tabla y el calendario muestran siempre el mismo subconjunto sin que RRHH tenga que configurar el filtro dos veces.
- Sin selección ("Todas"), el comportamiento es idéntico al de antes de esta etapa en ambos componentes.

No se agregó ningún filtro nuevo al backend — se reutilizó exactamente el que 12B ya dejó preparado, tal como pedía el punto 7 del encargo.

## 8. Verificación visual (navegador real, contra la base conectada)

Se levantó el entorno ya corriendo del propio usuario (backend `:4002`, frontend `:5174` — procesos preexistentes, no se tocaron; sólo se limpiaron dos procesos duplicados que este mismo intento de arranque generó por error de puerto ya ocupado) y se navegó con Playwright headless, **en modo estrictamente de lectura** (sin click en "Crear regla"/"Guardar cambios"/"Eliminar"/"Inactivar" — la base es Neon staging real y compartida, con las 2 reglas reales del sistema).

Confirmado con capturas:
- El campo "Clasificación" y su ayuda se ven en una sola columna, sin desbordar ni superponerse con "Prioridad"/"Motivo o descripción", en un viewport de escritorio (1440×900).
- Al seleccionar "Feriado", el segundo párrafo de ayuda aparece debajo del primero, sin romper el layout de la grilla de 4 columnas.
- La tabla muestra correctamente la columna "Clasificación" con badge "Otro" para las 2 reglas reales ("Feriados", "Domingos") — confirmando en vivo, contra datos reales, que no hay inferencia por nombre.
- El filtro "Filtrar por clasificación" → "Feriado" deja la tabla en el estado vacío correcto (`"No hay reglas clasificadas como 'Feriado'."`) y el calendario mensual (navegado a agosto 2026) deja de mostrar chips para ese mes — ambos coherentes entre sí.
- `console --errors` (vía Playwright): sin errores.

No se modificó ni se creó ningún dato en la base durante esta verificación.

## 9. Pruebas hechas (tests frontend)

Todo en [WorkScheduleSettingsPage.test.tsx](../../frontend/src/pages/WorkScheduleSettingsPage.test.tsx), describe `"WorkScheduleSettingsPage — Etapa 12B/12C (clasificación estructurada, kind)"` (14 tests, reemplaza el describe más chico de 12B):
- Formulario arranca en "Clasificación" = Otro.
- Copy sin lenguaje técnico (`kind`/`enum`/`DoubleHourRule`/`schema`/`backend`/`API`).
- Al elegir "Feriado" aparece el aviso de Turnos; al cambiar a otra clasificación, desaparece.
- Crear con "Feriado" → `kind: "FERIADO"` en el payload.
- Crear con "Domingo" → `kind: "DOMINGO"` en el payload.
- Editar precarga la clasificación real, no la inferida del nombre ("Domingo" con `kind=FERIADO` precarga Feriado).
- Cambiar la clasificación de una regla existente y guardar manda el nuevo `kind` en el `PATCH`.
- Tabla muestra "Feriado" para una regla llamada "Pedro" clasificada `FERIADO`.
- Tabla muestra "Otro" (nunca "Feriado") para una regla llamada "Feriados" clasificada `OTRO`.
- Con al menos una regla en "Otro", aparece el aviso informativo — sin ninguna, no aparece (2 tests separados, evitando montar dos instancias del componente en el mismo test).
- El filtro deja visible sólo las reglas del tipo elegido en la tabla.
- El filtro se propaga al calendario (`doubleHourRulesCalendar` se llama con el `kind` elegido).
- El calendario y el listado no rompen con reglas de distinto `kind` mezcladas (`SEMANAL`+`DOMINGO` y `FECHA`+`FERIADO` en la misma tabla).

**Corrección de un efecto colateral en tests** (no un bug de producción): renombrar el campo a "Clasificación" hizo que su nombre accesible (que incluye el texto de las 4 `<option>`, igual que ya pasaba con "Prioridad"/su `<small>` desde la Etapa 10D) coincidiera por subcadena con el nuevo `<select>` "Filtrar por clasificación" cuando había reglas cargadas — se agregó un helper `classificationSelect()` que acota la búsqueda al `<form>` (el filtro vive fuera de él, en la sección de listado), reemplazando las 7 consultas sueltas que antes usaban `getByLabelText("Clasificación", {exact:false})` directo.

**Total de esta etapa**: 429 (baseline antes de 12B/12C) → 434 (tras 12B, ya commiteado) → 443 (tras 12C) — 9 tests netos nuevos sobre lo que dejó 12B (14 tests del describe reescrito reemplazan los 5 que tenía antes).

## 10. Validaciones ejecutadas

| Validación | Resultado |
| --- | --- |
| `npx tsc -b` (frontend) | ✅ sin errores |
| `npx vitest run` (frontend) | ✅ 443/443 tests, 56 archivos |
| `npm run build` (frontend) | ✅ |
| `git diff --check` | ✅ sin errores de espacios en blanco |
| Verificación visual (Playwright headless contra `localhost:5174`/`:4002`, base Neon staging real) | ✅ sin errores de consola, layout correcto, filtro+aviso funcionando contra datos reales |

Backend: no se tocó ningún archivo (`git status --short backend/` vacío) — no hizo falta ningún fix, `npm run typecheck`/`vitest run`/`npm run build` de backend no se ejecutaron en esta etapa porque no hay ningún cambio que validar ahí (ya habían quedado verdes en 12B, commit `c6864b0`).

## 11. Qué NO se tocó

- Backend: ningún archivo de `backend/src` ni `backend/prisma` — no se detectó ningún bug real que lo requiriera.
- El motor de liquidación (`doubleHourRuleMatching.ts`, `timeEntries.repository.ts`) — sin cambios, sin necesidad (12B ya lo dejó ignorando `kind` por construcción).
- El fichador — sin cambios.
- Conceptos Horarios (`hour-concepts`) — sin cambios.
- Turnos (`backend/src/modules/shifts/`) — ningún archivo tocado, ninguna pantalla ni endpoint nuevo.
- Ninguna entidad ni pantalla de "asignaciones de trabajo en feriados" — sigue sin existir, a propósito.
- La notificación "Sin actividad registrada" (`attendanceInactivity.service.ts`) — sin cambios.
- Permisos/RBAC — sin cambios, ningún archivo de autorización tocado.
- El resto del formulario (Alcance, Calendario/fechas, empleados específicos) — sólo se agregó el campo/copy de clasificación y el filtro; ningún otro campo cambió de comportamiento.
- El motor de `calendarPreview`/`ruleMatchesDate`/`resolveWinningRules` — se reutilizó el filtro `kind` ya expuesto por 12B tal cual, sin tocar esas funciones.
- No se creó ninguna migración ni se modificó `schema.prisma`.

## 12. Riesgos pendientes

- Las 2 reglas reales ("Domingos", "Feriados") **siguen sin reclasificar** — 12C mejora la UX para que RRHH pueda hacerlo fácilmente (el filtro ayuda a encontrarlas, el aviso informativo se lo recuerda), pero la acción en sí sigue pendiente de que un usuario RRHH real la haga desde la pantalla.
- El filtro es client-side sobre un listado ya fetch-all — si en el futuro el volumen de reglas creciera mucho (hoy son 2, vocabulario de configuración chico), habría que revisar si conviene mover el filtrado de la tabla al backend; no es necesario hoy (mismo criterio de `PERFORMANCE_STANDARDS.md` §6, "fetch-all sólo para catálogos con volumen bajo confirmado").
- El tooltip de clasificación en el calendario depende de `title` nativo del navegador — no es accesible por teclado ni visible en touch/mobile sin hover; se eligió así por ser la opción menos invasiva visualmente, pero si a futuro se prioriza accesibilidad del calendario, convendría un popover/badge explícito en su lugar.
- No se ejecutó ninguna prueba de regresión visual automatizada (sólo verificación manual con capturas) — cualquier cambio de estilo futuro en `.rule-scope-help`/`.rule-kind-filter` debería revisarse visualmente de nuevo.

## 13. Próximos pasos

- **12D** — Pantalla de Turnos → Asignaciones de trabajo en feriados, consumiendo `kind=FERIADO` (contrato ya diseñado en 12A §12, filtro ya expuesto por 12B, ahora también reflejado en la UX de esta etapa) — sigue sin implementarse.
- **12E** — Notificación "Sin actividad registrada" según expectativa real de actividad (hallazgo documentado en 12A §4.10, reconfirmado sin tocar en 12B y en esta etapa) — candidata a etapa dedicada, idealmente después de 12D para poder distinguir "no vino un feriado sin convocatoria" de "no vino un día común".

---

No se tocó `schema.prisma`, no se creó ninguna migración, no se modificó código de backend, motor de liquidación, fichador, Conceptos Horarios ni Turnos. No commitear sin aprobación explícita del usuario.
