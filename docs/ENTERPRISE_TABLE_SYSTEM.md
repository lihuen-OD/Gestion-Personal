# Enterprise Table System

## Objetivo

Este patrón define cómo construir tablas administrativas legibles, estables y desktop-first para apps internas, evitando:

- scroll horizontal global de toda la página,
- columnas que rompen el layout,
- textos largos que quedan cortados sin solución,
- acciones que estiran filas o deforman tablas.

La idea es que la tabla use el ancho disponible del panel y, si necesita más espacio, el scroll quede **adentro del contenedor de tabla**, no en toda la app.

---

## Nombre del patrón

Usar este nombre:

**Enterprise Data Table Pattern**

También puede nombrarse internamente como:

**Enterprise Table System**

---

## Piezas principales

### 1. `TableShell`

Contenedor reusable que:

- encapsula el scroll horizontal,
- limita el overflow al bloque de tabla,
- evita que el layout general se rompa,
- permite configurar un `minWidth` por tabla.

Responsabilidad:

- resolver layout,
- no resolver contenido.

### 2. `OverflowCell`

Celda reusable para textos largos.

Comportamiento:

- muestra 1, 2 o 3 líneas visuales,
- corta prolijamente con clamp,
- al hover o click muestra un popover con el contenido completo,
- el popover se mantiene dentro del viewport.

Responsabilidad:

- resolver legibilidad de contenido largo,
- no resolver estructura de tabla.

---

## Cuándo usar cada pieza

### Usar `TableShell` siempre que

- haya una tabla administrativa,
- el contenido pueda crecer,
- haya riesgo de overflow horizontal,
- la pantalla sea desktop-first.

### Usar `OverflowCell` cuando

- el valor puede ser largo o impredecible,
- hay listas separadas por coma,
- hay observaciones,
- hay valores de auditoría,
- hay relaciones organizacionales,
- hay descripciones cortas/medias dentro de una tabla.

### No usar `OverflowCell` cuando

- el dato es corto y estable,
- el valor es una fecha,
- el valor es un badge,
- el valor es un número simple,
- el valor es una acción o un ícono.

---

## Reglas visuales del sistema

### Layout

- Nunca permitir scroll horizontal global en desktop.
- La tabla debe vivir dentro de un panel o card.
- El panel no debe crecer más allá del ancho disponible.
- El scroll horizontal, si existe, debe quedar solo dentro de `TableShell`.

### Celdas

- Texto alineado a la izquierda.
- Números alineados de forma consistente según el caso.
- Fechas siempre consistentes.
- Estados con badge.
- Acciones en la última columna.

### Texto largo

- Default: clamp de 2 líneas.
- Lectura completa: popover contextual.
- No expandir el contenido “hacia la derecha” fuera de pantalla.

### Acciones

- Compactas.
- Última columna.
- Icon-only si el diseño del sistema lo pide.
- No deben empujar el ancho de la tabla.

---

## Estructura recomendada

```tsx
<TableShell minWidth={1040}>
  <table>
    <thead>
      <tr>
        <th>Código</th>
        <th>Nombre</th>
        <th>Relación</th>
        <th>Estado</th>
        <th>Acción</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.id}>
          <td><b>{row.code}</b></td>
          <td>
            <OverflowCell value={row.name} />
            <span className="table-sub">{row.description}</span>
          </td>
          <td><OverflowCell value={row.relation} /></td>
          <td><span className="badge success">{row.status}</span></td>
          <td>
            <div className="table-actions">
              <button className="table-icon-action" />
            </div>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</TableShell>
```

---

## API mínima recomendada

### `TableShell`

```ts
type TableShellProps = {
  children: ReactNode;
  className?: string;
  minWidth?: number | string;
};
```

### `OverflowCell`

```ts
type OverflowCellProps = {
  value?: string | null;
  className?: string;
  lines?: 1 | 2 | 3;
  emptyLabel?: string;
};
```

---

## CSS base que no debería faltar

### Contenedor

```css
.table-shell {
  --table-min-width: 100%;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: visible;
  overscroll-behavior-inline: contain;
}

.table-shell > table {
  width: max(100%, var(--table-min-width));
  min-width: var(--table-min-width);
  table-layout: auto;
}
```

### Celdas largas

```css
.overflow-cell-trigger {
  width: 100%;
  min-width: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.overflow-cell-trigger.lines-2 {
  -webkit-line-clamp: 2;
}

.overflow-cell-popover {
  position: fixed;
  z-index: 80;
  padding: 12px 14px;
  border-radius: 12px;
  background: #fff;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

---

## Reglas de implementación

### 1. No usar la tabla “pelada”

Evitar:

```tsx
<div className="panel-body">
  <table>...</table>
</div>
```

Preferir:

```tsx
<div className="panel-body">
  <TableShell minWidth={980}>
    <table>...</table>
  </TableShell>
</div>
```

### 2. No confiar en `title` como única solución

`title` solo no alcanza para datos largos de negocio.  
Siempre que el dato sea importante, usar `OverflowCell`.

### 3. No meter reglas globales agresivas por tabla

Evitar cosas como:

```css
.panel-body table { min-width: 760px; }
table { table-layout: fixed; }
```

si no aplican a todo el sistema.

### 4. No mezclar varias estrategias a la vez

Elegir una sola estrategia base:

- `TableShell` para overflow estructural,
- `OverflowCell` para overflow semántico.

---

## Casos ideales de uso

- Auditoría
- Historiales
- Configuración
- Catálogos maestros
- Documentación
- Novedades
- Exportaciones
- Relaciones organizacionales
- Listados administrativos

---

## Casos donde puede requerir adaptación

- Grillas tipo calendario
- Matrices horarias
- Tablas con columnas congeladas
- Tablas con edición inline compleja
- Tablas con drag and drop

En esos casos se mantiene la lógica del sistema, pero puede cambiar la implementación.

---

## Checklist para replicarlo en otra app

- Crear `TableShell`
- Crear `OverflowCell`
- Mover el scroll horizontal al contenedor
- Quitar scroll horizontal global del layout
- Aplicar `OverflowCell` solo en columnas largas
- Dejar acciones en la última columna
- Mantener badges para estados
- Validar desktop:
  - 1366x768
  - 1440x900
  - 1920x1080
- Validar tablet
- Confirmar que:
  - no se corta información crítica,
  - no se rompe el panel,
  - no aparece scroll global de página.

---

## Implementación actual en este proyecto

Referencias reales:

- `frontend/src/components/ui/TableShell.tsx`
- `frontend/src/components/ui/OverflowCell.tsx`
- `frontend/src/styles.css`

Pantallas donde ya está aplicado:

- Auditoría
- Legajos
- Documentación
- Novedades
- Empresas y estructura
- Puestos
- Tipos de novedades
- Horas especiales
- Parámetros de auditoría
- Categorías documentales
- Exportación Finnegans

---

## Forma corta para pedirlo en otra app

Podés pasar esta instrucción:

> Aplicá el `Enterprise Data Table Pattern`: usar `TableShell` para encapsular el scroll horizontal dentro de la tabla y `OverflowCell` para textos largos con clamp + popover dentro del viewport. No permitir scroll horizontal global de la app. Mantener acciones compactas en la última columna y estados con badges.

