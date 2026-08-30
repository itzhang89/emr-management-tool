//! SQLite storage for chat assistants, sessions, and messages.
//!
//! Sessions persist so the Chat sidebar's list survives a restart. That means
//! log excerpts a tool returned end up on disk in this database — the UI offers
//! session deletion for exactly that reason.

use crate::error::{AppError, AppResult};
use crate::models::{ChatAssistant, ChatMessage, ChatRole, ChatSession, ChatToolCall};
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
            created_at text not null
        )",
        "create index if not exists idx_chat_sessions_assistant on chat_sessions(assistant_id)",
        "create index if not exists idx_chat_messages_session on chat_messages(session_id, seq)",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }

    seed_built_in_assistant(pool).await
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

fn row_to_message(row: &sqlx::sqlite::SqliteRow) -> AppResult<ChatMessage> {
    let role_text: String = row.get("role");
    let tool_calls: Option<String> = row.get("tool_calls");
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
        created_at: parse_timestamp(&row.get::<String, _>("created_at")),
    })
}

/// Every message in a session, oldest first — the full readable history,
/// including any `ContextReset` markers.
pub async fn list_messages(pool: &SqlitePool, session_id: &str) -> AppResult<Vec<ChatMessage>> {
    let rows = sqlx::query("select * from chat_messages where session_id = ?1 order by seq")
        .bind(session_id)
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    rows.iter().map(row_to_message).collect()
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

    sqlx::query(
        "insert into chat_messages
            (id, session_id, seq, role, content, tool_calls, model_id, duration_ms, error, created_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
        created_at: parse_timestamp(&now),
    })
}

/// Rewrites an assistant message in place as the stream completes: the streamed
/// text and the tool calls made along the way are known only at the end, but the
/// row is created up front so the UI has an id to attach deltas to.
pub async fn finish_assistant_message(
    pool: &SqlitePool,
    message_id: &str,
    content: Option<&str>,
    tool_calls: &[ChatToolCall],
    duration_ms: Option<i64>,
    error: Option<&str>,
) -> AppResult<()> {
    let tool_calls_json = if tool_calls.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(tool_calls)
                .map_err(|error| AppError::storage(error.to_string()))?,
        )
    };

    let affected = sqlx::query(
        "update chat_messages
         set content = ?1, tool_calls = ?2, duration_ms = ?3, error = ?4
         where id = ?5",
    )
    .bind(content)
    .bind(&tool_calls_json)
    .bind(duration_ms)
    .bind(error)
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
            }],
            Some(21_000),
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

        assert!(finish_assistant_message(&pool, "missing", None, &[], None, None)
            .await
            .is_err());
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
}
