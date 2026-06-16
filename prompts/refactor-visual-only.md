# Refactor Visual Only

Necesito refactorizar solamente el diseño visual del frontend.

La aplicación ya funciona correctamente.

No modificar:

- Lógica de negocio
- Rutas
- Servicios
- Modelos
- Validaciones
- API calls
- Mock data
- Permisos
- Navegación
- Estados funcionales
- Comportamiento existente

Antes de modificar código, leer obligatoriamente:

- `docs/PROJECT_CONTEXT.md`
- `docs/PROJECT_UI_CONTEXT.md`
- `docs/FRONTEND_STANDARDS.md`
- `docs/DESIGN_SYSTEM_STANDARDS.md`
- `docs/UI_QA_CHECKLIST.md`

También inspeccionar y usar como referencia visual obligatoria:

- `docs/reference-ui/dashboard-reference.png`
- `docs/reference-ui/list-reference.png`
- `docs/reference-ui/detail-reference.png`
- `docs/reference-ui/form-reference.png`
- `docs/reference-ui/sidebar-topbar-reference.png`

Objetivo:

Hacer que esta aplicación copie el mismo sistema visual definido en las imágenes de referencia.

No alcanza con que se vea “empresarial”.
Debe verse alineada visualmente con las referencias.

Trabajar sobre:

- App shell
- Sidebar
- Topbar
- Page headers
- Cards
- KPI cards
- Tables
- Filters
- Forms
- Buttons
- Badges
- Empty states
- Loading states
- Error states
- Responsive behavior
- Spacing
- Typography
- Colors
- Radius
- Shadows
- Borders

Reglas obligatorias:

- No inventar una nueva identidad visual.
- No usar cards con otro estilo.
- No usar otro sidebar.
- No usar otra topbar.
- No usar textos en mayúsculas si la referencia no los usa.
- No usar bordes superiores azules en cards si la referencia no los usa.
- No cambiar tamaños o densidad sin motivo.
- No crear estilos aislados por pantalla.
- Centralizar tokens visuales.
- Reutilizar componentes compartidos.
- Mantener funcionamiento actual intacto.

Proceso:

1. Revisar estructura actual del frontend.
2. Identificar diferencias contra `docs/reference-ui/`.
3. Crear o ajustar tokens visuales.
4. Crear o ajustar componentes compartidos.
5. Refactorizar pantallas existentes.
6. Verificar que compile.
7. Revisar que dashboard, listados, detalles y formularios coincidan visualmente con las referencias.

Resultado esperado:

La app debe parecer parte del mismo ecosistema visual que las imágenes de referencia, cambiando solamente el contenido del negocio.