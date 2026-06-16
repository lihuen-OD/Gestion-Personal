# Enterprise UI Design System
## Mandatory visual reference

This project must follow the reference UI images located in:

- `docs/reference-ui/dashboard-reference.png`
- `docs/reference-ui/list-reference.png`
- `docs/reference-ui/detail-reference.png`
- `docs/reference-ui/form-reference.png`
- `docs/reference-ui/sidebar-topbar-reference.png`

These images define the official visual target for the application.

The AI must not create a new interpretation of the design system.

The application must visually match the reference UI as closely as possible.

The business content may change depending on the project, but the visual system must remain the same.

Mandatory visual matches:

- Sidebar width, color, spacing and active state
- Topbar height, alignment and search style
- Page header hierarchy
- Background color
- Card border, radius, shadow and padding
- KPI card layout
- Table header, rows, spacing and badges
- Form layout, labels, inputs and actions
- Button style
- Badge style
- Typography scale
- Desktop-first density

## 1. Purpose

This document defines the official visual and user experience direction for all internal company applications.

It must be used as the base design system for every frontend project developed for the company, including but not limited to:

* HR management systems
* Employee records / legajos
* Time tracking systems
* Document management systems
* Insurance management systems
* Asset management systems
* Policy and claim management systems
* Finance dashboards
* Operational dashboards
* Internal admin platforms
* ERP / CRM-like modules

The main goal is to ensure that every application built for the company has the same professional visual identity, layout structure, component style, spacing, density, typography and user experience standards.

All applications must feel like they belong to the same enterprise ecosystem.

The frontend must never look like a generic AI-generated prototype. It must look like a real business application designed for daily professional use.

---

## 2. Product Personality

All company applications must communicate:

* Professionalism
* Trust
* Structure
* Operational clarity
* Business seriousness
* Modern enterprise quality
* Clean visual hierarchy
* Long-term maintainability
* Consistency across modules
* Usability for office workers and administrative teams

The design should feel similar in quality and structure to modern enterprise SaaS platforms such as:

* Linear
* Odoo Enterprise
* HubSpot Admin
* Monday.com dashboards
* Replit interface polish
* Modern ERP / CRM systems
* Professional internal tools

The goal is not to copy these products, but to reach a similar level of polish, consistency and usability.

---

## 3. Global Design Direction

The visual style must be:

* Desktop-first
* Enterprise-focused
* Clean and modern
* Compact but readable
* Information-dense without being visually overloaded
* Neutral and professional
* Consistent across all screens
* Suitable for long working sessions

Avoid landing-page aesthetics inside business modules.

Do not use:

* Oversized hero sections
* Random gradients
* Decorative shapes without purpose
* Large empty spaces
* Cards that look like marketing blocks
* Mobile-first layouts stretched to desktop
* Inconsistent shadows
* Inconsistent border radius
* Random colors
* Placeholder-looking screens
* Fake dashboards without business context

Prefer:

* Sidebar navigation
* Topbar aligned with the content
* Clear module structure
* Professional dashboards
* Full-width tables
* Compact KPI cards
* Grouped forms
* Detail pages with tabs or sections
* Clear filters
* Predictable actions
* Strong information hierarchy

---

## 4. Platform Priority

The main platform priority is desktop.

Most users will work from:

* Desktop PCs
* Notebooks
* Office monitors

The UI must be validated in the following screen sizes:

* 1366x768
* 1440x900
* 1920x1080
* Tablet
* Mobile

Desktop must never look like a mobile layout stretched across a large screen.

Mobile must remain usable, but it is secondary unless a specific project states otherwise.

---

## 5. Default Layout Structure

Every internal application should follow the same base structure:

```text
App Shell
├── Sidebar
├── Topbar
└── Main Content Area
```

### Sidebar

The sidebar must be used for primary navigation on desktop.

It should include:

* Company/app logo or system name
* Main modules
* Grouped navigation sections when needed
* Active page indicator
* Collapsible behavior if appropriate
* User/settings area at the bottom when useful

