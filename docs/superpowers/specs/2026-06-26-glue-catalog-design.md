# Glue Data Catalog Design

## Goal

Add a Data Catalog page for AWS Glue databases and tables with Athena SQL execution, local CSV export, read-only metadata viewing with optional edit mode, and SQL history/favorites.

## Confirmed Decisions

| Topic | Decision |
|-------|----------|
| Architecture | Glue API + Athena hybrid (Scheme A) |
| SQL engine | Amazon Athena |
| Management scope | Full: metadata, columns, partitions, create/delete, DDL |
| SQL UX | SQL editor primary + DDL templates |
| Export | Local CSV via save dialog |
| S3 output path | User base path + default append `submitUser` checkbox; dedupe suffix |
| Workgroup | Settings default per account + auto-discover + remember last selection |
| Metadata | Read-only by default; toggle to edit mode |
| SQL history | Last 20 submitted queries per account (localStorage) |
| SQL favorites | Named bookmarks per account (localStorage) |

## Layout

Three-pane workspace matching S3 Browser / Logs patterns:

- Left: catalog tree (database → tables)
- Right top: query bar (workgroup, S3 path, append submitUser, templates, run/stop)
- Right middle: SQL editor
- Right bottom: tabs for Results and Table Metadata (read-only default)

## Backend Commands

| Command | Service |
|---------|---------|
| `list_glue_databases` | Glue |
| `list_glue_tables` | Glue |
| `get_glue_table` | Glue |
| `update_glue_table` | Glue |
| `list_athena_workgroups` | Athena |
| `start_athena_query` | Athena |
| `get_athena_query_execution` | Athena |
| `get_athena_query_results` | Athena |
| `stop_athena_query` | Athena |
| `export_athena_query_csv` | Athena + save dialog |

Catalog: Glue API omits `catalogId` by default (uses account catalog). Athena queries still use `AwsDataCatalog`.

## Frontend Storage (per account, localStorage)

- `athenaOutputBasePath`
- `appendSubmitUser` (default true)
- `lastAthenaWorkgroup`
- `defaultAthenaWorkgroup` (Settings)
- `checkSqlHistory` (max 20 entries, dedupe by SQL text)
- `savedSqlFavorites` (id, name, sql, createdAt)

## Metadata Panel

- Default: read-only display of description, owner, parameters, columns, partitions, storage
- "Edit metadata" button enables form fields; Save calls `update_glue_table`
- Cancel returns to read-only

## SQL History & Favorites

- On successful query submit: prepend to history (dedupe, cap 20)
- History dropdown: click to load SQL into editor
- Star icon on history entry → add to favorites with prompt for name
- Favorites dropdown in query bar for quick load/remove
