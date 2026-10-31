//! DBHub SQL tools for the MCP server.
//!
//! Each AI-enabled connection in the active account is advertised as its own
//! tool named `execute_sql_<slug>`, where the slug is derived from the
//! connection's display name. Calls re-resolve the connection by slug inside
//! the active account, refuse disabled / deleted / foreign-account ids, then
//! dial through the same Network Profile route as the workspace query tab
//! (`tunnel::dial_target_for`) and run through the read-only gate + session in
//! `dbhub::query`. Audit rows go through the server's `run_tool`, so Chat-driven
//! and agent-driven calls are audited exactly once like every other tool.
//!
//! The AI path builds its ruling from the connection's stored mode
//! (`GatePolicy::for_ai`), and never from the connection's own write switch,
//! which it does not read at all. The model cannot modify a database through
//! this tool, whatever the mode says.

use std::sync::Arc;

use rmcp::model::Tool;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::db::dbhub::session::QueryCancellation;
use crate::db::dbhub::{self, gate, query, tunnel};
use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::DbConnection;

/// Prefix for per-connection MCP tools. The rest of the name is the slug.
pub const EXECUTE_SQL_PREFIX: &str = "execute_sql_";

/// Hard cap on rows one tool call may return (design: protect the model's
/// context; the UI path caps at 500).
const TOOL_MAX_ROWS: usize = 100;
/// Text-size cap per cell and per result — mirrors the chat tools' rule of
/// explicit `[truncated]` markers rather than silent cuts.
const CELL_CAP: usize = 2_000;
const RESULT_TEXT_CAP: usize = 60_000;

/// Turn a connection display name into the slug half of `execute_sql_<slug>`.
///
/// Only ASCII letters, digits and underscores survive; everything else becomes
/// a single underscore, runs of underscores collapse, and leading/trailing
/// underscores are dropped. Empty after sanitising means the name cannot
/// register an AI tool.
pub fn connection_slug(name: &str) -> String {
    let mut out = String::new();
    let mut pending_underscore = false;
    for ch in name.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            if pending_underscore && !out.is_empty() {
                out.push('_');
            }
            out.push(lower);
            pending_underscore = false;
        } else {
            pending_underscore = true;
        }
    }
    out
}

/// `execute_sql_<slug>` for a connection name, or `None` when the name has no
/// usable characters.
pub fn tool_name_for(name: &str) -> Option<String> {
    let slug = connection_slug(name);
    if slug.is_empty() {
        None
    } else {
        Some(format!("{EXECUTE_SQL_PREFIX}{slug}"))
    }
}

/// True when `name` is an `execute_sql_*` tool advertisement.
pub fn is_dbhub_tool_name(name: &str) -> bool {
    name.starts_with(EXECUTE_SQL_PREFIX) && name.len() > EXECUTE_SQL_PREFIX.len()
}