Sidebar style:

* Fixed on desktop
* Neutral dark or light enterprise style
* Clear active state
* Icons aligned with labels
* No icon/text overlap
* No excessive decoration

Recommended sidebar width:

```text
Expanded: 240px - 280px
Collapsed: 72px - 88px
```

### Topbar

The topbar should be aligned with the main content area.

It may include:

* Page title
* Breadcrumbs
* Search
* Notifications
* User menu
* Main page actions
* Date/context selector
* Company/business unit selector if applicable

The topbar must not feel disconnected from the page.

### Main Content

The main content must use the available desktop width.

Avoid narrow centered containers in admin screens.

Recommended content behavior:

```text
Max width: none or 100%
Padding desktop: 24px - 32px
Padding tablet: 20px - 24px
Padding mobile: 16px
```

Use full-width layouts for:

* Dashboards
* Tables
* Reports
* Admin lists
* Operational pages

Use constrained layouts only for:

* Login
* Simple settings
* Small forms
* Confirmation screens

---

## 6. Color System

All apps must use the same base enterprise color palette unless a specific project requires a custom brand.

### Primary Color

Use a deep, professional blue as the default primary color.

```css
--color-primary-50: #eff6ff;
--color-primary-100: #dbeafe;
--color-primary-200: #bfdbfe;
--color-primary-300: #93c5fd;
--color-primary-400: #60a5fa;
--color-primary-500: #2563eb;
--color-primary-600: #1d4ed8;
--color-primary-700: #1e40af;
--color-primary-800: #1e3a8a;
--color-primary-900: #172554;
```

Recommended main primary:

```css
--color-primary: #1d4ed8;
```

This color should be used for:

* Primary buttons
* Active navigation
* Important links
* Focus states
* Main highlights
* Selected states

### Secondary Color

Use a professional slate/gray system.

```css
--color-slate-50: #f8fafc;
--color-slate-100: #f1f5f9;
--color-slate-200: #e2e8f0;
--color-slate-300: #cbd5e1;
--color-slate-400: #94a3b8;
--color-slate-500: #64748b;
--color-slate-600: #475569;
--color-slate-700: #334155;
--color-slate-800: #1e293b;
--color-slate-900: #0f172a;
```

### Background Colors

Use soft enterprise backgrounds.

```css
--color-bg-app: #f8fafc;
--color-bg-surface: #ffffff;
--color-bg-subtle: #f1f5f9;
--color-bg-muted: #e2e8f0;
```

Avoid pure white walls without hierarchy.

The application background should usually be light gray/off-white, while cards and tables should use white surfaces.

### Text Colors

```css
--color-text-primary: #0f172a;
--color-text-secondary: #475569;
--color-text-muted: #64748b;
--color-text-disabled: #94a3b8;
--color-text-inverse: #ffffff;
```

### Border Colors

```css
--color-border-light: #e2e8f0;
--color-border-default: #cbd5e1;
--color-border-strong: #94a3b8;
```

### Status Colors

Use consistent colors for states.

```css
--color-success: #16a34a;
--color-success-bg: #dcfce7;

--color-warning: #d97706;
--color-warning-bg: #fef3c7;

--color-danger: #dc2626;
--color-danger-bg: #fee2e2;

--color-info: #2563eb;
--color-info-bg: #dbeafe;

--color-neutral: #64748b;
--color-neutral-bg: #f1f5f9;
```

Status colors must be used consistently across all projects.

Examples:

* Active / Vigente / Confirmado: success
* Pending / Pendiente / En revisión: warning
* Cancelled / Rechazado / Baja / Error: danger
* Draft / Borrador / Informativo: neutral or info

---

## 7. Typography

Use a modern, readable sans-serif font.

Recommended fonts:

* Inter
* Source Sans 3
* Manrope
* Roboto
* IBM Plex Sans

Default recommendation:

