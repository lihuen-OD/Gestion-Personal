# Frontend Standards

## Objective

Build frontend applications that are clear, responsive, secure, accessible, maintainable and visually professional.

Frontend work is not complete when it only works technically.
Frontend work must also pass visual product quality.

## General rules

- Keep components focused.
- Keep templates clean.
- Move business logic to services/helpers.
- Use strong typing.
- Avoid unnecessary state.
- Avoid duplicate HTTP requests.
- Handle loading, error, success and empty states.
- Keep UI consistent.
- Respect responsive design.
- Do not store sensitive secrets in frontend code.
- Reuse shared UI components.
- Follow the design system.

## Mandatory design system reading

Before creating or changing UI, read:
- `docs/DESIGN_SYSTEM_STANDARDS.md`
- `docs/PROJECT_UI_CONTEXT.md`
- `docs/UI_QA_CHECKLIST.md`

## Components

A component should:
- have one clear responsibility
- be readable
- avoid excessive size
- delegate API calls to services
- delegate complex logic to services or utilities
- expose clear inputs/outputs when reusable
- handle lifecycle correctly
- use shared UI patterns when possible

## Forms

Forms should:
- validate required fields
- validate format
- validate lengths/ranges
- show useful error messages
- block double submit
- show loading while saving
- show success/error result
- avoid sending invalid data
- use grouped sections
- use 2-column layouts on desktop when useful
- use 1-column layouts on mobile

## API communication

Frontend services should:
- centralize HTTP calls
- use typed request/response models
- handle errors consistently
- avoid duplicated endpoint strings
- avoid exposing implementation details to components

## Auth UI

Frontend may hide UI actions by role, but backend must enforce permissions.

The frontend must not be considered a security boundary.

## UX states

Every important view should consider:
- loading
- error
- empty data
- success
- disabled action
- unauthorized
- forbidden
- offline/connection error when relevant

## Enterprise product design

For enterprise systems, the UI must be:
- desktop-first
- professional
- consistent
- visually balanced
- usable with real business data
- free from overlap/overflow bugs
- not generic AI-generated design

## Desktop-first rule

For admin, ERP, CRM, HR, insurance, finance and management systems:
- Desktop is the primary experience.
- Mobile is secondary but must work.
- Never create a mobile-first layout that looks bad on desktop.
- Validate 1366x768, 1440x900 and 1920x1080.

## Layout quality

The AI must inspect and correct:
- global app shell
- sidebar
- topbar
- main content width
- page containers
- max-width usage
- card grids
- table width
- filter bars
- form layout
- responsive breakpoints

## Reject visual bugs

Never finish if:
- icons overlap text/numbers
- KPI values overflow
- cards are randomly sized
- content is excessively centered
- desktop has large useless empty space
- tables are squeezed unnecessarily
- layout feels like a mobile screen stretched to PC

## Responsive design

Check:
- mobile width
- tablet width
- desktop width
- tables overflow
- modals on mobile
- buttons easy to tap
- text readable
- no horizontal scroll unless intentional

## Accessibility basics

Check:
- labels for form fields
- button text is clear
- focus states are usable
- contrast is acceptable
- images have alt text when meaningful
- keyboard navigation is not broken
