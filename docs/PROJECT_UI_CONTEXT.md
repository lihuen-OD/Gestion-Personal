# Project UI Context

This file defines the shared UI direction for internal company applications.

It can be reused across projects to keep all company systems visually consistent, professional and enterprise-ready.

## Product type

Enterprise internal system.

Possible project categories:

* Enterprise SaaS
* Internal admin system
* HR management system
* Insurance management system
* Finance dashboard
* CRM/ERP module
* Operational management system
* Asset management system
* Time tracking system
* Document management system
* Reporting and analytics system

The product must feel like a real business application, not a generic prototype or AI-generated interface.

## Main visual reference

The UI must look like a professional enterprise SaaS similar to:

* Replit quality/polish
* Lovable visual completeness
* Linear clarity
* Odoo enterprise structure
* HubSpot admin style
* Monday dashboard density
* Modern ERP/CRM dashboards
* Modern internal tools with clean hierarchy and consistent spacing

The objective is not to copy any of these products directly, but to reach a similar level of polish, consistency, usability and visual completeness.

## Main platform priority

Desktop-first.

The main users are expected to work from desktop or notebook screens.

Validate the UI in:

* 1366x768
* 1440x900
* 1920x1080
* Tablet
* Mobile

Desktop must never look like a mobile layout stretched to a large screen.

Mobile must remain usable, but it is not the main design priority unless the project explicitly says otherwise.

## Layout rules

* Use sidebar navigation on desktop.
* Use topbar aligned with content.
* Main content must use available width.
* Avoid narrow centered containers for admin pages.
* Avoid excessive empty space on desktop.
* KPI grids should use 3 or 4 columns on desktop.
* Tables should use full available width.
* Forms should use grouped 2-column layouts on desktop when appropriate.
* Detail pages should use tabs, sections or cards with clear hierarchy.
* Mobile must stack content vertically.
* Filters should be placed above tables or in a clear filter bar.
* Action buttons should be visible and predictable.
* Primary actions should be easy to find.
* Secondary actions should not compete visually with primary actions.

## Visual rules

* Icons must never overlap text, numbers or badges.
* Values must never overflow cards.
* Cards in the same row must have consistent visual height or alignment.
* Tables and filters must align cleanly.
* Buttons must be consistent across the application.
* Empty states must be designed.
* Loading states must be designed.
* Error states must be designed.
* Success states must be designed when relevant.
* The app must not look like generic AI-generated UI.
* The app must not look like mobile stretched to desktop.
* Text must be readable and well-spaced.
* Labels must be clear.
* Inputs must have consistent height.
* Tables must be readable and not visually overloaded.
* Cards must have clear titles, values and descriptions.
* Use badges for statuses.
* Use icons only when they improve understanding.
* Avoid decorative elements that do not support usability.
* Avoid random gradients unless they are part of a defined theme.
* Avoid inconsistent shadows, borders or radius.
* Avoid overusing colors.
* Avoid overly large cards in enterprise dashboards.
* Avoid too much vertical spacing between related elements.

## Enterprise density

Use comfortable enterprise density.

The interface should be clean, but information-dense enough for business users.

Avoid:

* Huge gaps between sections.
* Oversized cards.
* Large empty hero sections.
* Landing-page style layouts inside admin modules.
* Repetitive oversized illustrations.
* Mobile-first spacing on desktop.

Prefer:

* Compact dashboards.
* Clear cards.
* Useful tables.
* Grouped forms.
* Professional spacing.
* Strong information hierarchy.
* Good use of available width.

## Brand / theme

Primary color:

* Pending per company/project.

Secondary color:

* Pending per company/project.

Background:

* Neutral enterprise background.
* Prefer soft gray/off-white backgrounds for admin systems.
* Avoid pure white walls without section hierarchy.

Typography:

* Use a modern, readable sans-serif font.
* Maintain consistent font sizes.
* Use clear hierarchy for headings, section titles, labels and values.

Border radius:

* Moderate.
* Avoid excessive roundness unless project brand requires it.

Shadow style:

* Subtle.
* Enterprise cards should not look floating or overly decorative.
* Prefer borders and soft shadows.

