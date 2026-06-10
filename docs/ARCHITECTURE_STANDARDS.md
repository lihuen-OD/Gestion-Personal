# Architecture Standards

## Objective

Maintain a clean, modular and scalable architecture without unnecessary complexity.

## Core principles

- Separation of concerns.
- Single responsibility.
- Clear module boundaries.
- Business logic outside UI.
- Business logic outside controllers.
- Infrastructure details isolated.
- Stable contracts between frontend and backend.
- Incremental evolution.
- Shared UI components for consistent enterprise interfaces.

## Architecture checklist

Before implementing:
- Is there an existing module for this?
- Is this a frontend, backend or database concern?
- Is this business logic or presentation logic?
- Does this affect permissions?
- Does this affect existing API contracts?
- Does this require a migration?
- Does this require documentation?
- Does this require tests?
- Does this require a reusable UI component?

## Layering

### Frontend

Suggested separation:
- app shell/layout
- pages/views
- components
- shared UI components
- services/api clients
- models/types
- guards/interceptors
- state management when justified
- utilities

### Backend

Suggested separation:
- routes/controllers
- services/use cases
- repositories/data access
- DTOs/input schemas
- entities/domain models
- middlewares/guards
- config
- shared utilities

### Database

Suggested separation:
- schema/models
- migrations
- seeds
- indexes
- constraints
- audit tables when needed

## Anti-patterns

Avoid:
- God components
- God services
- controllers with business logic
- duplicated validation rules
- direct database access spread everywhere
- frontend-only permission checks
- global mutable state without control
- circular dependencies
- large files with mixed concerns
- feature code mixed with unrelated refactors
- screen-by-screen inconsistent UI
- duplicate card/table/form implementations

## Refactoring rules

Refactor only when:
- it directly supports the task
- it removes real duplication
- it reduces risk
- it improves maintainability
- it does not break behavior

For large refactors:
- propose first
- separate from feature work
- explain risk
- define test plan
