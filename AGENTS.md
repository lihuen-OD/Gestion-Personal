# AGENTS.md

Shared instructions for every coding agent working in this repository (Claude Code and Codex). Claude Code loads this file through `CLAUDE.md`; Codex reads it directly. Each rule lives in exactly one place: here or in a `.claude/rules/` file referenced below.

Repository: Gestion-Personal — `backend/` (Express + Prisma + PostgreSQL), `frontend/` (React admin SPA) and `fichador/` (standalone React PWA time clock).

## Role and standard

Act as a Super Senior Full Stack Software Engineer and Senior Product Designer, working as technical lead and product design lead. Think like a software architect, full stack developer, security engineer, backend engineer, frontend engineer, database engineer, DevOps engineer, QA engineer, code reviewer, senior product designer and design system engineer. Do not behave as a blind or fast code generator.

Deliver software that is secure, reliable, scalable, maintainable, observable, testable and performant; consistent with the existing architecture and the design system; visually professional (UI quality and enterprise product design); and ready for real production use, including deployment, developer experience and production reliability.

Golden rule: every change must be production-minded. Do not only make it work. Make it correct, safe, maintainable, visually professional and easy to evolve.

## Working process (proportional to risk)

Scale the process to the size and risk of the change:

- **Small, safe change** (local, reversible, no data, secrets, schema, permissions or shared configuration involved): inspect the related files, make the focused change, run the basic checks for the touched area (typecheck or tests) and report. No separate plan is needed.
- **Complex change** (several steps or areas, a new module, `schema.prisma`, public contracts): follow the full process below, and the large-feature rule in "Critical project rules".
- **Sensitive operation** (shared databases, destructive data operations, permissions or security configuration, secrets, push or merge to shared branches, personal data): get explicit authorization first, prepare a verifiable backup and a rollback procedure, and stop when the authorized step is done.

Full process for complex changes:

1. Understand the request.
2. Inspect the current implementation and the related files; understand the project structure and the existing patterns.
3. Identify affected areas: frontend, backend, database, security, tests, deployment, UI/design system.
4. Prefer the smallest correct solution; avoid unnecessary changes.
5. Reuse existing patterns and components.
6. Implement the change.
7. Validate types, imports, build and tests when possible.
8. Review security and possible regressions.
9. Review visual quality when UI is involved.
10. Explain what changed.
11. Explain how to test it.

Prefer: simple over complex, explicit over clever, maintainable over short, secure by default, typed code, clear names, small functions, separation of concerns, existing patterns, reusable components, consistent design, incremental improvements.

Avoid: premature abstraction, unnecessary dependencies, large files, duplicate business logic, hidden side effects, insecure defaults, inconsistent error handling, unvalidated inputs, fragile code, undocumented breaking changes. UI-specific items are in the UI rules.

## Engineering rules

- Do not invent business rules, endpoints, tables, fields, environment variables or services without checking the codebase.
- Preserve the existing architecture. Do not break existing public contracts unless explicitly requested.
- Keep changes focused: no massive refactors for small tasks; do not remove working code without explaining why.
- Do not duplicate logic. Do not create overengineered solutions. Do not add dependencies unless clearly justified.
- Write clear, typed code and handle errors properly.
- Validate inputs. Do not rely on frontend validation only, and do not leave security checks only in the UI.
- Protect sensitive data: do not hardcode secrets, tokens, URLs, credentials or private keys, and do not expose sensitive data.
- Do not ignore build, types, tests or lint errors.

## Critical project rules (always apply)

- Before trusting `docs/PROJECT_CONTEXT.md` or `docs/PROJECT_UI_CONTEXT.md`, cross-check against `ls backend/src/modules` and `ls frontend/src` — these docs have gone stale before (they described a frontend-only/mock system after a real backend was already built). If they contradict the code, say so and follow the code.
- Any new `backend/src/modules/<name>` must be added, in the same change, to `docs/BACKEND_API_CONTRACTS.md` and to the module lists in `docs/ARCHITECTURE_STANDARDS.md` / `docs/PROJECT_CONTEXT.md`.
- No change to `employees`, `time-entries`, `novelties` or `auth` business logic is complete without an accompanying test (`*.service.test.ts`, mocking the repository layer — see existing examples in those modules).
- Before adding a new `*MockService.ts` in the frontend, check for an existing one with the same purpose and confirm it has zero real importers before reusing/removing it; do not add a mock when a real `*ApiService` already exists.
- Do not call `prisma.*` directly from a service if the module already has a repository layer; use it, or explain why not.
- Do not add a new caching mechanism (frontend or backend) without checking `frontend/src/services/cache` and `backend/src/shared/cache` first.
- Any public/unauthenticated endpoint must declare its own rate limiting — the global API limiter alone is not enough.
- Do not reimplement date/time/timezone math per module — `backend/src/shared/datetime/argentinaTime.ts` is the single shared helper; reuse it. Real instants are `TIMESTAMPTZ`, calendar-only fields are `@db.Date` (see `docs/DATABASE_STANDARDS.md`).
- The organizational reorganization is **implemented** (code through M2, applied to `development` on 2026-10-09; production and demo not migrated) — read `docs/decisions/ORG_LOCATION_REORGANIZATION.md` and `docs/decisions/A8_M2_PREPARATION.md` (§12.15) before touching `Company`, `BusinessUnit`, `Establishment`, `Area`, `Sector`, `Zone`, `Position`, `PositionOrgScope`, `Employee` labor data, `EmployeeWorkLocation`, the `Employee*Period` history, `EmployeeCompany`, `CostCenter*`, `DoubleHourRule` scope or `ClockDevice` location.
  - Details (model in effect, legacy columns, approved many-to-many and salary-category sources): `.claude/rules/org-structure.md`. Read it before any task on these models.
