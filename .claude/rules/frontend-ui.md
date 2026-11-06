---
paths:
  - "frontend/src/**/*"
  - "fichador/src/**/*"
  - "frontend/index.html"
  - "fichador/index.html"
---
# UI rules (frontend and fichador)

Read this whole file before any UI task in `frontend/` or `fichador/`, even if the first file opened is elsewhere (see AGENTS.md "Specialized rules").

## Scope: admin and fichador

- `frontend/` (admin app): every section of this file applies.
- `fichador/` (standalone kiosk PWA): it has its own visual system. Every section applies except "Mandatory visual reference rule", which is admin-only; "Fichador visual system" at the end of this file replaces it.

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

## Fichador visual system (`fichador/` only)

The fichador is a kiosk PWA with no sidebar, topbar or user session. Its approved visual direction is «Calma y certeza» (prototype approved by the user on 2026-11-06; foundations merged in `a0c2a96`).

- **Own system, Gestión Personal DNA.** Keep the brand DNA: Inter, accent `#2563EB`, cool neutrals and the semantic success/warning/danger colors. Do not invent another identity. Do not copy the admin sidebar, topbar, page structure, enterprise density or components, and never import from `frontend/` (`fichador/scripts/check-bundle-isolation.mjs` enforces it).
- **Tokens are the source of truth:** `fichador/src/styles/tokens.css`, then `base.css`, `components.css` and `screens/*.css`. Use the tokens instead of hardcoded values, no `!important`, and no scroll locks (`overflow: hidden` on `html` or `body`).
- **Visual reference:** the approved prototype at `~/claude-design-references/Gestion-Personal/fichador-etapa0/index.html` (a local copy outside the repo). If it is not available, follow the tokens and say so; do not reconstruct it from memory.
- **Read before UI changes:** the fichador entry of `docs/PROJECT_UI_CONTEXT.md`, the general rules of `docs/FRONTEND_STANDARDS.md` and `docs/UI_QA_CHECKLIST.md` ("Visual bugs", "Responsive"), and the user-facing behavior and messages in `docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md` §27.4 and §29. The `docs/reference-ui/` images and the app-shell, sidebar/topbar, KPI, table, enterprise-density and desktop-first sections of `docs/FRONTEND_STANDARDS.md`, `docs/DESIGN_SYSTEM_STANDARDS.md` and `docs/UI_QA_CHECKLIST.md` are admin-only and do not apply.
- **Quality bar:**
  - WCAG 2.2 AA: text contrast at least 4.5:1, UI components and focus indicators at least 3:1, visible focus, touch targets of 44 px or more, and `prefers-reduced-motion` respected.
  - Responsive: validate 320x568, 390x844, 844x390, tablet portrait and landscape, 1366x768, 1440x900 and 1920x1080 with real screenshots. No unreachable actions, no horizontal overflow, and safe areas respected.
  - One consistent language across the device gate, punch screen, camera, result and maintenance mode.
- **Styling never changes behavior.** For visual refactors, modify only layout, styles and reusable UI components; do not modify business logic, routes, services, models, validations, data structure or existing functionality unless explicitly requested. Keep the selectors the tests rely on, and keep the `.face-guide` geometry aligned with the region validated by `statusForDetection()` in `FaceCaptureModal.tsx`.