```css
--font-family-base: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

### Font Sizes

```css
--font-size-xs: 12px;
--font-size-sm: 13px;
--font-size-md: 14px;
--font-size-base: 15px;
--font-size-lg: 18px;
--font-size-xl: 22px;
--font-size-2xl: 28px;
```

### Usage

Page title:

```css
font-size: 24px - 28px;
font-weight: 650 - 700;
```

Section title:

```css
font-size: 18px - 20px;
font-weight: 600;
```

Card title:

```css
font-size: 14px - 16px;
font-weight: 600;
```

Table text:

```css
font-size: 13px - 14px;
```

Form labels:

```css
font-size: 13px;
font-weight: 500;
```

Helper text:

```css
font-size: 12px - 13px;
```

Avoid oversized typography in admin modules.

---

## 8. Spacing System

Use a consistent spacing scale.

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
```

Default rules:

* Page padding desktop: 24px - 32px
* Card padding: 16px - 24px
* Table cell padding: 10px - 14px
* Form field gap: 16px - 20px
* Section gap: 24px - 32px
* Related elements must stay visually close
* Avoid huge vertical gaps between connected content

The interface must feel comfortable and professional, not empty.

---

## 9. Border Radius

Use moderate border radius.

```css
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-xl: 16px;
```

Recommended:

* Buttons: 8px
* Inputs: 8px
* Cards: 12px
* Modals: 16px
* Badges: 999px or 6px depending on style

Avoid excessive roundness unless required by the project brand.

---

## 10. Shadows and Borders

Enterprise systems should use borders more than heavy shadows.

Recommended surface style:

```css
border: 1px solid var(--color-border-light);
box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
```

Avoid:

* Strong floating cards
* Inconsistent shadows
* Dark shadows on every element
* Glassmorphism unless specifically required

Use subtle depth only where it improves hierarchy.

---

## 11. Buttons

All apps must use consistent button styles.

### Primary Button

Used for the main action of a screen.

Examples:

* Crear legajo
* Nueva póliza
* Guardar cambios
* Cargar horas
* Subir documento
* Generar informe

Style:

```css
background: var(--color-primary);
color: white;
border-radius: 8px;
height: 36px - 40px;
font-weight: 500 - 600;
```

### Secondary Button

Used for secondary actions.

Examples:

* Cancelar
* Ver detalle
* Exportar
* Limpiar filtros

Style:

```css
background: white;
color: var(--color-text-primary);
border: 1px solid var(--color-border-default);
```

### Danger Button

Used for destructive actions.

Examples:

* Eliminar
* Dar de baja
* Anular póliza
* Rechazar documento

Style:

```css
background: var(--color-danger);
color: white;
```

### Button Rules

* Primary action must be visually clear.
* Do not show many primary buttons on the same screen.
* Secondary actions must not compete with the main action.
* Icons inside buttons must be aligned correctly.
* Button height must be consistent.
* Buttons must not change style randomly between modules.

---

## 12. Cards

Cards are one of the main visual elements of the system.

All cards must use the same structure.

### Base Card

A standard card must include:

* Clear title
* Optional subtitle
* Consistent padding
* Consistent border
* Consistent radius
* Proper internal spacing
* Optional actions aligned to the right

Recommended style:

```css
background: var(--color-bg-surface);
border: 1px solid var(--color-border-light);
border-radius: 12px;
padding: 20px;
box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
```

### KPI Cards

KPI cards must include:

* Label
* Main value
* Optional description
* Optional trend
* Optional icon
* Optional status badge

Example structure:

```text
[Icon] Total activos
       1.284
       +8% respecto al mes anterior
```

KPI card rules:

* Use 3 or 4 columns on desktop.
* Use consistent height.
* Values must not overflow.
* Icons must not overlap text.
* Avoid oversized cards.
* Avoid fake metrics without context.

---

## 13. Tables

Tables are critical in enterprise applications.

They must be clean, readable and full-width.

Tables should include:

* Clear column headers
* Proper alignment
* Consistent row height
* Status badges
* Predictable action column
* Empty state
* Loading state
* Error state
* Pagination when needed
* Search/filter area above the table

