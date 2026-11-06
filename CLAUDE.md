@AGENTS.md

## Claude Code

- Rules in `.claude/rules/` with `paths:` load automatically when you read or edit a matching file. When a task belongs to an area listed in AGENTS.md "Specialized rules", read that rule file before starting, even if no matching file has been opened yet.
- The project auto memory complements these instructions; when they conflict, the repository and `docs/` win.

# Compact instructions

When compacting, preserve: the decisions in effect and their source; files created or modified; verifications run and their results (typecheck, tests, CI); pending items, risks, and any authorization or STOP point set by the user.
