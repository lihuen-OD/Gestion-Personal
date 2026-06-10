# Database Standards

## Objective

Design databases that are consistent, reliable, auditable and prepared for real business use.

## General rules

- Use clear table and field names.
- Avoid ambiguous fields.
- Avoid unnecessary duplication.
- Use relations correctly.
- Use constraints.
- Use indexes for frequent searches.
- Use migrations.
- Avoid destructive changes without explicit approval.
- Consider audit/history for important data.
- Consider soft delete for important records.
- Keep data integrity in the database, not only in code.

## Modeling checklist

Before adding a table or field:
- Does this data already exist?
- Is this an entity or an attribute?
- Is it required or optional?
- Does it need uniqueness?
- Does it need a relation?
- Does it need history?
- Does it need soft delete?
- Does it need an index?
- Will it be used in reports?
- Who can read or modify it?

## Constraints

Use constraints for:
- required relationships
- uniqueness
- valid enum/status values
- non-null required fields
- referential integrity

## Indexes

Consider indexes for:
- foreign keys
- frequent filters
- search fields
- date ranges
- status fields
- user ownership fields
- report filters

Do not add indexes blindly. Every index has write/storage cost.

## Migrations

Migrations should:
- be reviewed before deploy
- avoid data loss
- include backfill strategy when needed
- be reversible when possible
- be documented if risky

## Audit and history

Use audit/history when:
- changing employee/user/business-critical data
- changing permissions
- changing financial values
- deleting important records
- changing statuses
- performing admin actions

Audit should capture:
- who changed it
- what changed
- previous value
- new value
- when it changed
- reason if applicable
