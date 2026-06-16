# Frontend Standards

## Objective

Build frontend applications that are clear, responsive, secure, accessible, maintainable and visually professional.

Frontend work is not complete when it only works technically.

Frontend work must also pass product quality, visual consistency and enterprise usability standards.

All company applications must look and behave as part of the same internal software ecosystem.

---

## Mandatory design system reading

Before creating or changing any UI, always read:

* `docs/DESIGN_SYSTEM_STANDARDS.md`
* `docs/PROJECT_UI_CONTEXT.md`
* `docs/UI_QA_CHECKLIST.md`

These files are mandatory.

The AI must not invent a different visual identity for each project.

The design system defines the official visual language of the company applications.

---

## General rules

* Keep components focused.
* Keep templates clean.
* Move business logic to services/helpers.
* Use strong typing.
* Avoid unnecessary state.
* Avoid duplicate HTTP requests.
* Handle loading, error, success and empty states.
* Keep UI consistent.
* Respect responsive design.
* Do not store sensitive secrets in frontend code.
* Reuse shared UI components.
* Follow the design system.
* Do not hardcode business data inside components.
* Do not create isolated visual styles per screen.
* Do not create one-off components when a shared component should exist.
* Do not mix different button, card, table or form styles across the app.

---

## Visual consistency rule

Every frontend must use the same base visual structure:

* App shell
* Sidebar
* Topbar
* Page header
* Main content area
* Cards
* KPI cards
* Tables
* Forms
* Buttons
* Badges
* Filters
* Empty states
* Loading states
* Error states
* Modals/drawers when needed

A button must look the same across all modules.

A card must look the same across all modules.

A table must look the same across all modules.

A form must follow the same spacing, labels, inputs and validation style across all modules.

The app must not look like a collection of unrelated screens.

---

## Design tokens

Frontend styling must be centralized using reusable design tokens.

The project should define and reuse:

* Colors
* Typography
* Spacing
* Border radius
* Shadows
* Borders
* Z-index
* Breakpoints
* Component sizes

Do not repeat random color values, spacing values or shadows across components.

Avoid this:

```css
.card {
  background: #fff;
  border-radius: 17px;
  box-shadow: 0 8px 30px rgba(0,0,0,.2);
}
```

Prefer this:

```css
.card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
```

---

## Component architecture

A component should:

* Have one clear responsibility.
* Be readable.
* Avoid excessive size.
* Delegate API calls to services.
* Delegate complex logic to services or utilities.
* Expose clear inputs/outputs when reusable.
* Handle lifecycle correctly.
* Use shared UI patterns when possible.
* Avoid duplicating layout or visual logic.
* Avoid inline styles unless strictly necessary.

Recommended shared components:

* AppShell
* Sidebar
* Topbar
* PageHeader
* Button
* Card
* KpiCard
* DataTable
* Badge
* FilterBar
* FormField
* EmptyState
* LoadingState
* ErrorState
* Modal
* Drawer
* Tabs
* ConfirmDialog
* Pagination

---

## Layout standards

The AI must inspect and correct:

* Global app shell
* Sidebar
* Topbar
* Main content width
* Page containers
* Max-width usage
* Card grids
* Table width
* Filter bars
* Form layout
* Responsive breakpoints

Enterprise applications must use available desktop width correctly.

Avoid narrow centered layouts for admin pages.

Avoid landing-page style layouts inside internal systems.

---

## Desktop-first rule

For admin, ERP, CRM, HR, insurance, finance and management systems:

* Desktop is the primary experience.
* Mobile is secondary but must work.
* Never create a mobile-first layout that looks bad on desktop.
* Validate 1366x768, 1440x900 and 1920x1080.
* Dashboard, tables and forms must look professional on desktop.
* Main content must not feel empty, stretched or disconnected.

---

## Forms

Forms should:

* Validate required fields.
* Validate format.
* Validate lengths/ranges.
* Show useful error messages.
* Block double submit.
* Show loading while saving.
* Show success/error result.
* Avoid sending invalid data.
* Use grouped sections.
* Use 2-column layouts on desktop when useful.
* Use 1-column layouts on mobile.
* Use selects/autocomplete when data comes from catalogs.
* Avoid free text for controlled business values.
* Keep submit and cancel actions clear.
* Use consistent input height, label style and spacing.

---

## Tables

Tables should:

* Use full available width.
* Have readable headers.
* Align columns cleanly.
* Align numeric values consistently.
* Use badges for statuses.
* Include predictable actions.
* Support loading state.
* Support empty state.
* Support error state.
* Support pagination when needed.
* Avoid unnecessary horizontal overflow.
* Use responsive strategy for mobile.

Tables are critical in enterprise applications and must never look improvised.

---

## API communication

Frontend services should:

* Centralize HTTP calls.
* Use typed request/response models.
* Handle errors consistently.
* Avoid duplicated endpoint strings.
* Avoid exposing implementation details to components.
* Keep components independent from backend structure when possible.
* Make mock services replaceable by real API services.

When the project is frontend-only:

* Do not create backend.
* Do not create database.
* Do not create real APIs.
* Use mock services.
* Use localStorage only if persistence is requested.
* Keep mock data outside components.
* Keep TypeScript models clean and explicit.

---

## Auth UI

Frontend may hide UI actions by role, but backend must enforce permissions.

The frontend must not be considered a security boundary.

The UI should clearly handle:

* Unauthorized state
* Forbidden state
* Read-only user
* Disabled actions
* Missing permissions
* Locked records

---

## UX states

Every important view should consider:

* Loading
* Error
* Empty data
* Success
* Disabled action
* Unauthorized
* Forbidden
* Offline/connection error when relevant

Do not leave screens blank while loading.

Do not show broken layouts when data is empty.

Do not show technical errors directly to business users.

---

## Enterprise product design

For enterprise systems, the UI must be:

* Desktop-first
* Professional
* Consistent
* Visually balanced
* Usable with real business data
* Free from overlap/overflow bugs
* Not generic AI-generated design
* Clear in hierarchy
* Compact but readable
* Suitable for daily operational work

---

## Reject visual bugs

Never finish if:

* Icons overlap text/numbers.
* KPI values overflow.
* Cards are randomly sized.
* Content is excessively centered.
* Desktop has large useless empty space.
* Tables are squeezed unnecessarily.
* Layout feels like a mobile screen stretched to PC.
* Buttons have inconsistent heights.
* Form inputs have inconsistent sizes.
* Text overflows cards.
* Badges break layout.
* Sidebar and topbar feel disconnected.
* Different modules use different visual styles.

---

## Responsive design

Check:

* Mobile width
* Tablet width
* Desktop width
* Tables overflow
* Modals on mobile
* Buttons easy to tap
* Text readable
* No horizontal scroll unless intentional
* Sidebar behavior
* Topbar behavior
* Form stacking
* Card grid behavior

---

## Accessibility basics

Check:

* Labels for form fields.
* Button text is clear.
* Focus states are usable.
* Contrast is acceptable.
* Images have alt text when meaningful.
* Keyboard navigation is not broken.
* Clickable areas are large enough.
* Error messages are understandable.
* Disabled states are visually clear.

---

## Final frontend acceptance criteria

A frontend task is complete only if:

* The feature works technically.
* The UI follows the design system.
* Shared components are reused.
* Styling is not duplicated unnecessarily.
* Loading, empty and error states are handled.
* Desktop layout looks professional.
* Mobile layout remains usable.
* Tables, cards and forms are visually consistent.
* No obvious visual bugs remain.
* The result looks like a real enterprise application, not an AI-generated prototype.
