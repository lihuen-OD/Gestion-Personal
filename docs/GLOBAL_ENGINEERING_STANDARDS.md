# Global Engineering Standards

## Objective

These are the permanent engineering standards for all projects.

The system must be built with a production mindset:
- correctness
- security
- maintainability
- scalability
- reliability
- clarity
- testability
- visual consistency

## General rules

- Understand before changing.
- Read existing code before adding new code.
- Reuse existing patterns.
- Do not duplicate logic.
- Do not invent business rules.
- Do not add unnecessary dependencies.
- Do not do large refactors mixed with small features.
- Do not hardcode secrets.
- Do not expose sensitive information.
- Do not ignore errors.
- Do not leave dead code.
- Do not break existing flows.
- Do not create generic UI when a product design system exists.

## Code quality

Good code must be:
- readable
- typed
- cohesive
- low-coupled
- easy to test
- easy to debug
- easy to delete if no longer needed
- consistent with the project

## Naming

Use names that explain intention:
- `calculateTotalHours`
- `validateUserPermission`
- `createEmployeeRecord`
- `getActiveEmployees`

Avoid ambiguous names:
- `data`
- `info`
- `thing`
- `doStuff`
- `handle`
- `processData` without context

## Functions

Functions should:
- do one thing
- have clear inputs and outputs
- avoid hidden side effects
- be short when possible
- avoid deeply nested logic
- be easy to test

## Error handling

Errors must:
- be handled intentionally
- give useful feedback
- not expose sensitive internals
- not hide real failures
- use appropriate HTTP status codes when applicable

## Documentation

Document:
- architecture decisions
- environment variables
- important business rules
- non-obvious logic
- deployment steps
- database changes
- integrations
- UI/design decisions when they affect the whole app

Do not document obvious code unnecessarily.