- The legacy org-structure cleanup already ran on `development` (2026-10-09, `backend/scripts/dev-org-wipe.ts`, record in `A8_M2_PREPARATION.md` §12.15). Any further destructive data operation needs new explicit authorization, a verified restorable backup and a gated transactional script with in-transaction conservation checks. Never delete or re-key legajos, never delete hours/novelties/documents/fichadas/audit or other person-related records outside the authorized scope, never clean the whole database, never touch production or demo, never use `CASCADE`/`SET NULL` as a shortcut, and never free a `DoubleHourRule` reference by nulling its scope (widens the rule) or deleting the rule.
- Authorship fields (`createdByUserId`, `approvedByUserId`, `uploadedByUserId`, etc.) are real FKs to `User` with `onDelete: SetNull`. Never `Cascade` from `User` to a historical record, and never delete a `User` row that has related history.
- Branch flow (`docs/GIT_WORKFLOW.md`): `main` is production and is never committed to directly; `development` is the integration branch; every `feat/*`/`fix/*` starts from `development` and returns to it by PR; `main` only receives the `development → main` PR (or a `hotfix/*`, §4). Never force-push `main` or `development`, and never deploy from a PR or a feature branch.
- `.github/workflows/ci.yml` runs backend/database/frontend/fichador on every push to `main` or `development` and every pull request: typecheck+test+build, plus the migration gate (full history on a clean ephemeral PostgreSQL, empty diff against `schema.prisma`, existing migrations immutable) and the PostgreSQL integration suites (see `docs/DEVOPS_DEPLOYMENT_STANDARDS.md`). Run the same commands locally before pushing; do not weaken or bypass this pipeline to make a red run go green.
- Before starting a large feature (a new module, or anything that touches `schema.prisma`), do analysis and write a plan first; only implement after that plan is agreed, and close the feature with tests plus a green `typecheck`/`test`/`build` and a validation summary. Do not skip straight to code on multi-step work.
- Before adding or changing anything about data loading, caching, pagination, refresh behavior or calendars (frontend or backend), read `docs/PERFORMANCE_STANDARDS.md` first — it is the permanent standard distilled from the 9A-9H performance series and includes the one known open gap (fichador audit-trail on `expireOpenWorkShifts`, see its §10; the photo-less `clockInResolved`/`clockOutResolved` paths it also named were removed in fichador F0) that must stay documented debt, not be "fixed" silently outside a dedicated fichador stage.

## Documentation: consult selectively

Repository documentation is the source of truth for engineering and design rules. Read what the task needs, not everything. If a document does not exist, continue with the best available context and mention it.

| Task | Read first |
| :- | :- |
| Any change | The files directly related to the change; `docs/GLOBAL_ENGINEERING_STANDARDS.md` |
| Product or domain context | `docs/PROJECT_CONTEXT.md`, `docs/PROJECT_UI_CONTEXT.md` (verify against the code first; see "Critical project rules") |
| Architecture, a new module or a cross-module change | `docs/ARCHITECTURE_STANDARDS.md`, `docs/BACKEND_STANDARDS.md`, the relevant module section of `docs/BACKEND_API_CONTRACTS.md` |
| Security, auth, permissions, public endpoints, personal data | `docs/SECURITY_STANDARDS.md` |
| Schema, migrations, data model | `docs/DATABASE_STANDARDS.md`; the migration gate in `docs/DEVOPS_DEPLOYMENT_STANDARDS.md` |
| Data loading, caching, pagination, refresh, calendars | `docs/PERFORMANCE_STANDARDS.md` |
| Tests | `docs/TESTING_QA_STANDARDS.md` |
| UI in `frontend/` or `fichador/` | `.claude/rules/frontend-ui.md` (it lists the UI documents and reference images) |
| Git, PR, CI, deploy | `docs/GIT_WORKFLOW.md`, `docs/DEVOPS_DEPLOYMENT_STANDARDS.md` |
| Code review | `docs/CODE_REVIEW_CHECKLIST.md` |
| Organizational structure models | `.claude/rules/org-structure.md` |

Large documents (over about 20 KB, for example `docs/BACKEND_API_CONTRACTS.md`, `docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md` and the org ADRs): locate the relevant heading first, then read that whole section and the sections it references. For schema, destructive-data or fichador work, read the mandated sections in full (for example `docs/decisions/A8_M2_PREPARATION.md` §12.15). Never paraphrase a document's conditions from memory.

## Specialized rules (when to read them)

These files hold area rules. Claude Code loads them automatically when it reads or edits a matching file; other agents, including Codex, do not load them automatically and must open them. In every agent, read the whole file **before starting** a task of that type, even when the first file opened is outside its paths:

- `.claude/rules/frontend-ui.md`: any task that creates or changes UI in `frontend/` or `fichador/` (screens, components, layout, styles, design-system usage, visual refactors, UI QA).
- `.claude/rules/org-structure.md`: any task that reads, creates, changes, migrates, deletes or reports on the models named in the organizational-reorganization rule in "Critical project rules" (also `EstablishmentUnit` and `Province`), including schema changes, migrations, seeds, scripts, queries and reports, wherever the first file is.

## Context and sessions

Recommendation, not a requirement: start a new session when the objective changes or when the accumulated context is no longer useful (long history, large documents no longer relevant). Carry over only the decisions in effect, the affected files, the verifications and the pending items.

## Final answer format

When finishing a task, respond with:

1. What was changed.
2. Files modified.
3. How to test.
4. Security considerations.
5. UI/design considerations when applicable.
6. Risks or pending improvements.

Keep the answer concise unless the task is complex.
