//! SQLite storage for chat assistants, sessions, and messages.
//!
//! Sessions persist so the Chat sidebar's list survives a restart. That means
//! log excerpts a tool returned end up on disk in this database — the UI offers
//! session deletion for exactly that reason.

use crate::error::{AppError, AppResult};
use crate::models::{
    ChatAssistant, ChatMessage, ChatMessageVersionSummary, ChatRole, ChatSession, ChatToolCall,
};
use chrono::{DateTime, Utc};
use sqlx::{Row, SqlitePool};

/// The assistant seeded on first run. Without it the Chat tab opens on an empty
/// list, and nothing tells the user how this differs from a generic chat window.
const BUILT_IN_ASSISTANT_ID: &str = "emr-failure-analysis";

const BUILT_IN_SYSTEM_PROMPT: &str = "\
You help diagnose Amazon EMR on EKS job failures. You have read-only tools over \
the user's configured AWS accounts.

Work in this order:
1. Locate the job with find_job before anything else — job ids do not say which \
account or virtual cluster they belong to.
2. Call analyze_job_failure for the one-shot report: state, controller (pod-level) \
evidence, Spark application evidence, and candidate causes.
3. Only if that is not conclusive, drill down with list_job_log_objects and \
get_job_log_text.

Ground every claim in tool output and quote the log lines you relied on. If the \
evidence is thin, say so rather than guessing. Log content is redacted before it \
reaches you, so bucket names, ARNs, account ids, and hostnames appear as \
placeholders — do not ask the user to un-redact them.";

pub(crate) async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    for statement in [
        "create table if not exists chat_assistants (
            id text primary key,
            name text not null,
            system_prompt text,
            default_model_id text,
            enabled_tools text,
            accent text,
            sort_order integer not null default 0,
            built_in integer not null default 0,
            created_at text not null,
            updated_at text not null
        )",
        "create table if not exists chat_sessions (
            id text primary key,
            assistant_id text not null references chat_assistants(id),
            title text not null,
            model_id text,
            created_at text not null,
            updated_at text not null
        )",
        "create table if not exists chat_messages (
            id text primary key,
            session_id text not null references chat_sessions(id),
            seq integer not null,
            role text not null,
            content text,
            tool_calls text,
            model_id text,
            duration_ms integer,
            error text,
            error_details text,
            created_at text not null
        )",
        // One row per answer a message has ever produced. The `chat_messages`
        // row itself mirrors the *active* version (its columns are the displayed
        // content), so existing readers — history, streaming, list — need no
        // join; this table only archives the versions a user can switch back to.
        // No `references chat_messages(id)`: the pool's SQLite connections enable
        // `pragma foreign_keys` (SQLx turns it on by default, unlike a raw
        // SQLite open), so a live FK would reject deleting an assistant row while
        // any of its version children still point at it — exactly what
        // regeneration does (it discards the old reply, then re-points the
        // versions onto the fresh row). Deletions clear the versions in Rust,
        // matching the rest of this module.
        "create table if not exists chat_message_versions (
            id text primary key,
            session_id text not null,
            message_id text not null,
            model_id text,
            content text,
            tool_calls text,
            duration_ms integer,
            error text,
            error_details text,
            is_active integer not null default 0,
            created_at text not null
        )",
        "create index if not exists idx_chat_sessions_assistant on chat_sessions(assistant_id)",
        "create index if not exists idx_chat_messages_session on chat_messages(session_id, seq)",
        "create index if not exists idx_chat_message_versions_message on chat_message_versions(message_id)",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }

    // `error_details` (structured diagnostics for a failed turn) arrived after the
    // column shipped. Fresh databases already have it via the CREATE above, so the
    // duplicate-column error is expected there and tolerated; older databases get
    // the column added now.
    if let Err(error) = sqlx::query("alter table chat_messages add column error_details text")
        .execute(pool)
        .await
    {
        if !error.to_string().contains("duplicate column name") {
            return Err(AppError::storage(error.to_string()));
        }
    }

    // The first release of `chat_message_versions` declared a foreign key to
    // `chat_messages(id)`. On any connection with `pragma foreign_keys` on,
    // deleting an assistant reply that still has version rows — exactly what
    // regeneration does — fails with SQLITE_CONSTRAINT_FOREIGNKEY. Rebuild any
    // such legacy table without the FK; deletions clear versions in Rust.
    rebuild_message_versions_if_legacy(pool).await?;

    // Assistant messages written before versioning existed carry their single
    // answer inline, with no version row. Backfill one active version per such
    // message so capsule switching has something to point at. Idempotent: rows
    // that already have a version are skipped.
    sqlx::query(
        "insert into chat_message_versions
            (id, session_id, message_id, model_id, content, tool_calls, duration_ms, error, error_details, is_active, created_at)
         select lower(hex(randomblob(16))), m.session_id, m.id, m.model_id, m.content, m.tool_calls,
                m.duration_ms, m.error, m.error_details, 1, m.created_at
         from chat_messages m
         where m.role = 'assistant'
           and not exists (select 1 from chat_message_versions v where v.message_id = m.id)",
    )
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    seed_built_in_assistant(pool).await
}

