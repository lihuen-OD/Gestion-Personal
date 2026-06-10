# Design System Standards

## Objective

Build professional, consistent and production-quality interfaces.

The UI must not look like generic AI-generated design.

The interface must feel like a real SaaS product built by a senior product designer and senior frontend engineer.

## Design identity

Default style for enterprise systems:
- modern SaaS
- clean but not empty
- professional
- dense enough for business use
- visually structured
- consistent
- desktop-first for admin systems
- responsive without sacrificing desktop quality

References:
- Replit UI quality
- Lovable app polish
- Linear clarity
- Odoo enterprise structure
- HubSpot admin style
- Monday dashboard density
- modern ERP/CRM dashboards

## Non-negotiable visual rules

- Icons must never overlap numbers, text or actions.
- KPI cards must never allow content overflow.
- Large numbers must fit inside cards.
- Text must not be truncated unless intentionally designed with tooltip/ellipsis.
- Buttons must not jump layout.
- Cards must have consistent heights when in the same row.
- Dashboard grids must be aligned.
- Tables must use available width properly.
- Forms must be grouped clearly.
- Sidebar, topbar and content must align cleanly.
- Desktop must not look like mobile stretched to a large monitor.
- Mobile must not break desktop decisions.
- Empty whitespace must be intentional, not accidental.

## Enterprise desktop-first rule

For admin panels, SaaS systems, ERP, CRM, HR, finance, insurance, asset management and internal management systems:

Desktop is the primary experience.

Desktop requirements:
- Validate layout at 1366x768.
- Validate layout at 1440x900.
- Validate layout at 1920x1080.
- Main content must use available width.
- Avoid narrow centered containers for internal admin screens.
- Avoid excessive `max-width` on dashboards, tables and list pages.
- Use full-width business panels where useful.
- Use 3 or 4 columns for KPI grids depending on available width.
- Use 2-column layouts for charts/panels when appropriate.
- Use 2-column or grouped forms on desktop.
- Use compact enterprise spacing.

## Global layout

Recommended structure:

```txt
AppShell
├── Sidebar
└── MainArea
    ├── Topbar
    └── PageContent
```

Rules:
- Sidebar fixed or consistently positioned on desktop.
- MainArea must use `flex: 1` and `min-width: 0`.
- PageContent must use `width: 100%`.
- PageContent should not use small global `max-width`.
- Page padding should be consistent, usually 24px to 32px on desktop.
- Header/topbar height should be consistent.
- Sidebar width should be consistent across all modules.

## KPI cards

KPI cards must:
- have clear title
- have visible primary value
- have secondary description
- keep icon in a reserved area
- prevent icon overlap with text
- prevent number overflow
- use consistent height
- use consistent padding
- align to the grid
- use responsive typography

Recommended structure:
```txt
Card
├── Header row
│   ├── Label
│   └── Icon container
├── Value
└── Description
```

Rules:
- Icon container must have fixed width and height.
- Text area must have `min-width: 0`.
- Large values must support wrapping or responsive font-size.
- Financial values must use compact formatting when needed.
- Never place icon absolute over text unless layout is fully protected.

## Tables and lists

Enterprise apps usually need strong tables.

Rules:
- Tables should use full available width.
- Filters should align above the table.
- Search input should not be oversized.
- Actions should be aligned consistently.
- Important columns should be visible on desktop.
- On mobile, use horizontal scroll or card layout depending on context.
- Avoid hiding business-critical data on desktop.
- Use clear row height and readable density.

## Forms

Rules:
- Use sections.
- Group related fields.
- Use 2 columns on desktop when useful.
- Use 1 column on mobile.
- Required fields must be clear.
- Error messages must not break layout.
- Primary action must be visible and consistent.
- Destructive actions must be visually separated.

## Visual hierarchy

Every page should have:
- page title
- short description/subtitle
- primary action when applicable
- filters or KPIs when applicable
- main content panel/table/form
- empty/error/loading state

Avoid pages that are just floating cards without a strong structure.

## Spacing

Use consistent spacing scale:
- 4px
- 8px
- 12px
- 16px
- 20px
- 24px
- 32px
- 40px

Avoid random spacing values.

Enterprise dashboard recommended:
- Page padding: 24px or 32px
- Section gap: 20px or 24px
- Card gap: 16px
- Card padding: 20px or 24px

## Typography

Rules:
- Titles must be clear but not oversized.
- Business systems should not use giant landing-page headings.
- KPI values can be prominent but must fit.
- Descriptions must be readable.
- Use consistent font weights.
- Avoid excessive uppercase except small labels.

## Colors

Rules:
- Use a small color palette.
- Use semantic colors:
  - success
  - warning
  - danger
  - info
  - neutral
- Do not overuse bright gradients.
- Keep contrast accessible.
- Use color to support hierarchy, not decoration only.
- Avoid random icon colors.

## Components that should exist

For consistent projects, prefer shared components:
- AppShell
- Sidebar
- Topbar
- PageHeader
- PageContent
- KpiCard
- MetricGrid
- DataTable
- FilterBar
- SectionCard
- EmptyState
- LoadingState
- ErrorState
- FormSection
- ConfirmDialog

The AI must reuse or create common components instead of inventing inconsistent UI per page.

## QA visual checklist

Before finishing frontend work, verify:
- Desktop 1366x768
- Desktop 1440x900
- Desktop 1920x1080
- Tablet
- Mobile
- No overlapping icons/text/numbers
- No horizontal scroll on desktop unless intentional
- No excessive empty centered layout
- KPI cards aligned
- Tables use proper width
- Forms readable
- Sidebar/topbar/content aligned
- Loading/error/empty states exist
- Visual style consistent across modules

## Anti-patterns

Avoid:
- mobile layout stretched to desktop
- landing-page layout for admin systems
- isolated floating cards with no structure
- random card sizes
- icons over text
- huge whitespace
- tiny centered max-width containers
- inconsistent buttons
- inconsistent shadows
- inconsistent border radius
- too much minimalism that removes usability
- decorative UI that breaks business readability