Density:

* Comfortable enterprise density.

Default visual personality:

* Professional
* Clean
* Modern
* Reliable
* Structured
* Calm
* Operational
* Business-oriented

## Component standards

### Cards

Cards must have:

* Clear title.
* Optional subtitle or description.
* Consistent padding.
* Consistent border/radius.
* Proper spacing between text and values.
* No overflowing numbers or labels.
* Aligned actions when present.

KPI cards must have:

* Main value.
* Label.
* Optional trend/status.
* Optional icon.
* Consistent height.
* Clear visual hierarchy.

### Tables

Tables must:

* Use full available width.
* Have readable headers.
* Align numeric values consistently.
* Use badges for states.
* Include actions in a predictable column.
* Support empty state.
* Support loading state.
* Avoid horizontal overflow when possible.
* Use responsive strategy for smaller screens.

### Forms

Forms must:

* Be grouped by logical sections.
* Use 2-column layouts on desktop when useful.
* Use 1-column layout on mobile.
* Use consistent labels.
* Use consistent validation messages.
* Use selects/autocomplete when values come from existing data.
* Avoid free text when a field belongs to a controlled catalog.
* Show required fields clearly.
* Keep primary submit action visible.

### Detail pages

Detail pages must:

* Use clear title/header.
* Show entity summary.
* Use tabs or grouped sections for complex data.
* Avoid excessive modals for primary navigation.
* Keep actions visible but not overwhelming.
* Show history/audit where appropriate.

### Dashboards

Dashboards must:

* Use real available data or clearly marked mock data.
* Keep KPI cards aligned.
* Avoid excessive card size.
* Use useful charts/tables/lists.
* Group related indicators.
* Provide empty/loading/error states.
* Use desktop width well.

### Navigation

Navigation must:

* Be predictable.
* Use clear labels.
* Highlight active page.
* Keep module grouping consistent.
* Avoid duplicate navigation paths.
* Work on desktop and mobile.

## Modules to validate visually

Every project must visually validate:

* Dashboard
* List pages
* Detail pages
* Create/edit forms
* Settings/configuration
* User/roles pages
* Reports/analytics
* Mobile navigation
* Empty states
* Loading states
* Error states
* Permission/blocked states
* Tables with few records
* Tables with many records
* Forms with validation errors
* Long text content
* Responsive behavior

## AI-generated UI prevention rules

The UI must not show typical AI-generated issues such as:

* Cards randomly sized.
* Icons too large or poorly aligned.
* Too much spacing on desktop.
* Inconsistent button styles.
* Repeated generic sections.
* Unclear hierarchy.
* Placeholder text left in final screens.
* Fake charts with no context.
* Random gradients.
* Inconsistent border radius.
* Inconsistent shadows.
* Tables not aligned.
* Forms with mixed input heights.
* Text overflowing cards.
* Mobile design stretched to desktop.

When improving UI, always check:

* Alignment.
* Spacing.
* Density.
* Hierarchy.
* Readability.
* Consistency.
* Responsiveness.
* Real business usability.

## Design quality target

The frontend should feel close to production quality even when using mock data.

The user should be able to navigate the app and understand:

* What each module does.
* What data is being shown.
* What actions are available.
* What state each record is in.
* What requires attention.
* How modules connect to each other.

The interface should communicate trust, structure and operational clarity.

## Frontend phase rule

When the project is in frontend-only phase:

* Do not create backend.
* Do not create database.
* Do not create real APIs.
* Use mock services.
* Use localStorage if persistence is needed.
* Keep services replaceable by future API calls.
* Do not hardcode business data inside components.
* Use reusable UI components.
* Keep TypeScript models clean and explicit.

## Final UI acceptance criteria

A screen is acceptable only if:

* It looks professional on desktop.
* It is usable on mobile.
* Cards are aligned.
* Text does not overflow.
* Buttons are consistent.
* Tables are readable.
* Forms are clean and grouped.
* Empty/loading/error states exist.
* Main actions are clear.
* Data relationships are understandable.
* The screen does not look like a generic AI-generated interface.