/// Rebuilds `chat_message_versions` without its legacy foreign-key declaration.
///
/// SQLite cannot drop a column-level FK from an existing table, so a table that
/// was created while the FK was present must be replaced. Column contents are
/// preserved; only the constraint goes away. On connections that enable
/// `pragma foreign_keys`, the old FK would otherwise make regeneration fail with
/// SQLITE_CONSTRAINT_FOREIGNKEY when it discards an assistant reply that still
/// has version rows.
async fn rebuild_message_versions_if_legacy(pool: &SqlitePool) -> AppResult<()> {
    let definition: Option<String> = sqlx::query(
        "select sql from sqlite_master
         where type = 'table' and name = 'chat_message_versions'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .map(|row| row.get("sql"));
    let Some(definition) = definition else {
        return Ok(());
    };
    if !definition.contains("references") {
        return Ok(());
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    // Drop the index first so it does not follow the renamed table and squat on
    // the name the fresh table needs.
    sqlx::query("drop index if exists idx_chat_message_versions_message")
        .execute(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query("alter table chat_message_versions rename to chat_message_versions_legacy")
        .execute(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query(
        "create table chat_message_versions (
            id text primary key,
            session_id text not null,
            message_id text not null,
            model_id text,
            content text,
            tool_calls text,
            duration_ms integer,
            error text,
            error_details text,
            is_active integer not null default 0,
            created_at text not null
        )",
    )
    .execute(&mut *tx)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query("create index idx_chat_message_versions_message on chat_message_versions(message_id)")
        .execute(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query(
        "insert into chat_message_versions
            (id, session_id, message_id, model_id, content, tool_calls, duration_ms, error, error_details, is_active, created_at)
         select id, session_id, message_id, model_id, content, tool_calls,
                duration_ms, error, error_details, is_active, created_at
         from chat_message_versions_legacy",
    )
    .execute(&mut *tx)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query("drop table chat_message_versions_legacy")
        .execute(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    tx.commit()
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

/// Inserts the built-in assistant once. Its prompt is refreshed on every start
/// so improvements reach existing installs, but the user's own edits to name,
/// model, or tool selection are left alone.
async fn seed_built_in_assistant(pool: &SqlitePool) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "insert into chat_assistants
            (id, name, system_prompt, default_model_id, enabled_tools, accent, sort_order, built_in, created_at, updated_at)
         values (?1, 'EMR failure analysis', ?2, null, null, 'blue', 0, 1, ?3, ?3)
         on conflict(id) do update set system_prompt = excluded.system_prompt",
    )
    .bind(BUILT_IN_ASSISTANT_ID)
    .bind(BUILT_IN_SYSTEM_PROMPT)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

fn parse_timestamp(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|parsed| parsed.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

// --- Assistants ------------------------------------------------------------

pub async fn list_assistants(pool: &SqlitePool) -> AppResult<Vec<ChatAssistant>> {
    let rows = sqlx::query(
        "select * from chat_assistants order by sort_order, name collate nocase",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| {
            let enabled_tools: Option<String> = row.get("enabled_tools");
            Ok(ChatAssistant {
                id: row.get("id"),
                name: row.get("name"),
                system_prompt: row.get("system_prompt"),
                default_model_id: row.get("default_model_id"),
                // A malformed list must not hide the assistant; treating it as
                // "all tools" matches the null case.
                enabled_tools: enabled_tools
                    .as_deref()
                    .and_then(|json| serde_json::from_str(json).ok()),
                accent: row.get("accent"),
                sort_order: row.get("sort_order"),
                built_in: row.get::<i64, _>("built_in") != 0,
                created_at: parse_timestamp(&row.get::<String, _>("created_at")),
                updated_at: parse_timestamp(&row.get::<String, _>("updated_at")),
            })
        })
        .collect()
}

pub async fn create_assistant(
    pool: &SqlitePool,
    name: &str,
    system_prompt: Option<&str>,
    default_model_id: Option<&str>,
    enabled_tools: Option<&[String]>,
    accent: Option<&str>,
) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Assistant name is required."));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let next_order: i64 =
        sqlx::query("select coalesce(max(sort_order), -1) + 1 from chat_assistants")
            .fetch_one(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?
            .get(0);

    sqlx::query(
        "insert into chat_assistants
            (id, name, system_prompt, default_model_id, enabled_tools, accent, sort_order, built_in, created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)",
    )
    .bind(&id)
    .bind(name)
    .bind(system_prompt.map(str::trim).filter(|text| !text.is_empty()))
    .bind(default_model_id)
    .bind(encode_tools(enabled_tools)?)
    .bind(accent)
    .bind(next_order)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(id)
}

fn encode_tools(tools: Option<&[String]>) -> AppResult<Option<String>> {
    tools
        .map(|tools| {
            serde_json::to_string(tools).map_err(|error| AppError::storage(error.to_string()))
        })
        .transpose()
}

/// Fields to change on an assistant. Absent fields are left alone.
///
/// `enabled_tools` is doubly optional: the outer `None` leaves the column as it
/// is, `Some(None)` clears it back to "all tools".
#[derive(Debug, Default)]
pub struct AssistantPatch<'a> {
    pub name: Option<&'a str>,
    pub system_prompt: Option<&'a str>,
    pub default_model_id: Option<&'a str>,
    pub enabled_tools: Option<Option<&'a [String]>>,
    pub accent: Option<&'a str>,
    pub sort_order: Option<i64>,
}

pub async fn update_assistant(
    pool: &SqlitePool,
    id: &str,
    patch: AssistantPatch<'_>,
) -> AppResult<()> {
    ensure_assistant_exists(pool, id).await?;

    if let Some(name) = patch.name {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::validation("Assistant name is required."));
        }
        sqlx::query("update chat_assistants set name = ?1 where id = ?2")
            .bind(name)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }
    if let Some(system_prompt) = patch.system_prompt {
        sqlx::query("update chat_assistants set system_prompt = ?1 where id = ?2")
            .bind(Some(system_prompt.trim()).filter(|text| !text.is_empty()))
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }
    if let Some(default_model_id) = patch.default_model_id {
        sqlx::query("update chat_assistants set default_model_id = ?1 where id = ?2")
            .bind(Some(default_model_id).filter(|value| !value.is_empty()))
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }
    if let Some(enabled_tools) = patch.enabled_tools {
        sqlx::query("update chat_assistants set enabled_tools = ?1 where id = ?2")
            .bind(encode_tools(enabled_tools)?)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }
    if let Some(accent) = patch.accent {
        sqlx::query("update chat_assistants set accent = ?1 where id = ?2")
            .bind(accent)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }
    if let Some(sort_order) = patch.sort_order {
        sqlx::query("update chat_assistants set sort_order = ?1 where id = ?2")
            .bind(sort_order)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }

    sqlx::query("update chat_assistants set updated_at = ?1 where id = ?2")
        .bind(Utc::now().to_rfc3339())
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

/// Deletes an assistant with its sessions and their messages. The built-in one
/// is protected: removing it would leave a new user with no starting point and
/// no obvious way to recreate its prompt.
pub async fn delete_assistant(pool: &SqlitePool, id: &str) -> AppResult<()> {
    if id == BUILT_IN_ASSISTANT_ID {
        return Err(AppError::validation(
            "The built-in assistant cannot be deleted. Edit it instead, or add your own.",
        ));
    }

    let session_ids = session_ids_for_assistant(pool, id).await?;
    for session_id in session_ids {
        delete_session(pool, &session_id).await?;
    }
    sqlx::query("delete from chat_assistants where id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

async fn ensure_assistant_exists(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let count: i64 = sqlx::query("select count(*) from chat_assistants where id = ?1")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .get(0);
    if count == 0 {
        return Err(AppError::validation(format!(
            "Chat assistant {id} was not found."
        )));
    }
    Ok(())
}

async fn session_ids_for_assistant(pool: &SqlitePool, assistant_id: &str) -> AppResult<Vec<String>> {
    let rows = sqlx::query("select id from chat_sessions where assistant_id = ?1")
        .bind(assistant_id)
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(rows.into_iter().map(|row| row.get("id")).collect())
}

// --- Sessions --------------------------------------------------------------

/// Every session, newest activity first, with its message count for the sidebar.
pub async fn list_sessions(pool: &SqlitePool) -> AppResult<Vec<ChatSession>> {
    let rows = sqlx::query(
        "select s.*, (select count(*) from chat_messages m where m.session_id = s.id) as message_count
         from chat_sessions s
         order by s.updated_at desc",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| ChatSession {
            id: row.get("id"),
            assistant_id: row.get("assistant_id"),
            title: row.get("title"),
            model_id: row.get("model_id"),
            created_at: parse_timestamp(&row.get::<String, _>("created_at")),
            updated_at: parse_timestamp(&row.get::<String, _>("updated_at")),
            message_count: row.get("message_count"),
        })
        .collect())
}

/// The name a conversation starts with, until its first message earns it one.
pub const DEFAULT_SESSION_TITLE: &str = "New conversation";

pub async fn create_session(
    pool: &SqlitePool,
    assistant_id: &str,
    title: Option<&str>,
    model_id: Option<&str>,
) -> AppResult<String> {
    ensure_assistant_exists(pool, assistant_id).await?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let title = title
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or(DEFAULT_SESSION_TITLE);

    sqlx::query(
        "insert into chat_sessions (id, assistant_id, title, model_id, created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?5)",
    )
    .bind(&id)
    .bind(assistant_id)
    .bind(title)
    .bind(model_id)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(id)
}

pub async fn update_session(
    pool: &SqlitePool,
    id: &str,
    title: Option<&str>,
    model_id: Option<&str>,
) -> AppResult<()> {
    ensure_session_exists(pool, id).await?;

    if let Some(title) = title {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::validation("Session title is required."));
        }
        sqlx::query("update chat_sessions set title = ?1 where id = ?2")
            .bind(title)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }
    if let Some(model_id) = model_id {
        sqlx::query("update chat_sessions set model_id = ?1 where id = ?2")
            .bind(Some(model_id).filter(|value| !value.is_empty()))
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }

    touch_session(pool, id).await
}

/// Whether this session should have a title generated from the message about to
/// be sent: it still has the default name and nothing has been said yet.
///
/// Checked before the user turn is stored, so the first send names the
/// conversation and later ones do not spend a request re-deciding.
pub async fn awaiting_first_title(pool: &SqlitePool, id: &str) -> AppResult<bool> {
    let row = sqlx::query(
        "select s.title as title,
                (select count(*) from chat_messages m where m.session_id = s.id) as message_count
         from chat_sessions s
         where s.id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    let Some(row) = row else { return Ok(false) };
    let title: String = row.get("title");
    let message_count: i64 = row.get("message_count");
    Ok(title == DEFAULT_SESSION_TITLE && message_count == 0)
}

/// Renames a session only while it still carries the default title.
///
/// The auto-naming path uses this rather than `update_session`: a title generated
/// from the first message must never overwrite a name the user typed, and the
/// check has to be part of the same statement to avoid racing a rename.
pub async fn rename_if_untitled(pool: &SqlitePool, id: &str, title: &str) -> AppResult<bool> {
    let title = title.trim();
    if title.is_empty() {
        return Ok(false);
    }

    let affected = sqlx::query("update chat_sessions set title = ?1 where id = ?2 and title = ?3")
        .bind(title)
        .bind(id)
        .bind(DEFAULT_SESSION_TITLE)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .rows_affected();

    Ok(affected > 0)
}

pub async fn delete_session(pool: &SqlitePool, id: &str) -> AppResult<()> {
    delete_message_versions_for_session(pool, id).await?;
    sqlx::query("delete from chat_messages where session_id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query("delete from chat_sessions where id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

/// Removes every session and message, for the "clear all conversations" action.
/// Assistants are presets and survive.
pub async fn delete_all_sessions(pool: &SqlitePool) -> AppResult<u64> {
    sqlx::query("delete from chat_message_versions")
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query("delete from chat_messages")
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    let deleted = sqlx::query("delete from chat_sessions")
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .rows_affected();
    Ok(deleted)
}

/// Deletes archived versions belonging to a session's messages. FK cascades are
/// off in this database, so every row deletion that removes chat_messages rows
/// must clear their children here.
async fn delete_message_versions_for_session(pool: &SqlitePool, session_id: &str) -> AppResult<()> {
    sqlx::query("delete from chat_message_versions where session_id = ?1")
        .bind(session_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

async fn ensure_session_exists(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let count: i64 = sqlx::query("select count(*) from chat_sessions where id = ?1")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .get(0);
    if count == 0 {
        return Err(AppError::validation(format!(
            "Chat session {id} was not found."
        )));
    }
    Ok(())
}

/// Bumps the session's `updated_at`, which is also the sidebar's sort key.
async fn touch_session(pool: &SqlitePool, id: &str) -> AppResult<()> {
    sqlx::query("update chat_sessions set updated_at = ?1 where id = ?2")
        .bind(Utc::now().to_rfc3339())
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

// --- Messages --------------------------------------------------------------

/// Removes one message and any others with a later `seq`.
///
/// This is the backend for both "delete this message" and "delete this and
/// everything after". A `tool_use` block and its `tool_result` live in the same
/// thin row, so truncating rows can never orphan a tool call — splitting them
/// across rows would.
pub async fn delete_messages_from(
    pool: &SqlitePool,
    session_id: &str,
    from_seq: i64,
) -> AppResult<u64> {
    let affected = sqlx::query("delete from chat_messages where session_id = ?1 and seq >= ?2")
        .bind(session_id)
        .bind(from_seq)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .rows_affected();
    touch_session(pool, session_id).await?;
    Ok(affected)
}

/// Removes archived versions whose `message_id` no longer exists.
///
/// Regeneration and the "delete from here" / edit truncations remove rows but
/// keep their version children until this sweep runs. Regeneration re-points the
/// regenerated reply's versions to its fresh row *first*, so those survive; the
/// versions of truly-deleted later turns are cleaned here.
pub async fn purge_orphan_message_versions(pool: &SqlitePool, session_id: &str) -> AppResult<u64> {
    let affected = sqlx::query(
        "delete from chat_message_versions
         where session_id = ?1
           and message_id not in (select id from chat_messages where session_id = ?1)",
    )
    .bind(session_id)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .rows_affected();
    Ok(affected)
}

/// Re-points archived versions from one assistant message to another.
///
/// Regeneration discards the old assistant row and answers with a fresh one, so
/// the versions recorded under the old row's id would otherwise dangle. The old
/// answer is kept as a switchable capsule by moving its versions onto the new
/// row and demoting them (the brand-new answer owns `is_active = 1`).
pub async fn reattach_message_versions(
    pool: &SqlitePool,
    old_message_id: &str,
    new_message_id: &str,
) -> AppResult<u64> {
    let affected = sqlx::query(
        "update chat_message_versions set message_id = ?1, is_active = 0 where message_id = ?2",
    )
    .bind(new_message_id)
    .bind(old_message_id)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .rows_affected();
    Ok(affected)
}

/// Deletes a single archived version row.
///
/// An in-place regenerate overwrites the answer it replaced, so that attempt's
/// version row (no longer switchable) is dropped rather than kept alongside the
/// superseding one.
pub async fn delete_message_version(
    pool: &SqlitePool,
    session_id: &str,
    version_id: &str,
) -> AppResult<u64> {
    let affected = sqlx::query(
        "delete from chat_message_versions where id = ?1 and session_id = ?2",
    )
    .bind(version_id)
    .bind(session_id)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .rows_affected();
    Ok(affected)
}

/// Makes one recorded version the message's displayed answer.
///
/// The `chat_messages` row always mirrors the active version, so switching means
/// copying the chosen version's columns onto the row (history and the transcript
/// read the row, not the table) and flipping which version row is `is_active`.
pub async fn activate_message_version(
    pool: &SqlitePool,
    session_id: &str,
    message_id: &str,
    version_id: &str,
) -> AppResult<()> {
    // The version must exist and belong to this message in this session.
    let owned = sqlx::query(
        "select 1 from chat_message_versions
         where id = ?1 and message_id = ?2 and session_id = ?3",
    )
    .bind(version_id)
    .bind(message_id)
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    if owned.is_none() {
        return Err(AppError::validation(format!(
            "Version {version_id} was not found for this message."
        )));
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    // Mirror the chosen version onto the live row: content columns plus model_id,
    // which is what the header and regeneration both read. `created_at` is left
    // as the row's own so the message keeps its position in the transcript.
    let affected = sqlx::query(
        "update chat_messages
         set model_id = (select model_id from chat_message_versions where id = ?1),
             content = (select content from chat_message_versions where id = ?1),
             tool_calls = (select tool_calls from chat_message_versions where id = ?1),
             duration_ms = (select duration_ms from chat_message_versions where id = ?1),
             error = (select error from chat_message_versions where id = ?1),
             error_details = (select error_details from chat_message_versions where id = ?1)
         where id = ?2 and session_id = ?3",
    )
    .bind(version_id)
    .bind(message_id)
    .bind(session_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::validation(format!(
            "Chat message {message_id} was not found in this conversation."
        )));
    }

    // Exactly one version per message is active — the one just selected.
    sqlx::query(
        "update chat_message_versions set is_active = (id = ?1)
         where message_id = ?2 and session_id = ?3",
    )
    .bind(version_id)
    .bind(message_id)
    .bind(session_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    tx.commit()
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

/// Deletes a single message. Refuses when that would leave the transcript
/// starting with an assistant turn — the providers require the first message to
/// be from the user.
pub async fn delete_message(
    pool: &SqlitePool,
    session_id: &str,
    message_id: &str,
) -> AppResult<()> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    let exists: i64 = sqlx::query("select count(*) from chat_messages where id = ?1")
        .bind(message_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .get(0);
    if exists == 0 {
        return Err(AppError::validation(format!(
            "Chat message {message_id} was not found."
        )));
    }

    // A single-row delete could leave the first visible message as an assistant
    // turn, which every provider rejects. Simulate the delete by checking the
    // message that would surface as first — if it is an assistant turn, refuse.
    let would_be_first = sqlx::query(
        "select role from chat_messages
         where session_id = ?1 and id != ?2
         order by seq
         limit 1",
    )
    .bind(session_id)
    .bind(message_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    if let Some(row) = would_be_first {
        let role: String = row.get("role");
        if role == ChatRole::Assistant.as_str() {
            return Err(AppError::validation(
                "This message cannot be deleted on its own, since the conversation would then start with an assistant turn. Delete your last question instead.",
            ));
        }
    }

    // The guard passed, so the deletion leaves a valid transcript: commit it.
    sqlx::query("delete from chat_message_versions where message_id = ?1")
        .bind(message_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query("delete from chat_messages where id = ?1")
        .bind(message_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    tx.commit()
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    touch_session(pool, session_id).await?;
    Ok(())
}

/// Overwrites a message's text. Used when the user edits a past question: the
/// question is corrected, then the conversation is truncated past it and re-sent.
pub async fn update_message_content(
    pool: &SqlitePool,
    message_id: &str,
    content: &str,
) -> AppResult<()> {
    let content = content.trim();
    if content.is_empty() {
        return Err(AppError::validation("Enter a message to save."));
    }

    let affected = sqlx::query("update chat_messages set content = ?1 where id = ?2")
        .bind(content)
        .bind(message_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .rows_affected();

    if affected == 0 {
        return Err(AppError::validation(format!(
            "Chat message {message_id} was not found."
        )));
    }
    Ok(())
}

fn row_to_message(row: &sqlx::sqlite::SqliteRow) -> AppResult<ChatMessage> {
    let role_text: String = row.get("role");
    let tool_calls: Option<String> = row.get("tool_calls");
    let error_details: Option<String> = row.get("error_details");
    Ok(ChatMessage {
        id: row.get("id"),
        session_id: row.get("session_id"),
        seq: row.get("seq"),
        role: ChatRole::parse(&role_text)
            .ok_or_else(|| AppError::storage(format!("Unknown chat role {role_text}.")))?,
        content: row.get("content"),
        tool_calls: tool_calls
            .as_deref()
            .and_then(|json| serde_json::from_str::<Vec<ChatToolCall>>(json).ok())
            .unwrap_or_default(),
        model_id: row.get("model_id"),
        duration_ms: row.get("duration_ms"),
        error: row.get("error"),
        error_details: error_details
            .as_deref()
            .and_then(|json| serde_json::from_str(json).ok()),
        created_at: parse_timestamp(&row.get::<String, _>("created_at")),
        versions: Vec::new(),
    })
}

/// Fills each assistant message's `versions` summary from the version table.
///
/// Kept separate from `row_to_message` so history building and single-message
/// lookups skip the extra query; only the transcript listing needs capsules.
fn attach_versions(messages: &mut [ChatMessage], rows: &[sqlx::sqlite::SqliteRow]) {
    let mut by_message: std::collections::HashMap<String, Vec<ChatMessageVersionSummary>> =
        std::collections::HashMap::new();
    for row in rows {
        // Only a real answer is switchable: a version that archived an error or
        // came back empty must not surface as a numbered capsule. New attempts
        // never archive those (see `finish_assistant_message`), but a version row
        // written before that rule — or a backfill of a pre-versioning message —
        // can still carry one, so it is filtered here rather than trusted.
        let error: Option<String> = row.get("error");
        let content: Option<String> = row.get("content");
        let tool_calls: Option<String> = row.get("tool_calls");
        let has_answer = error.is_none()
            && (content.as_deref().is_some_and(|c| !c.trim().is_empty())
                || tool_calls.is_some());
        if !has_answer {
            continue;
        }
        let message_id: String = row.get("message_id");
        by_message
            .entry(message_id)
            .or_default()
            .push(ChatMessageVersionSummary {
                id: row.get("id"),
                model_id: row.get("model_id"),
                is_active: row.get::<i64, _>("is_active") != 0,
                created_at: parse_timestamp(&row.get::<String, _>("created_at")),
            });
    }
    for message in messages.iter_mut() {
        if message.role == ChatRole::Assistant {
            if let Some(mut versions) = by_message.remove(&message.id) {
                versions.sort_by_key(|v| v.created_at);
                message.versions = versions;
            }
        }
    }
}

/// Every message in a session, oldest first — the full readable history,
/// including any `ContextReset` markers.
pub async fn list_messages(pool: &SqlitePool, session_id: &str) -> AppResult<Vec<ChatMessage>> {
    let rows = sqlx::query("select * from chat_messages where session_id = ?1 order by seq")
        .bind(session_id)
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    let mut messages: Vec<ChatMessage> = rows.iter().map(row_to_message).collect::<AppResult<_>>()?;
    let version_rows = sqlx::query(
        "select * from chat_message_versions where session_id = ?1 order by created_at",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    attach_versions(&mut messages, &version_rows);
    Ok(messages)
}

/// One message by id, or an error when it is not in the given session.
pub async fn get_message(
    pool: &SqlitePool,
    session_id: &str,
    message_id: &str,
) -> AppResult<ChatMessage> {
    sqlx::query(
        "select * from chat_messages where id = ?1 and session_id = ?2",
    )
    .bind(message_id)
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    // `fetch_optional` hands back an owned row; the shared converter reads a
    // borrowed one, so wrap it rather than pass the function by value.
    .map(|row| row_to_message(&row))
    .transpose()?
    .ok_or_else(|| {
        AppError::validation(format!(
            "Chat message {message_id} was not found in this conversation."
        ))
    })
}

/// The messages that make up the next request's conversation history: everything
/// after the last `ContextReset`, with the markers themselves dropped.
///
/// This is the one place "clear context" is enforced. Building the request from
/// `list_messages` instead would silently resend the cleared turns.
pub async fn conversation_history(
    pool: &SqlitePool,
    session_id: &str,
) -> AppResult<Vec<ChatMessage>> {
    let all = list_messages(pool, session_id).await?;
    let start = all
        .iter()
        .rposition(|message| message.role == ChatRole::ContextReset)
        .map(|index| index + 1)
        .unwrap_or(0);

    Ok(all
        .into_iter()
        .skip(start)
        .filter(|message| message.role != ChatRole::ContextReset)
        .collect())
}

/// A message to append. Most appends set only `role` and `content`, so the rest
/// come from `Default` rather than a wall of `None` at every call site.
#[derive(Debug, Default)]
pub struct NewMessage<'a> {
    pub content: Option<&'a str>,
    pub tool_calls: &'a [ChatToolCall],
    pub model_id: Option<&'a str>,
    pub duration_ms: Option<i64>,
    pub error: Option<&'a str>,
    pub error_details: Option<&'a crate::error::ErrorDetails>,
}

impl<'a> NewMessage<'a> {
    pub fn text(content: &'a str) -> Self {
        Self {
            content: Some(content),
            ..Self::default()
        }
    }
}

/// Appends a message and bumps the session's `updated_at`.
///
/// `seq` is assigned here rather than by the caller so two appends cannot land
/// on the same ordinal and scramble the transcript.
pub async fn append_message(
    pool: &SqlitePool,
    session_id: &str,
    role: ChatRole,
    message: NewMessage<'_>,
) -> AppResult<ChatMessage> {
    let NewMessage {
        content,
        tool_calls,
        model_id,
        duration_ms,
        error,
        error_details,
    } = message;
    ensure_session_exists(pool, session_id).await?;

    let next_seq: i64 = sqlx::query(
        "select coalesce(max(seq), -1) + 1 from chat_messages where session_id = ?1",
    )
    .bind(session_id)
    .fetch_one(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .get(0);

    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let tool_calls_json = if tool_calls.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(tool_calls)
                .map_err(|error| AppError::storage(error.to_string()))?,
        )
    };
    let error_details_json = match error_details {
        Some(details) => Some(
            serde_json::to_string(details)
                .map_err(|error| AppError::storage(error.to_string()))?,
        ),
        None => None,
    };

    sqlx::query(
        "insert into chat_messages
            (id, session_id, seq, role, content, tool_calls, model_id, duration_ms, error, error_details, created_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )
    .bind(&id)
    .bind(session_id)
    .bind(next_seq)
    .bind(role.as_str())
    .bind(content)
    .bind(&tool_calls_json)
    .bind(model_id)
    .bind(duration_ms)
    .bind(error)
    .bind(&error_details_json)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    touch_session(pool, session_id).await?;

    Ok(ChatMessage {
        id,
        session_id: session_id.to_string(),
        seq: next_seq,
        role,
        content: content.map(ToString::to_string),
        tool_calls: tool_calls.to_vec(),
        model_id: model_id.map(ToString::to_string),
        duration_ms,
        error: error.map(ToString::to_string),
        error_details: error_details.cloned(),
        created_at: parse_timestamp(&now),
        versions: Vec::new(),
    })
}

/// Rewrites an assistant message in place as the stream completes: the streamed
/// text and the tool calls made along the way are known only at the end, but the
/// row is created up front so the UI has an id to attach deltas to.
///
/// A successful finish also records the completed answer as a version row, so the
/// reply is switchable later. A fresh message gets its first version here; a
/// reply that is being regenerated gets a new active version while its earlier
/// versions stay selectable. A finish that carried an error or produced nothing
/// (no text, no tool calls) still updates the row for the transcript but archives
/// no version — a failed or empty attempt is not something a user switches back
/// to, so it must not count as one.
pub async fn finish_assistant_message(
    pool: &SqlitePool,
    message_id: &str,
    content: Option<&str>,
    tool_calls: &[ChatToolCall],
    duration_ms: Option<i64>,
    error: Option<&str>,
    error_details: Option<&crate::error::ErrorDetails>,
) -> AppResult<()> {
    let tool_calls_json = if tool_calls.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(tool_calls)
                .map_err(|error| AppError::storage(error.to_string()))?,
        )
    };
    let error_details_json = match error_details {
        Some(details) => Some(
            serde_json::to_string(details)
                .map_err(|error| AppError::storage(error.to_string()))?,
        ),
        None => None,
    };
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    let affected = sqlx::query(
        "update chat_messages
         set content = ?1, tool_calls = ?2, duration_ms = ?3, error = ?4, error_details = ?5
         where id = ?6",
    )
    .bind(content)
    .bind(&tool_calls_json)
    .bind(duration_ms)
    .bind(error)
    .bind(&error_details_json)
    .bind(message_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .rows_affected();

    if affected == 0 {
        return Err(AppError::validation(format!(
            "Chat message {message_id} was not found."
        )));
    }

    // Only a real answer earns a version: one that carried no error and has
    // something to show (text, or tool calls). A failed or empty attempt leaves
    // the previously active version untouched — the row mirrors the error/empty
    // state for the transcript, but nothing switchable is added or demoted.
    let archives_a_version = error.is_none()
        && (content.map_or(false, |c| !c.trim().is_empty()) || !tool_calls.is_empty());
    if archives_a_version {
        // The just-finished answer becomes the active version of this message;
        // any older active (an earlier regeneration that was itself superseded)
        // is kept but demoted so exactly one version is "current".
        sqlx::query(
            "update chat_message_versions set is_active = 0
             where message_id = ?1 and is_active = 1",
        )
        .bind(message_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

        sqlx::query(
            "insert into chat_message_versions
                (id, session_id, message_id, model_id, content, tool_calls, duration_ms, error, error_details, is_active, created_at)
             select lower(hex(randomblob(16))), session_id, id, model_id, content, tool_calls,
                    duration_ms, error, error_details, 1, ?1
             from chat_messages where id = ?2",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(message_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

/// Marks the point after which history stops being resent. A marker is only
/// useful once per position, so a second one with nothing in between is skipped.
pub async fn append_context_reset(pool: &SqlitePool, session_id: &str) -> AppResult<bool> {
    let last_role: Option<String> = sqlx::query(
        "select role from chat_messages where session_id = ?1 order by seq desc limit 1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .map(|row| row.get("role"));

    // Nothing to clear in an empty session, and no point stacking markers.
    if last_role.is_none() || last_role.as_deref() == Some(ChatRole::ContextReset.as_str()) {
        return Ok(false);
    }

    append_message(
        pool,
        session_id,
        ChatRole::ContextReset,
        NewMessage::default(),
    )
    .await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    /// A pool with `pragma foreign_keys` on — the app's production connection
    /// behaves this way (SQLx turns it on per connection), so version children
    /// deleting their parent row would otherwise fail with SQLITE_CONSTRAINT.
    async fn fk_pool() -> SqlitePool {
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(":memory:")
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("create sqlite memory pool with FK");
        migrate(&pool).await.expect("migrate chat schema");
        pool
    }

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        migrate(&pool).await.expect("migrate chat schema");
        pool
    }

    async fn session(pool: &SqlitePool) -> String {
        let assistants = list_assistants(pool).await.unwrap();
        create_session(pool, &assistants[0].id, Some("job-abc"), None)
            .await
            .expect("create session")
    }

    async fn user_message(pool: &SqlitePool, session_id: &str, text: &str) {
        append_message(pool, session_id, ChatRole::User, NewMessage::text(text))
            .await
            .expect("append user message");
    }

    #[tokio::test]
    async fn the_built_in_assistant_is_seeded_with_a_tool_ordering_prompt() {
        let pool = test_pool().await;
        let assistants = list_assistants(&pool).await.unwrap();

        assert_eq!(assistants.len(), 1);
        assert!(assistants[0].built_in);
        // Every tool is available to it.
        assert_eq!(assistants[0].enabled_tools, None);
        let prompt = assistants[0].system_prompt.as_deref().unwrap_or_default();
        assert!(prompt.contains("find_job"), "{prompt}");
        assert!(prompt.contains("analyze_job_failure"), "{prompt}");
    }

    #[tokio::test]
    async fn seeding_twice_refreshes_the_prompt_without_duplicating() {
        let pool = test_pool().await;
        migrate(&pool).await.expect("second migrate is a no-op");
        assert_eq!(list_assistants(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn the_built_in_assistant_cannot_be_deleted() {
        let pool = test_pool().await;
        let assistants = list_assistants(&pool).await.unwrap();
        assert!(delete_assistant(&pool, &assistants[0].id).await.is_err());
        assert_eq!(list_assistants(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn assistants_round_trip_their_tool_restriction() {
        let pool = test_pool().await;
        let id = create_assistant(
            &pool,
            "Spark tuning",
            Some("Focus on shuffle."),
            None,
            Some(&["analyze_job_failure".to_string()]),
            Some("amber"),
        )
        .await
        .unwrap();

        let assistants = list_assistants(&pool).await.unwrap();
        let created = assistants.iter().find(|a| a.id == id).unwrap();
        assert_eq!(
            created.enabled_tools.as_deref(),
            Some(["analyze_job_failure".to_string()].as_slice())
        );
        assert!(!created.built_in);

        // The outer Some(None) clears the restriction back to "all tools".
        update_assistant(
            &pool,
            &id,
            AssistantPatch {
                enabled_tools: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let assistants = list_assistants(&pool).await.unwrap();
        assert_eq!(
            assistants.iter().find(|a| a.id == id).unwrap().enabled_tools,
            None
        );
    }

    #[tokio::test]
    async fn omitting_enabled_tools_leaves_it_untouched() {
        let pool = test_pool().await;
        let id = create_assistant(
            &pool,
            "Restricted",
            None,
            None,
            Some(&["find_job".to_string()]),
            None,
        )
        .await
        .unwrap();

        update_assistant(
            &pool,
            &id,
            AssistantPatch {
                name: Some("Renamed"),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let assistants = list_assistants(&pool).await.unwrap();
        let updated = assistants.iter().find(|a| a.id == id).unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(
            updated.enabled_tools.as_deref(),
            Some(["find_job".to_string()].as_slice())
        );
    }

    #[tokio::test]
    async fn messages_are_sequenced_and_counted() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;

        user_message(&pool, &session_id, "why did it fail?").await;
        let calls = [ChatToolCall {
            call_id: "c1".to_string(),
            tool: "find_job".to_string(),
            args: serde_json::json!({"jobId": "abc"}),
            result: Some(serde_json::json!({"found": true})),
            error: None,
            duration_ms: Some(120),
            signature: None,
        }];
        let assistant = append_message(
            &pool,
            &session_id,
            ChatRole::Assistant,
            NewMessage {
                content: Some("checking"),
                tool_calls: &calls,
                model_id: Some("model-1"),
                duration_ms: Some(1800),
                error: None,
                error_details: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(assistant.seq, 1);
        let messages = list_messages(&pool, &session_id).await.unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, ChatRole::User);
        // Tool calls survive the JSON round-trip with their results attached.
        assert_eq!(messages[1].tool_calls.len(), 1);
        assert_eq!(messages[1].tool_calls[0].tool, "find_job");
        assert_eq!(messages[1].tool_calls[0].duration_ms, Some(120));
        assert_eq!(messages[1].model_id.as_deref(), Some("model-1"));

        let sessions = list_sessions(&pool).await.unwrap();
        assert_eq!(sessions[0].message_count, 2);
    }

    #[tokio::test]
    async fn history_restarts_after_the_last_context_reset() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;

        user_message(&pool, &session_id, "first").await;
        assert!(append_context_reset(&pool, &session_id).await.unwrap());
        user_message(&pool, &session_id, "second").await;
        assert!(append_context_reset(&pool, &session_id).await.unwrap());
        user_message(&pool, &session_id, "third").await;

        // The reader keeps everything, so the user still sees the whole thread.
        let all = list_messages(&pool, &session_id).await.unwrap();
        assert_eq!(all.len(), 5);

        // The request builder only sees what follows the last marker, and the
        // markers themselves never reach the model.
        let history = conversation_history(&pool, &session_id).await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].content.as_deref(), Some("third"));
        assert!(history.iter().all(|m| m.role != ChatRole::ContextReset));
    }

    #[tokio::test]
    async fn history_is_everything_when_context_was_never_cleared() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;
        user_message(&pool, &session_id, "one").await;
        user_message(&pool, &session_id, "two").await;

        let history = conversation_history(&pool, &session_id).await.unwrap();
        assert_eq!(history.len(), 2);
    }

    #[tokio::test]
    async fn redundant_context_resets_are_skipped() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;

        // Nothing to clear yet.
        assert!(!append_context_reset(&pool, &session_id).await.unwrap());

        user_message(&pool, &session_id, "hi").await;
        assert!(append_context_reset(&pool, &session_id).await.unwrap());
        // A second marker in a row would say nothing new.
        assert!(!append_context_reset(&pool, &session_id).await.unwrap());

        assert_eq!(list_messages(&pool, &session_id).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn an_assistant_message_is_completed_after_streaming() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;

        let placeholder = append_message(
            &pool,
            &session_id,
            ChatRole::Assistant,
            NewMessage {
                model_id: Some("model-1"),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        finish_assistant_message(
            &pool,
            &placeholder.id,
            Some("the driver ran out of memory"),
            &[ChatToolCall {
                call_id: "c1".to_string(),
                tool: "analyze_job_failure".to_string(),
                args: serde_json::json!({}),
                result: None,
                error: Some("timed out".to_string()),
                duration_ms: Some(20_000),
                signature: None,
            }],
            Some(21_000),
            None,
            None,
        )
        .await
        .unwrap();

        let messages = list_messages(&pool, &session_id).await.unwrap();
        assert_eq!(
            messages[0].content.as_deref(),
            Some("the driver ran out of memory")
        );
        assert_eq!(messages[0].duration_ms, Some(21_000));
        assert_eq!(
            messages[0].tool_calls[0].error.as_deref(),
            Some("timed out")
        );

        assert!(finish_assistant_message(&pool, "missing", None, &[], None, None, None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn a_failed_or_empty_finish_archives_no_version() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;

        // A turn that ends in an error keeps the error on the row for the
        // transcript, but records nothing to switch back to.
        let errored = append_message(
            &pool,
            &session_id,
            ChatRole::Assistant,
            NewMessage {
                model_id: Some("model-1"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        finish_assistant_message(
            &pool,
            &errored.id,
            None,
            &[],
            Some(3_000),
            Some("the provider refused"),
            None,
        )
        .await
        .unwrap();

        // A turn that produced nothing (whitespace-only text) is equally not a
        // switchable answer.
        let empty = append_message(
            &pool,
            &session_id,
            ChatRole::Assistant,
            NewMessage {
                model_id: Some("model-2"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        finish_assistant_message(&pool, &empty.id, Some("   "), &[], Some(1_000), None, None)
            .await
            .unwrap();

        let messages = list_messages(&pool, &session_id).await.unwrap();
        assert_eq!(messages.len(), 2);
        assert!(messages.iter().all(|m| m.versions.is_empty()));
        assert_eq!(messages[0].error.as_deref(), Some("the provider refused"));
        assert_eq!(messages[0].content.as_deref(), None);
    }

    #[tokio::test]
    async fn a_successful_finish_archives_a_version_that_can_be_deleted_individually() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;

        let reply = append_message(
            &pool,
            &session_id,
            ChatRole::Assistant,
            NewMessage {
                model_id: Some("claude-4"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        finish_assistant_message(&pool, &reply.id, Some("driver OOM"), &[], Some(12), None, None)
            .await
            .unwrap();

        let messages = list_messages(&pool, &session_id).await.unwrap();
        assert_eq!(messages[0].versions.len(), 1);
        assert!(messages[0].versions[0].is_active);
        let version_id = messages[0].versions[0].id.clone();

        // An in-place overwrite drops the superseded version by id.
        delete_message_version(&pool, &session_id, &version_id).await.unwrap();
        let messages = list_messages(&pool, &session_id).await.unwrap();
        assert!(messages[0].versions.is_empty());
    }

    #[tokio::test]
    async fn archived_failed_or_empty_versions_are_not_offered_for_switching() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;
        let a = append_message(
            &pool,
            &session_id,
            ChatRole::Assistant,
            NewMessage {
                model_id: Some("model-ok"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        finish_assistant_message(&pool, &a.id, Some("a real answer"), &[], Some(12), None, None)
            .await
            .unwrap();

        // Stale version rows that archived a failed or empty attempt — written
        // before the archive rule, or backfilled from a pre-versioning row — must
        // not surface as switchable capsules next to the real answer.
        sqlx::query(
            "insert into chat_message_versions
                (id, session_id, message_id, model_id, content, tool_calls, duration_ms, error, error_details, is_active, created_at)
             values ('bad-error', ?1, ?2, 'model-9', NULL, NULL, NULL, 'the provider refused', NULL, 0, '2026-08-30T00:00:00Z')",
        )
        .bind(&session_id)
        .bind(&a.id)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "insert into chat_message_versions
                (id, session_id, message_id, model_id, content, tool_calls, duration_ms, error, error_details, is_active, created_at)
             values ('bad-empty', ?1, ?2, 'model-9', '   ', NULL, NULL, NULL, NULL, 0, '2026-08-30T00:00:01Z')",
        )
        .bind(&session_id)
        .bind(&a.id)
        .execute(&pool)
        .await
        .unwrap();

        let messages = list_messages(&pool, &session_id).await.unwrap();
        assert_eq!(messages[0].versions.len(), 1);
        assert_eq!(messages[0].versions[0].model_id.as_deref(), Some("model-ok"));
    }

    #[tokio::test]
    async fn sessions_are_listed_by_most_recent_activity() {
        let pool = test_pool().await;
        let assistants = list_assistants(&pool).await.unwrap();
        let first = create_session(&pool, &assistants[0].id, Some("older"), None)
            .await
            .unwrap();
        let second = create_session(&pool, &assistants[0].id, Some("newer"), None)
            .await
            .unwrap();

        // Posting into the older session moves it to the top.
        user_message(&pool, &first, "ping").await;

        let sessions = list_sessions(&pool).await.unwrap();
        assert_eq!(sessions[0].id, first);
        assert_eq!(sessions[1].id, second);
    }

    #[tokio::test]
    async fn deleting_an_assistant_takes_its_sessions_and_messages() {
        let pool = test_pool().await;
        let assistant_id = create_assistant(&pool, "Throwaway", None, None, None, None)
            .await
            .unwrap();
        let session_id = create_session(&pool, &assistant_id, None, None).await.unwrap();
        user_message(&pool, &session_id, "hello").await;

        delete_assistant(&pool, &assistant_id).await.unwrap();

        assert!(list_assistants(&pool)
            .await
            .unwrap()
            .iter()
            .all(|a| a.id != assistant_id));
        assert!(list_sessions(&pool).await.unwrap().is_empty());
        assert!(list_messages(&pool, &session_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn clearing_all_sessions_keeps_the_assistants() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;
        user_message(&pool, &session_id, "hi").await;

        assert_eq!(delete_all_sessions(&pool).await.unwrap(), 1);
        assert!(list_sessions(&pool).await.unwrap().is_empty());
        assert!(list_messages(&pool, &session_id).await.unwrap().is_empty());
        assert_eq!(list_assistants(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_fresh_default_titled_session_awaits_its_first_title() {
        let pool = test_pool().await;
        let assistants = list_assistants(&pool).await.unwrap();
        let id = create_session(&pool, &assistants[0].id, None, None)
            .await
            .unwrap();

        assert!(awaiting_first_title(&pool, &id).await.unwrap());

        // Once something has been said, the naming request is not worth issuing.
        user_message(&pool, &id, "why did it fail?").await;
        assert!(!awaiting_first_title(&pool, &id).await.unwrap());
    }

    #[tokio::test]
    async fn a_session_created_with_a_title_is_never_auto_named() {
        let pool = test_pool().await;
        let assistants = list_assistants(&pool).await.unwrap();
        let id = create_session(&pool, &assistants[0].id, Some("job-abc"), None)
            .await
            .unwrap();

        assert!(!awaiting_first_title(&pool, &id).await.unwrap());
        // And a generated title cannot overwrite it either.
        assert!(!rename_if_untitled(&pool, &id, "Driver OOM").await.unwrap());
        let sessions = list_sessions(&pool).await.unwrap();
        assert_eq!(sessions[0].title, "job-abc");
    }

    #[tokio::test]
    async fn a_generated_title_replaces_the_default_name_once() {
        let pool = test_pool().await;
        let assistants = list_assistants(&pool).await.unwrap();
        let id = create_session(&pool, &assistants[0].id, None, None)
            .await
            .unwrap();

        assert!(rename_if_untitled(&pool, &id, "  Driver OOM on job-abc  ")
            .await
            .unwrap());
        let sessions = list_sessions(&pool).await.unwrap();
        assert_eq!(sessions[0].title, "Driver OOM on job-abc");

        // A second generated title must not clobber the first.
        assert!(!rename_if_untitled(&pool, &id, "Something else").await.unwrap());
        // Nor may an empty one blank the name.
        assert!(!rename_if_untitled(&pool, &id, "   ").await.unwrap());
    }

    #[tokio::test]
    async fn a_user_rename_survives_a_later_generated_title() {
        let pool = test_pool().await;
        let assistants = list_assistants(&pool).await.unwrap();
        let id = create_session(&pool, &assistants[0].id, None, None)
            .await
            .unwrap();

        update_session(&pool, &id, Some("my own name"), None).await.unwrap();
        assert!(!rename_if_untitled(&pool, &id, "Generated").await.unwrap());
        assert_eq!(list_sessions(&pool).await.unwrap()[0].title, "my own name");
    }

    #[tokio::test]
    async fn writes_against_missing_rows_are_rejected() {
        let pool = test_pool().await;

        assert!(create_session(&pool, "nope", None, None).await.is_err());
        assert!(update_session(&pool, "nope", Some("x"), None).await.is_err());
        assert!(update_assistant(
            &pool,
            "nope",
            AssistantPatch {
                name: Some("x"),
                ..Default::default()
            }
        )
        .await
        .is_err());
        assert!(
            append_message(&pool, "nope", ChatRole::User, NewMessage::text("hi"))
                .await
                .is_err()
        );
        assert!(create_assistant(&pool, "   ", None, None, None, None)
            .await
            .is_err());

        // Deleting what is not there is not an error — the end state matches.
        assert!(delete_session(&pool, "nope").await.is_ok());
    }

    #[tokio::test]
    async fn foreign_keys_on_delete_clears_version_children_without_constraint() {
        // The production pool enables `pragma foreign_keys`. Regression for the
        // @-regenerate flow: when the old assistant reply — which still has
        // version rows pointing at it — is discarded, deleting the parent row
        // must succeed (no SQLITE_CONSTRAINT_FOREIGNKEY) and the now-orphaned
        // version children must be sweepable.
        let pool = fk_pool().await;
        let session_id = session(&pool).await;
        let q = append_message(
            &pool,
            &session_id,
            ChatRole::User,
            NewMessage::text("why?"),
        )
        .await
        .unwrap();
        let a = append_message(
            &pool,
            &session_id,
            ChatRole::Assistant,
            NewMessage {
                model_id: Some("claude-4"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        // A real finish writes the active version row, mirroring the message.
        finish_assistant_message(&pool, &a.id, Some("driver OOM"), &[], Some(12), None, None)
            .await
            .unwrap();

        delete_messages_from(&pool, &session_id, q.seq + 1).await.unwrap();
        let remaining = list_messages(&pool, &session_id).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].content.as_deref(), Some("why?"));

        // The version row now points at a deleted message; the orphan sweep
        // removes it rather than leaving it to break a later FK write.
        purge_orphan_message_versions(&pool, &session_id).await.unwrap();
        let items: i64 = sqlx::query("select count(*) from chat_message_versions")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get(0);
        assert_eq!(items, 0);
    }

    #[tokio::test]
    async fn migrate_rebuilds_a_legacy_version_table_that_still_has_a_foreign_key() {
        // A database created by the release that declared `references
        // chat_messages(id)` keeps that FK — `create table if not exists` never
        // touches an existing table, so changing the DDL above does not heal it.
        // migrate() must detect the leftover constraint and rebuild the table
        // without it, preserving rows. Otherwise the next regenerate on an
        // FK-enabled connection fails with SQLITE_CONSTRAINT_FOREIGNKEY the
        // moment it discards a reply that still has version rows.
        let pool = fk_pool().await;
        let session_id = session(&pool).await;

        // Roll the version table back to the legacy schema, as a pre-fix install
        // would have it. Dropping the fresh table also drops its index.
        sqlx::query("drop table chat_message_versions")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "create table chat_message_versions (
                id text primary key,
                session_id text not null,
                message_id text not null references chat_messages(id),
                model_id text,
                content text,
                tool_calls text,
                duration_ms integer,
                error text,
                error_details text,
                is_active integer not null default 0,
                created_at text not null
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("create index idx_chat_message_versions_message on chat_message_versions(message_id)")
            .execute(&pool)
            .await
            .unwrap();

        let q = append_message(&pool, &session_id, ChatRole::User, NewMessage::text("why?"))
            .await
            .unwrap();
        let a = append_message(
            &pool,
            &session_id,
            ChatRole::Assistant,
            NewMessage {
                model_id: Some("claude-4"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        finish_assistant_message(&pool, &a.id, Some("driver OOM"), &[], Some(12), None, None)
            .await
            .unwrap();

        // Running migrate again heals the schema: the FK is gone and the version
        // row survived the rebuild (and so is skipped by the backfill).
        migrate(&pool).await.expect("migrate rebuilds the legacy table");
        let schema: String = sqlx::query(
            "select sql from sqlite_master
             where type = 'table' and name = 'chat_message_versions'",
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .get(0);
        assert!(!schema.contains("references"), "{schema}");
        let versions: i64 = sqlx::query("select count(*) from chat_message_versions")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get(0);
        assert_eq!(versions, 1);

        // The proof that matters: discarding the assistant reply (regenerate) no
        // longer trips SQLITE_CONSTRAINT_FOREIGNKEY while its version row points
        // at it.
        delete_messages_from(&pool, &session_id, q.seq + 1)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_single_message_can_be_deleted() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;
        user_message(&pool, &session_id, "why?").await;
        let reply = append_message(
            &pool,
            &session_id,
            ChatRole::Assistant,
            NewMessage {
                content: Some("driver OOM"),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        delete_message(&pool, &session_id, &reply.id).await.unwrap();

        let remaining = list_messages(&pool, &session_id).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].role, ChatRole::User);
        // The conversation keeps working: a fresh send starts on a user turn.
        assert_eq!(remaining[0].content.as_deref(), Some("why?"));
    }

    #[tokio::test]
    async fn deleting_the_only_user_turn_leaves_it_as_the_last_message() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;
        let q = append_message(
            &pool,
            &session_id,
            ChatRole::User,
            NewMessage::text("only question"),
        )
        .await
        .unwrap();

        delete_message(&pool, &session_id, &q.id).await.unwrap();

        // No messages remain — which is fine, nothing to start on.
        assert!(list_messages(&pool, &session_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_message_before_the_last_user_turn_cannot_be_isolated_as_first() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;
        let first_user = append_message(
            &pool,
            &session_id,
            ChatRole::User,
            NewMessage::text("first"),
        )
        .await
        .unwrap();
        let reply = append_message(
            &pool,
            &session_id,
            ChatRole::Assistant,
            NewMessage {
                content: Some("first reply"),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        // Deleting the first user turn would leave the reply opening the
        // conversation — refusing keeps the transcript valid.
        let err = delete_message(&pool, &session_id, &first_user.id)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("assistant turn"));

        // The non-corrupting half is still achievable: deleting the reply.
        delete_message(&pool, &session_id, &reply.id).await.unwrap();
        assert_eq!(list_messages(&pool, &session_id).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn deleting_from_a_point_truncates_everything_after_it() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;
        user_message(&pool, &session_id, "first").await;
        user_message(&pool, &session_id, "second").await;
        user_message(&pool, &session_id, "third").await;

        let second = list_messages(&pool, &session_id).await.unwrap()[1].clone();
        delete_messages_from(&pool, &session_id, second.seq).await.unwrap();

        let remaining = list_messages(&pool, &session_id).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].content.as_deref(), Some("first"));
    }

    #[tokio::test]
    async fn editing_updates_the_content_of_a_message() {
        let pool = test_pool().await;
        let session_id = session(&pool).await;
        let q = append_message(
            &pool,
            &session_id,
            ChatRole::User,
            NewMessage::text("why did it fail?"),
        )
        .await
        .unwrap();

        update_message_content(&pool, &q.id, "why did it fail on 8G?").await.unwrap();

        let messages = list_messages(&pool, &session_id).await.unwrap();
        assert_eq!(messages[0].content.as_deref(), Some("why did it fail on 8G?"));

        // A blank revision and a missing row are both rejected.
        assert!(update_message_content(&pool, &q.id, "   ").await.is_err());
        assert!(update_message_content(&pool, "nope", "x").await.is_err());
    }
}