### Table Rules

* Use full available width.
* Align text to the left.
* Align numeric values to the right when appropriate.
* Align dates consistently.
* Use badges for statuses.
* Keep actions in the last column.
* Avoid too many buttons per row.
* Prefer dropdown action menus when many actions exist.
* Avoid horizontal overflow when possible.
* For mobile, use responsive cards or horizontal scroll depending on complexity.

### Recommended Table Density

```css
Header height: 40px - 44px
Row height: 44px - 52px
Cell padding: 10px - 14px
Font size: 13px - 14px
```

---

## 14. Forms

Forms must look professional, grouped and easy to complete.

### Form Structure

Forms must be divided into logical sections.

Examples for employee records:

* Datos personales
* Datos laborales
* Contacto y domicilio
* Transporte
* Responsables
* Configuración
* Historial

Examples for insurance management:

* Datos del activo
* Datos de póliza
* Cobertura
* Productor asesor
* Documentación
* Siniestros
* Estado financiero

### Layout

Desktop:

* Use 2-column layouts when useful.
* Use 3-column layouts only for short fields.
* Use full-width fields for long text.
* Group related fields in cards or sections.

Mobile:

* Stack fields vertically.
* Use 1-column layout.

### Form Rules

* Labels must always be visible.
* Required fields must be clearly marked.
* Validation messages must be consistent.
* Inputs must have consistent height.
* Selects/autocomplete must be used for catalog data.
* Avoid free text when data belongs to a controlled list.
* Primary submit action must be visible.
* Cancel action must be available.
* Do not overload forms with too many fields without grouping.

---

## 15. Detail Pages

Detail pages must provide a clear view of one entity.

Examples:

* Employee detail
* Asset detail
* Policy detail
* Claim detail
* Document detail
* Company detail
* Producer detail

### Detail Page Structure

Recommended structure:

```text
Page Header
├── Entity title
├── Status badge
├── Main actions

Summary Card
├── Key data
├── Related indicators

Tabs / Sections
├── General information
├── Documents
├── History
├── Financial data
├── Related records
├── Audit log
```

### Detail Page Rules

* Show entity summary near the top.
* Use badges for status.
* Use tabs for complex information.
* Avoid opening too many modals for primary workflows.
* Related records should be displayed in tables or structured lists.
* Audit/history must be visually clear when relevant.
* Primary actions must be visible but not overwhelming.

---

## 16. Dashboards

Dashboards must be useful, compact and business-oriented.

A dashboard should include:

* KPI cards
* Relevant charts
* Recent activity
* Alerts or pending tasks
* Important tables
* Filters by date, area, status or company when needed

### Dashboard Rules

* Use 3 or 4 KPI cards per row on desktop.
* Avoid oversized KPI cards.
* Avoid empty hero sections.
* Use charts only when they add value.
* Do not use fake charts without context.
* Include loading, empty and error states.
* Use available desktop width properly.
* Group related indicators.

### Dashboard Examples

For employee/time tracking systems:

* Legajos activos
* Altas del mes
* Bajas del mes
* Horas cargadas
* Pendientes de aprobación
* Incidencias recientes

For insurance systems:

* Activos asegurados
* Pólizas vigentes
* Pólizas por vencer
* Siniestros abiertos
* Documentos pendientes
* Costo mensual/anual asegurado

For document management:

* Documentos cargados
* Documentos pendientes
* Documentos vencidos
* Última actividad
* Documentos por área
* Validaciones pendientes

---

## 17. Navigation Standards

Navigation must be predictable and consistent across all apps.

### Sidebar Navigation Example

```text
Dashboard

Gestión
- Legajos
- Carga de horas
- Documentos
- Activos
- Pólizas
- Siniestros

Administración
- Usuarios
- Roles y permisos
- Configuración
- Catálogos

Reportes
- Reportes
- Indicadores
- Auditoría
```

### Navigation Rules

