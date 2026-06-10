# Testing and QA Standards

## Objective

Ensure changes are reliable, safe and verifiable.

## Testing mindset

Every important change should answer:
- What can break?
- How do we prove this works?
- What edge cases exist?
- What permissions matter?
- What data states matter?
- What should happen on error?

## Minimum manual QA

For every feature:
- happy path
- required validations
- error state
- unauthorized/forbidden state when applicable
- empty state
- mobile view if frontend
- desktop view if frontend
- backend validation
- database persistence
- reload behavior
- regression of related flows

## Automated tests recommended for

- business rules
- permissions
- calculations
- data transformations
- critical endpoints
- authentication
- role-based access
- imports/exports
- payment/financial logic
- date/time logic

## Backend test checklist

- valid request
- invalid request
- unauthorized request
- forbidden request
- not found
- duplicate/conflict
- database error handling
- transaction behavior
- returned fields do not expose sensitive data

## Frontend test checklist

- component renders
- loading state
- error state
- form validation
- submit success
- submit failure
- role-based UI
- empty state
- responsive behavior
- no visual overlap
- desktop layout quality

## Regression checklist

Before finishing:
- build still passes
- types still pass
- main routes still work
- auth still works
- existing features still work
- no console errors introduced
- no server errors introduced
- no obvious UI regressions introduced
