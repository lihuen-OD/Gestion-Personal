---
paths:
  - "frontend/src/**/*"
  - "fichador/src/**/*"
  - "frontend/index.html"
  - "fichador/index.html"
---
# UI rules (frontend and fichador)

Read this whole file before any UI task in `frontend/` or `fichador/`, even if the first file opened is elsewhere (see AGENTS.md "Specialized rules").

## Product design behavior

When building UI, act as:
- Senior Product Designer
- Senior Frontend Engineer
- Design System Engineer
- UI QA Reviewer

Do not generate generic AI dashboards.

Do not finish a frontend task if:
- icons overlap numbers/text
- KPI cards overflow
- desktop layout is weak
- the page looks like mobile stretched to desktop
- cards, tables and forms are visually inconsistent
- spacing is random
- the app does not feel like a real SaaS product

While coding UI: reuse shared UI components, respect the design system and avoid generic AI-looking interfaces. After coding UI: review visual quality and check desktop, tablet and mobile.

## Non-negotiable design rules

Frontend work is not complete if it only compiles.

The UI must be visually production-ready:
- no overlapping elements
- no overflowing KPI values
- no stretched mobile layouts on desktop
- no excessive empty desktop space
- no inconsistent components
- no generic AI-looking interface
- no icons covering numbers or text
- no random spacing
- no weak dashboard structure

For enterprise systems, desktop quality is mandatory.
Validate:
- 1366x768
- 1440x900
- 1920x1080
- tablet
- mobile

Avoid generic AI-generated UI and mobile-only layouts for enterprise systems.

## Mandatory visual reference rule

Before modifying any frontend UI, always read:

- `docs/PROJECT_CONTEXT.md`
- `docs/PROJECT_UI_CONTEXT.md`
- `docs/FRONTEND_STANDARDS.md`
- `docs/DESIGN_SYSTEM_STANDARDS.md`
- `docs/UI_QA_CHECKLIST.md`

Also inspect the visual reference images in:

- `docs/reference-ui/dashboard-reference.png`
- `docs/reference-ui/list-reference.png`
- `docs/reference-ui/detail-reference.png`
- `docs/reference-ui/form-reference.png`
- `docs/reference-ui/sidebar-topbar-reference.png`

The images in `docs/reference-ui/` are the mandatory visual reference.

Do not invent a new visual identity.

The frontend must match the reference UI system:

- Same sidebar style
- Same topbar style
- Same page structure
- Same card style
- Same KPI card style
- Same table style
- Same form style
- Same button style
- Same badge style
- Same spacing
- Same typography
- Same border radius
- Same shadows
- Same enterprise density

For visual refactors, modify only layout, styles and reusable UI components.

Do not modify business logic, routes, services, models, validations, data structure or existing functionality unless explicitly requested.