* Use clear labels.
* Avoid duplicate paths.
* Highlight the active page.
* Group modules logically.
* Do not overload the sidebar.
* Use icons only when they help recognition.
* Icons must be the same visual style.
* Mobile navigation must remain usable.

---

## 18. Status Badges

Statuses must be represented with consistent badges.

### Badge Examples

```text
Activo
Vigente
Pendiente
En revisión
Aprobado
Rechazado
Vencido
Por vencer
Borrador
Anulado
Finalizado
```

### Badge Rules

* Use color consistently.
* Text must be short.
* Avoid long labels inside badges.
* Use neutral badges for informational states.
* Use warning for pending/attention states.
* Use danger for expired/error/cancelled states.
* Use success for active/approved states.

---

## 19. Empty, Loading and Error States

Every screen must include states.

### Empty State

Used when there is no data.

It should include:

* Clear title
* Short explanation
* Optional primary action

Example:

```text
No hay pólizas cargadas

Todavía no se registraron pólizas para este activo.
Podés crear una nueva póliza para comenzar el seguimiento.
[Crear póliza]
```

### Loading State

Use:

* Skeleton loaders
* Table row placeholders
* Card placeholders

Avoid:

* Blank screens
* Layout jumping
* Generic spinners everywhere

### Error State

Use:

* Clear message
* Explanation if possible
* Retry action when relevant

Example:

```text
No se pudo cargar la información

Ocurrió un problema al obtener los datos.
Intentá nuevamente o contactá al área de sistemas.
[Reintentar]
```

---

## 20. Permissions and Blocked States

Enterprise applications must handle permissions clearly.

Examples:

* User cannot edit a record.
* User cannot view a module.
* User can only read information.
* User requires admin permission.
* Record is locked by status.

Blocked states must explain why the action is unavailable.

Example:

```text
No tenés permisos para editar esta póliza.

Tu usuario puede visualizar la información, pero no modificarla.
Solicitá permisos al administrador del sistema si necesitás realizar cambios.
```

---

## 21. Audit and History

For enterprise systems, history is important.

Use audit/history views for:

* Employee record changes
* Policy updates
* Asset ownership changes
* Document approvals
* Claim status changes
* Time tracking approvals
* User permission changes

History records should show:

* Date of change
* User who made the change
* Previous value
* New value
* Reason or comment when available
* Effective date if applicable

Recommended visual structure:

```text
Fecha de registro
Usuario
Campo modificado
Valor anterior
Valor nuevo
Fecha de vigencia
Motivo
```

For complex entities, history may be shown:

* Inside tabs
* Under each important field
* In an audit timeline
* In a dedicated history table

---

## 22. Responsive Behavior

Desktop is the priority, but mobile must be usable.

### Desktop

* Sidebar visible.
* Topbar visible.
* Tables full-width.
* KPI cards in 3 or 4 columns.
* Forms in 2 columns when appropriate.
* Detail pages use tabs/sections.

### Tablet

* Sidebar may collapse.
* Cards use 2 columns.
* Tables may scroll horizontally.
* Forms may use 1 or 2 columns depending on width.

### Mobile

* Sidebar becomes drawer or bottom navigation.
* Content stacks vertically.
* Tables may become cards or horizontal scroll.
* Primary actions remain visible.
* Forms use 1 column.
* Filters collapse into a panel or drawer.

---

## 23. Component Consistency Rules

All projects must reuse shared components when possible.

Recommended reusable components:

* AppShell
* Sidebar
* Topbar
* PageHeader
* Card
* KpiCard
* DataTable
* Badge
* Button
* Input
* Select
* DatePicker
* Modal
* Drawer
* Tabs
* EmptyState
* LoadingState
* ErrorState
* ConfirmDialog
* FilterBar
* SearchInput
* Pagination
* AuditTimeline
* DetailSection

Do not create a new visual style for each module.

A button in the insurance app must look like a button in the HR app.

A card in the document system must look like a card in the time tracking system.

A table in the asset system must look like a table in the employee system.

---

## 24. Frontend Development Rules

When building frontend-only projects:

