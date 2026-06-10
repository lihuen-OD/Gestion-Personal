# DevOps and Deployment Standards

## Objective

Make projects deployable, observable and stable in production.

## Deployment checklist

Before deploy:
- build passes
- tests pass when available
- environment variables are configured
- database migrations are ready
- CORS is correct
- frontend points to correct backend
- backend connects to correct database
- logs do not expose secrets
- production error handling is enabled
- static files work if applicable

## Environment variables

Document every required variable:
- name
- purpose
- example value without secret
- required/optional
- used by frontend/backend
- production notes

Never commit real secrets.

## Frontend deploy

Check:
- correct build command
- correct output directory
- SPA fallback/rewrite configured
- public environment variables
- API base URL
- assets
- cache behavior

## Backend deploy

Check:
- correct start command
- correct port handling
- production environment
- database connection
- migrations
- CORS origins
- file upload storage
- external service credentials
- health endpoint if available

## Database deploy

Check:
- migration order
- destructive changes
- backup before risky migrations
- indexes
- permissions
- connection pooling
- SSL when required

## Observability

Production systems should have:
- useful logs
- error tracking when possible
- health checks when possible
- clear failure messages
- monitoring for critical services when possible

## Rollback thinking

Before risky deploys:
- know what changed
- know how to revert
- backup important data
- separate schema migration from app change if needed
