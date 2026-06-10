# Backend Standards

## Objective

Build backend services that are secure, maintainable, testable and production-ready.

## Required structure

Prefer separation between:
- routes/controllers
- services/use cases
- repositories/data access
- DTOs/input validation
- entities/models
- middlewares/guards
- config
- error handling
- utilities

## Controllers

Controllers should:
- receive request
- extract params/body/query
- call validation when needed
- call service
- return response
- avoid business logic
- avoid direct database logic

## Services

Services should:
- contain business logic
- validate business rules
- coordinate database operations
- handle expected errors
- be easy to test
- avoid HTTP-specific concerns when possible

## Repositories / data access

Data access should:
- centralize queries
- avoid repeated query logic
- return only needed fields
- use transactions when required
- consider indexes and performance

## API design

APIs should:
- use clear names
- use consistent response shapes
- use proper HTTP status codes
- validate inputs
- protect sensitive fields
- support pagination for large lists
- support filters where needed
- document important endpoints

## Validation

Backend validation is mandatory for:
- create operations
- update operations
- login/register
- uploads
- admin operations
- financial/business-critical operations
- IDs and ownership checks

## Transactions

Use transactions when:
- multiple database writes must succeed together
- creating related records
- updating totals/counters
- changing states with side effects
- processing payments or critical business operations

## Background jobs

Consider background jobs for:
- emails
- notifications
- heavy reports
- file processing
- OCR
- large imports
- scheduled tasks

Do not block user requests with heavy processing if avoidable.

## Logging

Logs should:
- help diagnose production issues
- include useful context
- not expose secrets
- avoid excessive noise
- distinguish errors from expected validation failures