/// Refuse saving / enabling AI when another AI-enabled connection in the same
/// account already occupies this tool slug. `exclude_id` skips the connection
/// being updated so a no-op rename does not collide with itself.
pub async fn ensure_ai_tool_name_available(
    pool: &SqlitePool,
    account_id: &str,
    name: &str,
    exclude_id: Option<&str>,
) -> AppResult<()> {
    let Some(tool_name) = tool_name_for(name) else {
        return Err(AppError::validation(
            "Connection name must contain letters or digits to register an AI tool.",
        ));
    };
    let slug = connection_slug(name);
    for connection in dbhub::list_connections(pool, account_id).await? {
        if exclude_id.is_some_and(|id| id == connection.id) {
            continue;
        }
        if !connection.enabled_for_ai {
            continue;
        }
        if connection_slug(&connection.name) == slug {
            return Err(AppError::validation(format!(
                "AI tool name `{tool_name}` is already used by connection \"{}\". Rename one of them.",
                connection.name
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteSqlArgs {
    /// One read-only SQL statement (SELECT/SHOW/DESCRIBE/EXPLAIN). Anything
    /// else is refused by the read-only gate — the connection cannot be
    /// modified through this tool.
    pub sql: String,
    /// Maximum rows to return (1-100). Defaults to 50.
    #[serde(default)]
    #[schemars(description = "Maximum rows to return (1-100). Defaults to 50.")]
    pub max_rows: Option<usize>,
}

/// Shared args shape kept for callers that still know a connection id
/// (workspace / tests). Dynamic tools use [`ExecuteSqlArgs`] instead.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SqlQueryTextArgs {
    pub connection_id: String,
    pub sql: String,
    #[serde(default)]
    pub max_rows: Option<usize>,
}

/// The tool's own result shape: on success the columns/rows of the page plus
/// honest truncation flags; on failure a structured error the model can act on.
///
/// `status: "needsConfirmation"` is a third outcome — not success, not refusal —
/// and carries a `confirmationId` the UI uses to run the statement once a
/// person clicks Confirm. The reason text is always authored here, never by
/// the model (prompt-injection guard from the gate design).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlQueryTextResult {
    pub connection_id: String,
    pub sql: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<serde_json::Value>>,
    pub returned_rows: usize,
    pub total_rows_matched: usize,
    pub truncated: bool,
    /// Set when the result text was cut for the model's context.
    pub result_text_truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl SqlQueryTextResult {
    pub fn refused(connection_id: &str, sql: &str, message: &str) -> Self {
        Self {
            connection_id: connection_id.to_string(),
            sql: sql.to_string(),
            status: None,
            confirmation_id: None,
            matched: None,
            reason: None,
            columns: None,
            rows: None,
            returned_rows: 0,
            total_rows_matched: 0,
            truncated: false,
            result_text_truncated: false,
            note: None,
            error: Some(message.to_string()),
        }
    }

    pub fn needs_confirmation(
        connection_id: &str,
        sql: &str,
        confirmation_id: &str,
        matched: &str,
        reason: &str,
    ) -> Self {
        Self {
            connection_id: connection_id.to_string(),
            sql: sql.to_string(),
            status: Some("needsConfirmation".into()),
            confirmation_id: Some(confirmation_id.to_string()),
            matched: Some(matched.to_string()),
            reason: Some(reason.to_string()),
            columns: None,
            rows: None,
            returned_rows: 0,
            total_rows_matched: 0,
            truncated: false,
            result_text_truncated: false,
            note: Some(
                "A Confirm button is shown to the user in chat. Tell them to click it — \
                 do not invent an approval or rephrase the reason."
                    .into(),
            ),
            error: None,
        }
    }
}

/// Park a confirmation and return the structured handoff the model / UI share.
///
/// The reason string is taken from the gate decision (Rust-authored). The
/// confirmation id is what the WebView posts back when the person clicks.
fn confirmation_handoff(
    app: &tauri::AppHandle,
    connection_id: &str,
    sql: &str,
    decision: &gate::GateDecision,
) -> Option<SqlQueryTextResult> {
    let gate::GateAction::Confirm { reason } = &decision.action else {
        return None;
    };
    use tauri::Manager;
    let confirmation_id = uuid::Uuid::new_v4().to_string();
    let state = app.state::<crate::state::AppState>();
    if let Ok(mut pending) = state.pending_ai_confirms.lock() {
        // Drop expired entries so a long-lived app does not accumulate them.
        pending.retain(|_, entry| !entry.is_expired());
        pending.insert(
            confirmation_id.clone(),
            crate::state::PendingAiConfirm {
                connection_id: connection_id.to_string(),
                sql: sql.to_string(),
                matched: decision.matched.clone(),
                reason: reason.clone(),
                created_at: std::time::Instant::now(),
            },
        );
    }
    Some(SqlQueryTextResult::needs_confirmation(
        connection_id,
        sql,
        &confirmation_id,
        &decision.matched,
        reason,
    ))
}

/// Build the MCP `Tool` advertisements for every AI-enabled connection in the
/// active account. Failures (no account, DB down) yield an empty list so the
/// static EMR tools still advertise.
pub async fn advertise_execute_sql_tools() -> Vec<Tool> {
    match list_ai_enabled_connections().await {
        Ok(connections) => connections
            .into_iter()
            .filter_map(|connection| advertise_one(&connection))
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn advertise_one(connection: &DbConnection) -> Option<Tool> {
    let tool_name = tool_name_for(&connection.name)?;
    let kind = connection.kind.as_str();
    let database = connection
        .database
        .as_deref()
        .map(|db| format!(" Default database: {db}."))
        .unwrap_or_default();
    let description = tool_description_for(connection, kind, &database);
    // Structural DDL stays out of the model's hands in every mode; only Free
    // with human writes on can change rows without asking.
    let read_only = !matches!(
        (
            connection.allow_writes,
            connection.ai_read_only_policy
        ),
        (true, crate::models::DbReadOnlyPolicy::Free)
            | (true, crate::models::DbReadOnlyPolicy::Confirm)
    );
    Some(
        Tool::new(tool_name, description, execute_sql_input_schema()).annotate(
            rmcp::model::ToolAnnotations::new()
                .read_only(read_only)
                .destructive(!read_only)
                .open_world(true),
        ),
    )
}

fn tool_description_for(connection: &DbConnection, kind: &str, database: &str) -> String {
    use crate::models::DbReadOnlyPolicy;
    // AI is capped by the human write switch: without it every mode is observer.
    let effective = if connection.allow_writes {
        connection.ai_read_only_policy
    } else {
        DbReadOnlyPolicy::Observer
    };
    let mode = match effective {
        DbReadOnlyPolicy::Observer => {
            "Read-only: only SELECT/SHOW/DESCRIBE/EXPLAIN. Writes are refused."
        }
        DbReadOnlyPolicy::Confirm => {
            "Reads run freely. Statements that change data return needsConfirmation \
             and wait for the user to click Confirm in chat — do not invent an approval."
        }
        DbReadOnlyPolicy::Free => {
            "Reads and row changes run. Structural DDL (DROP/ALTER/CREATE/…) is always refused \
             and must be handed to a person."
        }
    };
    format!(
        "Run ONE SQL statement against the {kind} connection \"{}\".{database} {mode} \
         Rows are capped (default 50, max 100) and oversized text is marked [truncated].",
        connection.name
    )
}

fn execute_sql_input_schema() -> Arc<serde_json::Map<String, serde_json::Value>> {
    let schema = schemars::schema_for!(ExecuteSqlArgs);
    let value = serde_json::to_value(schema).unwrap_or_else(|_| {
        serde_json::json!({
            "type": "object",
            "properties": {
                "sql": { "type": "string" },
                "maxRows": { "type": "integer" }
            },
            "required": ["sql"]
        })
    });
    Arc::new(value.as_object().cloned().unwrap_or_default())
}

/// Resolve `execute_sql_<slug>` against the active account and run one query.
pub async fn execute_sql_by_slug(
    app: &tauri::AppHandle,
    slug: &str,
    args: &ExecuteSqlArgs,
) -> AppResult<SqlQueryTextResult> {
    if slug.is_empty() {
        return Err(AppError::validation("Unknown database tool."));
    }
    let connection = resolve_connection_by_slug(slug).await?;
    sql_query_text(
        app,
        &SqlQueryTextArgs {
            connection_id: connection.id,
            sql: args.sql.clone(),
            max_rows: args.max_rows,
        },
    )
    .await
}

pub async fn sql_query_text(
    app: &tauri::AppHandle,
    args: &SqlQueryTextArgs,
) -> AppResult<SqlQueryTextResult> {
    let max_rows = args.max_rows.unwrap_or(50).clamp(1, TOOL_MAX_ROWS);

    // Resolution happens per call inside the active account: a connection that
    // was deleted, disabled for AI, or belongs to another account is refused
    // here rather than at advertisement time (clients may cache tool lists).
    let shape = resolve_shape(app, &args.connection_id).await?;

    // Same route as the workspace query tab: when the connection references a
    // Network Profile, open the SSH/SOCKS5 forward and keep `_forward` alive
    // for the duration of `execute` (dropping it closes the tunnel).
    let (target, _forward) = tunnel::dial_target_for(&shape.pool, app, &shape.connection).await?;
    // `GatePolicy::read_only` and not the connection's own setting: however the
    // user has configured writes for their own typing, the model never gets a
    // session that can write. This is the ceiling the design keeps in code
    // rather than in configuration.
    //
    // The connection's stored mode, which is the one setting on this path that
    // is *meant* to be configuration: observer reads, confirm is meant to ask a
    // person, free is capped (decision 1). Nothing services a confirmation yet,
    // so `confirm` and `free` both end in the same refusal an observer gets —
    // but the mode is now read rather than assumed, so landing the approval
    // surface changes the mapping in one place instead of here.
    //
    // What this path still does not read is the connection's `allow_writes`,
    // and that stays hardcoded to no: however the user has configured writes for
    // their own typing, the model never gets a session that can write.
    //
    // The tier overrides are not applied here either. An override is the one
    // thing that can *loosen* the ladder, and `TRUNCATE: free` — a reasonable
    // rule for someone working on a staging database — would also hand the model
    // a truncate. Whether a rule written for a person's own typing should grant
    // the AI the same reach is a real question and not one to answer by
    // accident, so this path stays at the strict end until it is answered.
    let dialect = crate::db::dbhub::sql::SqlDialect::from_kind(shape.connection.kind);
    // Iron rule: AI ≤ human. Without allow_writes the AI is observer regardless
    // of the stored mode.
    let mut policy = gate::GatePolicy::for_ai(shape.connection.ai_read_only_policy);
    if !shape.connection.allow_writes {
        policy.reach = gate::Reach::ReadOnly;
    }
    let decision = policy.decide(gate::classify_with_dialect(&args.sql, dialect));

    // What the gate stopped is worth remembering — a statement the AI keeps
    // reaching for is the clearest signal that a rule is missing — and a
    // confirmation counts: the model was stopped and the reader may well want a
    // rule. The recorded tier tells the two apart.
    if matches!(
        decision.action,
        gate::GateAction::Refuse { .. } | gate::GateAction::Confirm { .. }
    ) {
        let _ = dbhub::store::record_refusal(
            &shape.pool,
            &shape.connection.id,
            &args.sql,
            decision.tier,
            &decision.matched,
            decision.actor,
        )
        .await;
    }

    // A confirmation is not a refusal, and the model should be able to tell them
    // apart: this one has a next step (a Confirm button), and the tool is where
    // it gets named.
    if let Some(handoff) = confirmation_handoff(app, &args.connection_id, &args.sql, &decision) {
        return Ok(handoff);
    }

    let result = query::execute(
        &shape,
        &target,
        &args.sql,
        max_rows,
        0,
        &decision,
        &QueryCancellation::never(),
    )
    .await?;

    let serialized = serde_json::to_string(&result.rows).unwrap_or_default();
    let result_text_truncated = serialized.len() > RESULT_TEXT_CAP;

    Ok(SqlQueryTextResult {
        connection_id: args.connection_id.clone(),
        sql: args.sql.clone(),
        status: None,
        confirmation_id: None,
        matched: None,
        reason: None,
        columns: Some(result.columns),
        rows: Some(
            result
                .rows
                .into_iter()
                .map(|row| cap_cells(row, CELL_CAP))
                .collect(),
        ),
        returned_rows: result.row_count,
        total_rows_matched: result.row_count,
        truncated: result.truncated,
        result_text_truncated,
        note: if result.truncated {
            Some(format!(
                "Result page capped at {max_rows} rows. Narrow the query (WHERE / LIMIT) for more."
            ))
        } else {
            None
        },
        error: None,
    })
}

/// Accept a parked AI confirmation and run the statement.
pub async fn confirm_pending_ai_sql(
    app: &tauri::AppHandle,
    confirmation_id: &str,
) -> AppResult<SqlQueryTextResult> {
    use tauri::Manager;

    let pending = {
        let state = app.state::<crate::state::AppState>();
        let mut map = state
            .pending_ai_confirms
            .lock()
            .map_err(|error| AppError::internal(format!("Failed to lock confirms: {error}")))?;
        map.retain(|_, entry| !entry.is_expired());
        map.remove(confirmation_id)
    };
    let Some(pending) = pending else {
        return Err(AppError::validation(
            "That confirmation has expired or was already used.",
        ));
    };

    // Re-run through the same path with confirmed:true equivalent: build the
    // AI policy decision and mark it confirmed so the gate does not ask again.
    let shape = resolve_shape(app, &pending.connection_id).await?;
    let (target, _forward) = tunnel::dial_target_for(&shape.pool, app, &shape.connection).await?;
    let dialect = crate::db::dbhub::sql::SqlDialect::from_kind(shape.connection.kind);
    let mut policy = gate::GatePolicy::for_ai(shape.connection.ai_read_only_policy);
    if !shape.connection.allow_writes {
        policy.reach = gate::Reach::ReadOnly;
    }
    let decision = policy
        .decide(gate::classify_with_dialect(&pending.sql, dialect))
        .confirmed();

    let result = query::execute(
        &shape,
        &target,
        &pending.sql,
        50,
        0,
        &decision,
        &QueryCancellation::never(),
    )
    .await?;

    let serialized = serde_json::to_string(&result.rows).unwrap_or_default();
    Ok(SqlQueryTextResult {
        connection_id: pending.connection_id,
        sql: pending.sql,
        status: Some("confirmed".into()),
        confirmation_id: Some(confirmation_id.to_string()),
        matched: Some(pending.matched),
        reason: None,
        columns: Some(result.columns),
        rows: Some(
            result
                .rows
                .into_iter()
                .map(|row| cap_cells(row, CELL_CAP))
                .collect(),
        ),
        returned_rows: result.row_count,
        total_rows_matched: result.row_count,
        truncated: result.truncated,
        result_text_truncated: serialized.len() > RESULT_TEXT_CAP,
        note: None,
        error: None,
    })
}

/// Drop a parked confirmation without running it.
pub fn dismiss_pending_ai_sql(app: &tauri::AppHandle, confirmation_id: &str) -> AppResult<bool> {
    use tauri::Manager;
    let state = app.state::<crate::state::AppState>();
    let mut map = state
        .pending_ai_confirms
        .lock()
        .map_err(|error| AppError::internal(format!("Failed to lock confirms: {error}")))?;
    Ok(map.remove(confirmation_id).is_some())
}

/// Cap any string cell in the row object so one wide value cannot dominate.
fn cap_cells(mut row: serde_json::Value, cap: usize) -> serde_json::Value {
    if let serde_json::Value::Object(map) = &mut row {
        for (_, value) in map.iter_mut() {
            if let serde_json::Value::String(text) = value {
                if text.len() > cap {
                    let mut cut_at = cap;
                    while !text.is_char_boundary(cut_at) {
                        cut_at -= 1;
                    }
                    text.truncate(cut_at);
                    text.push_str("…[truncated]");
                }
            }
        }
    }
    row
}

async fn active_account_id(pool: &SqlitePool) -> AppResult<String> {
    repository::active_aws_account(pool)
        .await?
        .map(|account| account.id)
        .ok_or_else(|| {
            AppError::validation("No active AWS account. Configure one in Settings first.")
        })
}

async fn list_ai_enabled_connections() -> AppResult<Vec<DbConnection>> {
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;
    Ok(dbhub::list_connections(&pool, &account_id)
        .await?
        .into_iter()
        .filter(|connection| connection.enabled_for_ai)
        .collect())
}

/// Find the AI-enabled connection whose name slug matches. Call-time check is
/// the "turn off AI → old tool name refuses immediately" contract — clients may
/// still advertise a cached list.
pub async fn resolve_connection_by_slug(slug: &str) -> AppResult<DbConnection> {
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;
    resolve_connection_by_slug_in(&pool, &account_id, slug).await
}

async fn resolve_connection_by_slug_in(
    pool: &SqlitePool,
    account_id: &str,
    slug: &str,
) -> AppResult<DbConnection> {
    let matches: Vec<DbConnection> = dbhub::list_connections(pool, account_id)
        .await?
        .into_iter()
        .filter(|connection| connection.enabled_for_ai && connection_slug(&connection.name) == slug)
        .collect();
    match matches.len() {
        1 => Ok(matches.into_iter().next().expect("len checked")),
        0 => Err(AppError::validation(format!(
            "No AI-enabled connection matches tool `{EXECUTE_SQL_PREFIX}{slug}`. \
             Enable the connection for AI on the DBHub Overview card, or use the new tool name after a rename."
        ))),
        _ => Err(AppError::validation(format!(
            "Multiple AI-enabled connections share tool `{EXECUTE_SQL_PREFIX}{slug}`. Rename one of them."
        ))),
    }
}

async fn resolve_shape(
    app: &tauri::AppHandle,
    connection_id: &str,
) -> AppResult<query::DbConnectionShape> {
    let pool = repository::pool().await?;
    let account_id = active_account_id(&pool).await?;
    let connection = dbhub::get_connection(&pool, &account_id, connection_id)
        .await?
        .ok_or_else(|| {
            // Foreign and missing ids read identically — no oracle for ids of
            // other accounts.
            AppError::validation("Connection was not found in the active account.")
        })?;
    if !connection.enabled_for_ai {
        return Err(AppError::validation(
            "This connection is not enabled for AI queries. Enable it on the DBHub Overview card.",
        ));
    }
    let password =
        crate::secrets::read_optional_secret(app, &format!("db/{connection_id}/password"))
            .unwrap_or(None);
    Ok(query::DbConnectionShape {
        pool: repository::pool().await?,
        connection,
        password,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DbConnectionKind, DbReadOnlyPolicy};
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect");
        dbhub::migrate(&pool).await.expect("migrate");
        pool
    }

    fn connection(account_id: &str, id: &str, name: &str, enabled_for_ai: bool) -> DbConnection {
        DbConnection {
            id: id.to_string(),
            account_id: account_id.to_string(),
            kind: DbConnectionKind::Mysql,
            name: name.to_string(),
            host: "10.0.0.1".to_string(),
            port: 3306,
            database: Some("sales".to_string()),
            username: "bi_reader".to_string(),
            network_profile_id: None,
            show_as_tab: true,
            enabled_for_ai,
            ai_read_only_policy: DbReadOnlyPolicy::Observer,
            gate_overrides: Default::default(),
            allow_writes: false,
            auth_mode: crate::models::DbAuthMode::Manual,
            secret_arn: None,
            secret_name: None,
            sort_order: 0,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn slug_keeps_letters_digits_and_underscores() {
        assert_eq!(connection_slug("MySQL1"), "mysql1");
        assert_eq!(connection_slug("MySQL-Prod"), "mysql_prod");
        assert_eq!(connection_slug("  Sales DB!! "), "sales_db");
        assert_eq!(connection_slug("___"), "");
        assert_eq!(
            tool_name_for("MySQL1").as_deref(),
            Some("execute_sql_mysql1")
        );
        assert_eq!(tool_name_for("!!!"), None);
    }

    #[test]
    fn a_confirmation_is_handed_to_a_person_rather_than_flatly_refused() {
        // Observer and confirm mode both stop a write. The model can only tell
        // them apart if the tool says which — one of them has a next step, and
        // that difference is the whole of what a confirm mode means today.
        let sql = "DELETE FROM t WHERE id = 1";

        let confirming =
            gate::GatePolicy::for_ai(DbReadOnlyPolicy::Confirm).decide(gate::classify(sql));
        assert!(
            matches!(confirming.action, gate::GateAction::Confirm { .. }),
            "confirm mode raises Confirm"
        );
        let reason = match &confirming.action {
            gate::GateAction::Confirm { reason } => reason.clone(),
            _ => unreachable!(),
        };
        let handoff = SqlQueryTextResult::needs_confirmation(
            "c1",
            sql,
            "cid-1",
            &confirming.matched,
            &reason,
        );
        assert_eq!(handoff.status.as_deref(), Some("needsConfirmation"));
        assert_eq!(handoff.confirmation_id.as_deref(), Some("cid-1"));
        assert!(handoff.error.is_none());
        assert!(
            handoff.note.as_deref().unwrap_or("").contains("Confirm"),
            "{:?}",
            handoff.note
        );

        // An observer is refused, not confirmed — no handoff shape.
        let observing =
            gate::GatePolicy::for_ai(DbReadOnlyPolicy::Observer).decide(gate::classify(sql));
        assert!(matches!(observing.action, gate::GateAction::Refuse { .. }));

        // And a statement that runs is not handed over either.
        let read =
            gate::GatePolicy::for_ai(DbReadOnlyPolicy::Confirm).decide(gate::classify("SELECT 1"));
        assert!(matches!(read.action, gate::GateAction::Allow));
    }

    #[tokio::test]
    async fn ai_tool_name_conflict_names_the_peer() {
        let pool = test_pool().await;
        dbhub::insert_connection(&pool, &connection("acct", "c1", "MySQL-1", true))
            .await
            .expect("insert");

        let err = ensure_ai_tool_name_available(&pool, "acct", "mysql_1", None)
            .await
            .expect_err("same slug");
        assert!(
            err.message.contains("execute_sql_mysql_1"),
            "mentions tool name: {}",
            err.message
        );
        assert!(
            err.message.contains("MySQL-1"),
            "names the peer connection: {}",
            err.message
        );

        // Self-update is fine.
        ensure_ai_tool_name_available(&pool, "acct", "MySQL-1", Some("c1"))
            .await
            .expect("self");

        // Disabled peers do not occupy the slug.
        dbhub::insert_connection(&pool, &connection("acct", "c2", "Other", false))
            .await
            .expect("insert disabled");
        ensure_ai_tool_name_available(&pool, "acct", "Other", None)
            .await
            .expect("disabled peer free");
    }

    #[tokio::test]
    async fn disabled_connection_stops_matching_its_old_slug() {
        let pool = test_pool().await;
        dbhub::insert_connection(&pool, &connection("acct", "c1", "MySQL1", true))
            .await
            .expect("insert");
        resolve_connection_by_slug_in(&pool, "acct", "mysql1")
            .await
            .expect("enabled resolves");

        dbhub::update_connection(
            &pool,
            "acct",
            "c1",
            &dbhub::ConnectionPatch {
                name: None,
                host: None,
                port: None,
                database: None,
                username: None,
                network_profile_id: None,
                show_as_tab: None,
                enabled_for_ai: Some(false),
                ai_read_only_policy: None,
                gate_overrides: Default::default(),
                allow_writes: None,
                auth_mode: None,
                secret_arn: None,
                secret_name: None,
                sort_order: None,
            },
        )
        .await
        .expect("disable");

        let err = resolve_connection_by_slug_in(&pool, "acct", "mysql1")
            .await
            .expect_err("disabled refuses");
        assert!(
            err.message.contains("execute_sql_mysql1"),
            "refusal names the tool: {}",
            err.message
        );
    }

    #[test]
    fn cell_caps_mark_truncation() {
        let row = serde_json::json!({ "note": "x".repeat(5_000), "id": 7 });
        let capped = cap_cells(row, CELL_CAP);
        let note = capped
            .get("note")
            .and_then(|value| value.as_str())
            .expect("string");
        assert!(note.len() < 5_000);
        assert!(note.ends_with("[truncated]"));
        assert_eq!(capped.get("id"), Some(&serde_json::json!(7)));
    }

    #[test]
    fn refusal_carries_structured_error() {
        let refused = SqlQueryTextResult::refused("c1", "SELECT 1", "Connection was not found.");
        assert_eq!(refused.error.as_deref(), Some("Connection was not found."));
        assert_eq!(refused.returned_rows, 0);
    }

    #[test]
    fn execute_sql_schema_is_sql_only() {
        let schema = schemars::schema_for!(ExecuteSqlArgs);
        let json = serde_json::to_string(&schema).expect("schema");
        assert!(json.contains("sql"));
        assert!(!json.contains("connectionId"));
    }
}