* Do not create a backend.
* Do not create a real database.
* Do not create real APIs.
* Use mock services.
* Use localStorage only if persistence is needed.
* Keep services replaceable by future API calls.
* Do not hardcode business data inside components.
* Use clean TypeScript models.
* Use reusable components.
* Keep business logic out of templates.
* Separate layout, components, pages, services and models.

Recommended structure:

```text
src/
├── app/
│   ├── core/
│   ├── shared/
│   ├── layout/
│   ├── features/
│   ├── models/
│   ├── services/
│   └── app.routes.ts
```

Recommended shared UI structure:

```text
shared/
├── components/
│   ├── button/
│   ├── card/
│   ├── table/
│   ├── badge/
│   ├── empty-state/
│   ├── loading-state/
│   ├── modal/
│   └── form-field/
```

---

## 25. AI-Generated UI Prevention Rules

The UI must not show common AI-generated issues.

Avoid:

* Random card sizes
* Icons too large
* Icons overlapping text
* Excessive spacing
* Generic fake dashboards
* Inconsistent buttons
* Different border radius per component
* Random gradients
* Mixed shadows
* Unclear page hierarchy
* Tables with bad alignment
* Forms with inconsistent input heights
* Text overflowing cards
* Mobile layouts stretched to desktop
* Placeholder text left in final screens
* Decorative sections without business value
* Repeated generic cards with no purpose

Always review:

* Alignment
* Spacing
* Density
* Hierarchy
* Readability
* Consistency
* Responsiveness
* Business usability

---

## 26. Standard Screen Acceptance Criteria

A screen is acceptable only if:

* It looks professional on desktop.
* It is usable on mobile.
* It uses the shared layout structure.
* Cards are aligned.
* Text does not overflow.
* Buttons are consistent.
* Tables are readable.
* Forms are clean and grouped.
* Empty states exist.
* Loading states exist.
* Error states exist.
* Main actions are clear.
* Secondary actions are predictable.
* Statuses use badges.
* Data relationships are understandable.
* The page uses available desktop width.
* The page does not look like a generic AI-generated interface.

---

## 27. Required Visual Validation Per Project

Every project must visually validate these screens:

* Login
* Dashboard
* List pages
* Detail pages
* Create forms
* Edit forms
* Settings
* Users and roles
* Reports
* Empty states
* Loading states
* Error states
* Permission blocked states
* Tables with few records
* Tables with many records
* Forms with validation errors
* Long text content
* Responsive mobile navigation
* Responsive tablet layout

---

## 28. Recommended Default Theme

Unless a project defines a specific brand, use this default enterprise theme:

```css
:root {
  --font-family-base: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

  --color-primary: #1d4ed8;
  --color-primary-hover: #1e40af;
  --color-primary-light: #dbeafe;

  --color-bg-app: #f8fafc;
  --color-bg-surface: #ffffff;
  --color-bg-subtle: #f1f5f9;

  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-muted: #64748b;
  --color-text-inverse: #ffffff;

  --color-border-light: #e2e8f0;
  --color-border-default: #cbd5e1;

  --color-success: #16a34a;
  --color-success-bg: #dcfce7;

  --color-warning: #d97706;
  --color-warning-bg: #fef3c7;

  --color-danger: #dc2626;
  --color-danger-bg: #fee2e2;

  --color-info: #2563eb;
  --color-info-bg: #dbeafe;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  --shadow-card: 0 1px 2px rgba(15, 23, 42, 0.04);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
}
```

---

## 29. Final Design Goal

Every company application must feel like part of the same professional software ecosystem.

A user should be able to move from one internal system to another and immediately recognize:

* Same layout structure
* Same navigation logic
* Same card design
* Same table design
* Same form style
* Same buttons
* Same colors
* Same typography
* Same status badges
* Same level of polish

The final result must look like a serious enterprise platform, not a collection of unrelated prototypes.

The UI must support real business work, daily operations, data management, document tracking, employee management, insurance management, financial analysis and reporting.
