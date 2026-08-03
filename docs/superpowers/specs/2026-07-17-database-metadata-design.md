# Database Metadata & CREATE LOCATION Reminder

## Goal

Improve Data Catalog UX around Athena DDL limits and Glue database metadata:

1. Remove unsupported `DESCRIBE DATABASE` template; align `CREATE DATABASE` with Athena docs.
2. Hover `i` on a catalog database → open **Database Metadata** (view/edit Location, COMMENT, DBPROPERTIES).
3. Soft-confirm when `CREATE DATABASE` / `CREATE TABLE` omits `LOCATION`, with per-account “don’t remind again”.

## Confirmed Decisions

| Topic | Decision |
|-------|----------|
| Engine for edits | Glue `GetDatabase` / `UpdateDatabase` (mirrors table metadata) |
| Metadata UI | Top tab mode: `Query` + mutually exclusive Metadata tab |
| Default metadata | Table Metadata |
| Open database metadata | Catalog tree hover `i` → Database Metadata tab |
| Open table metadata | Selecting a table → Table Metadata tab |
| Missing LOCATION | Soft dialog (Continue / Cancel) + “Don’t remind again” |
| Reminder preference | Per AWS account (`AthenaAccountPreferences`) |

## Layout / Interaction

- Top tabs: `Query` | (`Table Metadata` XOR `Database Metadata`)
- Clicking catalog `i` sets metadata kind to database and activates the Metadata tab.
- Selecting a table sets metadata kind to table and activates Table Metadata.
- Database panel fields (read-only default, Edit mode):
  - COMMENT → Glue `description`
  - LOCATION → Glue `locationUri`
  - DBPROPERTIES → Glue `parameters` (add + edit keys)

## Backend

| Command | Service |
|---------|---------|
| `get_glue_database` | Glue GetDatabase |
| `update_glue_database` | Glue UpdateDatabase |

## Templates

- Remove `DESCRIBE DATABASE`.
- `CREATE DATABASE` template:

```sql
CREATE DATABASE IF NOT EXISTS my_database
COMMENT 'Database description'
LOCATION 's3://bucket/path/my_database.db/'
WITH DBPROPERTIES ('creator' = 'example')
```

## LOCATION Reminder

Before Athena run, if SQL is `CREATE DATABASE|SCHEMA` or non-CTAS `CREATE [EXTERNAL] TABLE` without `LOCATION`, and preference not skipped → show confirm dialog. Continue may persist skip flag.
