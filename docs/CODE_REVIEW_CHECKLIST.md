# Code Review Checklist

Use this checklist before closing any task.

## Requirement

- Was the user request understood correctly?
- Were assumptions documented?
- Were business rules respected?
- Was project context reviewed?

## Architecture

- Does the change fit the existing architecture?
- Is responsibility separated correctly?
- Is there duplicate logic?
- Is there overengineering?
- Is the solution maintainable?

## Frontend

- Are components clear?
- Are services used correctly?
- Are types/interfaces correct?
- Are loading/error/empty states handled?
- Are forms validated?
- Is mobile/responsive checked?
- Is desktop layout checked?
- Is UI consistent?
- Does it follow the design system?

## Backend

- Are endpoints protected?
- Are inputs validated?
- Are permissions checked?
- Is business logic in services?
- Are errors handled correctly?
- Are sensitive fields excluded?
- Are transactions needed?

## Database

- Is the schema correct?
- Are relations correct?
- Are constraints needed?
- Are indexes needed?
- Is migration safe?
- Is audit/history needed?

## Security

- Authentication checked?
- Authorization checked?
- Inputs validated?
- Sensitive data protected?
- Secrets not hardcoded?
- CORS safe?
- Uploads safe?
- Errors safe?

## UI / Product Design

- Does the UI look professional?
- Does desktop look good at 1366x768, 1440x900 and 1920x1080?
- Are icons prevented from overlapping text/numbers?
- Do KPI values fit inside cards?
- Are cards aligned?
- Are tables using available width?
- Is spacing consistent?
- Does the page avoid generic AI-looking design?

## Performance

- Any unnecessary queries?
- Any N+1 problem?
- Any missing pagination?
- Any excessive frontend renders?
- Any large payloads?
- Any unnecessary dependency?

## Testing

- Build checked?
- Types checked?
- Tests checked or suggested?
- Manual QA path provided?
- Edge cases considered?

## Deployment

- Env vars documented?
- Migration needed?
- CORS updated?
- Build/start commands affected?
- Production risks mentioned?
