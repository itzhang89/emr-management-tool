//! SQLite storage for the LLM provider → model tree.
//!
//! Kept out of `repository.rs` (already ~1000 lines of AWS/job concerns) since
//! nothing here touches AWS. Secrets are absent by design: API key values and
//! custom header values live in `crate::secrets`; this layer stores only their
//! metadata (masks, health status, header names).

use crate::error::{AppError, AppResult};
use crate::models::{
    AddLlmModelInput, LlmApiKey, LlmApiKeyStatus, LlmModel, LlmModelCapabilities, LlmModelType,
    LlmProtocol, LlmProvider,
};
use chrono::Utc;
use sqlx::{Row, SqlitePool};

use super::parse_timestamp;

/// The presets seeded on first run, disabled and keyless.
///
/// They exist so the common case is "paste a key into the row that is already
/// there" rather than "know that Gemini lists at /v1beta". Ids are fixed so the
/// seed is idempotent, and the rows are ordinary providers afterwards — editable,
/// duplicable, deletable.
///
/// The fourth field overrides the protocol's usual address when `Some`. The four
/// domestic OpenAI-compatible gateways need this: they speak the `openai` shape
/// but each has its own host, and the address is the whole point of a preset.
const BUILT_IN_PROVIDERS: [(&str, &str, LlmProtocol, Option<&'static str>); 7] = [
    ("builtin-openai", "OpenAI", LlmProtocol::Openai, None),
    ("builtin-anthropic", "Anthropic", LlmProtocol::Anthropic, None),
    ("builtin-gemini", "Gemini", LlmProtocol::Gemini, None),
    ("builtin-deepseek", "DeepSeek", LlmProtocol::Openai, Some("https://api.deepseek.com")),
    ("builtin-kimi", "Kimi", LlmProtocol::Openai, Some("https://api.moonshot.cn/v1")),
    (
        "builtin-zhipu",
        "Zhipu AI",
        LlmProtocol::Openai,
        Some("https://open.bigmodel.cn/api/paas/v4"),
    ),
    (
        "builtin-qwen",
        "Qwen",
        LlmProtocol::Openai,
        Some("https://dashscope.aliyuncs.com/compatible-mode/v1"),
    ),
];

/// Schema for the three LLM tables. Follows `repository::migrate`'s
/// `create table if not exists` style rather than introducing a version-number
/// migration mechanism.
///
/// Foreign keys are declared for documentation, but deletes cascade explicitly
/// in Rust: the app's pool does not enable `pragma foreign_keys`, so relying on
/// `on delete cascade` here would silently leave orphans.
pub(crate) async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    // Before anything else: an older layout's tables have the same names but
    // different columns, so every statement below would fail against them.
    // Drop those tables so the `create table if not exists` statements land on a
    // clean slate.
    drop_legacy_schema(pool).await?;

    for statement in [
        "create table if not exists llm_providers (
            id text primary key,
            name text not null,
            protocol text not null,
            base_url text not null default '',
            enabled integer not null default 0,
            built_in integer not null default 0,
            header_names text,
            sort_order integer not null default 0,
            created_at text not null,
            updated_at text not null
        )",
        "create table if not exists llm_api_keys (
            id text primary key,
            provider_id text not null references llm_providers(id),
            label text,
            masked text not null,
            status text not null default 'unknown',
            status_message text,
            checked_at text,
            sort_order integer not null default 0,
            created_at text not null
        )",
        "create table if not exists llm_models (
            id text primary key,
            provider_id text not null references llm_providers(id),
            model_id text not null,
            series text not null,
            display_name text,
            model_type text not null default 'chat',
            capabilities text,
            is_default integer not null default 0,
            context_window integer,
            max_input_tokens integer,
            max_output_tokens integer,
            created_at text not null,
            unique (provider_id, model_id)
        )",
        "create index if not exists idx_llm_api_keys_provider on llm_api_keys(provider_id)",
        "create index if not exists idx_llm_models_provider on llm_models(provider_id)",
        // Records which presets have ever been seeded. `on conflict do nothing`
        // against `llm_providers` is not enough on its own: a deleted preset has
        // no row to conflict with, so it would come back on the next start.
        "create table if not exists llm_seeded_providers (
            id text primary key,
            seeded_at text not null
        )",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }

    seed_built_in_providers(pool).await
}

/// Inserts each preset exactly once, ever.
///
/// Unlike the built-in chat assistant — whose prompt is refreshed on every start
/// so improvements reach existing installs — these rows are the user's to change.
/// An edited preset keeps its edits, and a deleted one stays deleted, which is why
/// the marker table exists rather than relying on the row's own presence.
async fn seed_built_in_providers(pool: &SqlitePool) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    for (index, (id, name, protocol, base_url)) in BUILT_IN_PROVIDERS.iter().enumerate() {
        let claimed = sqlx::query(
            "insert into llm_seeded_providers (id, seeded_at) values (?1, ?2)
             on conflict(id) do nothing",
        )
        .bind(id)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .rows_affected();
        if claimed == 0 {
            continue;
        }

        // An OpenAI-compatible gateway that is not OpenAI lists at its own host,
        // so the preset may carry an address other than the protocol's default.
        let base_url = base_url.unwrap_or_else(|| protocol.default_base_url());

        sqlx::query(
            "insert into llm_providers
                (id, name, protocol, base_url, enabled, built_in, sort_order, created_at, updated_at)
             values (?1, ?2, ?3, ?4, 0, 1, ?5, ?6, ?6)
             on conflict(id) do nothing",
        )
        .bind(id)
        .bind(name)
        .bind(protocol.as_str())
        .bind(base_url)
        .bind(index as i64)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    }
    Ok(())
}

/// Single-column update, then bump `updated_at`.
///
/// sqlx 0.9 only accepts `&'static str` SQL, so the statement is assembled by
/// `concat!` at compile time rather than `format!` at runtime — the table and
/// column names cannot come from caller input even by mistake.
macro_rules! update_column {
    ($pool:expr, $table:literal, $id:expr, $column:literal, $value:expr) => {{
        let affected = sqlx::query(concat!(
            "update ",
            $table,
            " set ",
            $column,
            " = ?1 where id = ?2"
        ))
        .bind($value)
        .bind($id)
        .execute($pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .rows_affected();
        if affected == 0 {
            Err(AppError::validation(format!(
                concat!($table, " row {} was not found."),
                $id
            )))
        } else {
            touch_updated_at($pool, $table, $id).await
        }
    }};
}

/// Header names are stored as a JSON array. A row written by an older build, or
/// hand-edited into something else, reads back as "no custom headers" rather
/// than failing the whole tree query.
fn parse_header_names(raw: Option<String>) -> Vec<String> {
    raw.and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .unwrap_or_default()
}

/// Same tolerance for capabilities: an unparseable value means "nothing known",
/// which is what `Default` says.
fn parse_capabilities(raw: Option<String>) -> LlmModelCapabilities {
    raw.and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

// --- Legacy reset ----------------------------------------------------------

/// Drops LLM tables written by an older layout, so the `create table if not
/// exists` statements in `migrate` land on a clean slate.
///
/// Nothing is migrated. From the original layout — protocol as `kind` on the
/// provider — an endpoint's protocol is unknowable. From the intermediate one,
/// a provider with two endpoints has no single protocol or address to collapse
/// into, and picking one would silently discard the other. Both are the author's
/// own unreleased schemas, so there is no installed base to preserve.
async fn drop_legacy_schema(pool: &SqlitePool) -> AppResult<()> {
    if has_legacy_schema(pool).await? {
        drop_all(pool).await?;
    }
    Ok(())
}

/// True when the stored schema predates this layout — either the original, where
/// the protocol was a `kind` column on the provider, or the intermediate one that
/// put it on a separate `llm_endpoints` table.
///
/// Detected by structure rather than a version number, matching how
/// `repository.rs` handles its own reshapes. A database with no LLM tables at all
/// is not legacy — it is new.
pub async fn has_legacy_schema(pool: &SqlitePool) -> AppResult<bool> {
    if table_exists(pool, "llm_endpoints").await? {
        return Ok(true);
    }
    let Some(sql) = table_sql(pool, "llm_providers").await? else {
        return Ok(false);
    };
    // The current shape carries the protocol itself; neither older one did.
    Ok(sql.contains("kind") || !sql.contains("protocol"))
}

async fn table_sql(pool: &SqlitePool, table: &str) -> AppResult<Option<String>> {
    Ok(
        sqlx::query("select sql from sqlite_master where type = 'table' and name = ?1")
            .bind(table)
            .fetch_optional(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?
            .and_then(|row| row.get::<Option<String>, _>("sql")),
    )
}

async fn table_exists(pool: &SqlitePool, table: &str) -> AppResult<bool> {
    Ok(table_sql(pool, table).await?.is_some())
}

/// Drops the LLM tables, so the presets are re-seeded on the next `migrate`
/// rather than leaving the user with nothing.
async fn drop_all(pool: &SqlitePool) -> AppResult<()> {
    for statement in [
        "drop table if exists llm_models",
        "drop table if exists llm_api_keys",
        "drop table if exists llm_endpoints",
        "drop table if exists llm_providers",
        "drop table if exists llm_seeded_providers",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }
    Ok(())
}

// --- Reads -----------------------------------------------------------------

/// The whole tree in three queries. Providers and their keys/models are only ever
/// a few dozen rows, so assembling it here beats making the frontend issue one
/// call per level.
pub async fn list_providers(pool: &SqlitePool) -> AppResult<Vec<LlmProvider>> {
    let provider_rows =
        sqlx::query("select * from llm_providers order by sort_order, name collate nocase")
            .fetch_all(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;

    let key_rows = sqlx::query("select * from llm_api_keys order by sort_order, created_at")
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    let model_rows = sqlx::query(
        "select * from llm_models order by series collate nocase, model_id collate nocase",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    let mut keys_by_provider: std::collections::HashMap<String, Vec<LlmApiKey>> =
        std::collections::HashMap::new();
    for row in key_rows {
        let key = api_key_from_row(&row);
        keys_by_provider
            .entry(key.provider_id.clone())
            .or_default()
            .push(key);
    }

    let mut models_by_provider: std::collections::HashMap<String, Vec<LlmModel>> =
        std::collections::HashMap::new();
    for row in model_rows {
        let model = LlmModel {
            id: row.get("id"),
            provider_id: row.get("provider_id"),
            model_id: row.get("model_id"),
            series: row.get("series"),
            display_name: row.get("display_name"),
            model_type: LlmModelType::parse_or_chat(&row.get::<String, _>("model_type")),
            capabilities: parse_capabilities(row.get("capabilities")),
            is_default: row.get::<i64, _>("is_default") != 0,
            context_window: row.get("context_window"),
            max_input_tokens: row.get("max_input_tokens"),
            max_output_tokens: row.get("max_output_tokens"),
            created_at: parse_timestamp(&row.get::<String, _>("created_at")),
        };
        models_by_provider
            .entry(model.provider_id.clone())
            .or_default()
            .push(model);
    }

    let mut providers = Vec::with_capacity(provider_rows.len());
    for row in provider_rows {
        let id: String = row.get("id");
        let protocol_text: String = row.get("protocol");
        providers.push(LlmProvider {
            api_keys: keys_by_provider.remove(&id).unwrap_or_default(),
            models: models_by_provider.remove(&id).unwrap_or_default(),
            id,
            name: row.get("name"),
            protocol: LlmProtocol::parse(&protocol_text).ok_or_else(|| {
                AppError::storage(format!("Unknown LLM protocol {protocol_text}."))
            })?,
            base_url: row.get("base_url"),
            enabled: row.get::<i64, _>("enabled") != 0,
            built_in: row.get::<i64, _>("built_in") != 0,
            header_names: parse_header_names(row.get("header_names")),
            sort_order: row.get("sort_order"),
            created_at: parse_timestamp(&row.get::<String, _>("created_at")),
            updated_at: parse_timestamp(&row.get::<String, _>("updated_at")),
        });
    }

    Ok(providers)
}

fn api_key_from_row(row: &sqlx::sqlite::SqliteRow) -> LlmApiKey {
    LlmApiKey {
        id: row.get("id"),
        provider_id: row.get("provider_id"),
        label: row.get("label"),
        masked: row.get("masked"),
        status: LlmApiKeyStatus::parse_or_unknown(&row.get::<String, _>("status")),
        status_message: row.get("status_message"),
        checked_at: row
            .get::<Option<String>, _>("checked_at")
            .as_deref()
            .map(parse_timestamp),
        sort_order: row.get("sort_order"),
        created_at: parse_timestamp(&row.get::<String, _>("created_at")),
    }
}

/// The provider's protocol and base URL — what the model-sync and
/// connection-test paths need without walking the whole tree.
pub async fn provider_target(
    pool: &SqlitePool,
    provider_id: &str,
) -> AppResult<(LlmProtocol, String)> {
    let (protocol, base_url) = protocol_and_url(pool, provider_id).await?;
    if base_url.trim().is_empty() {
        return Err(AppError::validation(
            "This provider has no API address yet. Add one before using it.",
        ));
    }
    Ok((protocol, base_url))
}

/// Just the protocol. Headers and the base URL are configured in either order,
/// so header validation — which needs the protocol's reserved names — must not
/// depend on an address being present yet.
pub async fn provider_protocol(pool: &SqlitePool, provider_id: &str) -> AppResult<LlmProtocol> {
    Ok(protocol_and_url(pool, provider_id).await?.0)
}

async fn protocol_and_url(
    pool: &SqlitePool,
    provider_id: &str,
) -> AppResult<(LlmProtocol, String)> {
    let row = sqlx::query("select protocol, base_url from llm_providers where id = ?1")
        .bind(provider_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .ok_or_else(|| AppError::validation(format!("LLM provider {provider_id} was not found.")))?;

    let protocol_text: String = row.get("protocol");
    let protocol = LlmProtocol::parse(&protocol_text)
        .ok_or_else(|| AppError::storage(format!("Unknown LLM protocol {protocol_text}.")))?;
    Ok((protocol, row.get("base_url")))
}

/// Model ids already stored for a provider, so the sync dialog can mark them.
pub async fn stored_model_ids(pool: &SqlitePool, provider_id: &str) -> AppResult<Vec<String>> {
    let rows = sqlx::query("select model_id from llm_models where provider_id = ?1")
        .bind(provider_id)
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(rows.into_iter().map(|row| row.get("model_id")).collect())
}

// --- Providers -------------------------------------------------------------

/// Normalises and validates a base URL. The empty string is allowed: a provider
/// can be created blank and filled in later.
fn normalise_base_url(base_url: &str) -> AppResult<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err(AppError::validation(
            "API address must start with http:// or https://.",
        ));
    }
    Ok(trimmed.to_string())
}

pub async fn create_provider(
    pool: &SqlitePool,
    name: &str,
    protocol: LlmProtocol,
) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Provider name is required."));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    // New providers land at the end of the list.
    let next_order: i64 =
        sqlx::query("select coalesce(max(sort_order), -1) + 1 from llm_providers")
            .fetch_one(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?
            .get(0);

    sqlx::query(
        "insert into llm_providers
            (id, name, protocol, base_url, enabled, built_in, sort_order, created_at, updated_at)
         values (?1, ?2, ?3, ?4, 0, 0, ?5, ?6, ?6)",
    )
    .bind(&id)
    .bind(name)
    .bind(protocol.as_str())
    // A hand-made provider still gets the protocol's usual address as a start.
    .bind(protocol.default_base_url())
    .bind(next_order)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(id)
}

pub async fn update_provider(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    protocol: Option<LlmProtocol>,
    base_url: Option<&str>,
    enabled: Option<bool>,
    sort_order: Option<i64>,
) -> AppResult<()> {
    if let Some(name) = name {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::validation("Provider name is required."));
        }
        update_column!(pool, "llm_providers", id, "name", name)?;
    }
    if let Some(protocol) = protocol {
        update_column!(pool, "llm_providers", id, "protocol", protocol.as_str())?;
    }
    if let Some(base_url) = base_url {
        let base_url = normalise_base_url(base_url)?;
        update_column!(pool, "llm_providers", id, "base_url", base_url)?;
    }
    if let Some(enabled) = enabled {
        // Enabling means "requests may go here", which a blank address cannot
        // honour. Rejecting it is clearer than accepting a setting that fails at
        // send time.
        if enabled {
            let (_, base_url) = protocol_and_url(pool, id).await?;
            if base_url.trim().is_empty() {
                return Err(AppError::validation(
                    "Add an API address before enabling this provider.",
                ));
            }
        }
        update_column!(pool, "llm_providers", id, "enabled", i64::from(enabled))?;
    }
    if let Some(sort_order) = sort_order {
        update_column!(pool, "llm_providers", id, "sort_order", sort_order)?;
    }
    Ok(())
}

/// Replaces the stored header-name list. The values themselves are the caller's
/// concern, since they go to the keychain.
pub async fn set_provider_header_names(
    pool: &SqlitePool,
    id: &str,
    names: &[String],
) -> AppResult<()> {
    let encoded =
        serde_json::to_string(names).map_err(|error| AppError::storage(error.to_string()))?;
    update_column!(pool, "llm_providers", id, "header_names", encoded)
}

/// Copies a provider's settings and models under a new name, without its keys.
///
/// Keys are deliberately not copied: a duplicate exists to point at a different
/// account or gateway, and silently cloning a credential into a second row would
/// leave two places to revoke it from. Models are copied because re-importing a
/// catalogue by hand is the tedious part.
pub async fn duplicate_provider(
    pool: &SqlitePool,
    source_id: &str,
    name: &str,
) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Provider name is required."));
    }

    let source = sqlx::query("select protocol, base_url, header_names from llm_providers where id = ?1")
        .bind(source_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .ok_or_else(|| AppError::validation(format!("LLM provider {source_id} was not found.")))?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let next_order: i64 =
        sqlx::query("select coalesce(max(sort_order), -1) + 1 from llm_providers")
            .fetch_one(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?
            .get(0);

    sqlx::query(
        "insert into llm_providers
            (id, name, protocol, base_url, enabled, built_in, header_names, sort_order, created_at, updated_at)
         values (?1, ?2, ?3, ?4, 0, 0, ?5, ?6, ?7, ?7)",
    )
    .bind(&id)
    .bind(name)
    .bind(source.get::<String, _>("protocol"))
    .bind(source.get::<String, _>("base_url"))
    // The names are copied so the form shows what is expected; the values are
    // not, for the same reason the keys are not.
    .bind(source.get::<Option<String>, _>("header_names"))
    .bind(next_order)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    // `is_default` is cleared: exactly one model is the global default, and a
    // copy must not contend for it.
    sqlx::query(
        "insert into llm_models
            (id, provider_id, model_id, series, display_name, model_type, capabilities,
             is_default, context_window, max_input_tokens, max_output_tokens, created_at)
         select lower(hex(randomblob(16))), ?1, model_id, series, display_name, model_type,
                capabilities, 0, context_window, max_input_tokens, max_output_tokens, ?2
         from llm_models where provider_id = ?3",
    )
    .bind(&id)
    .bind(&now)
    .bind(source_id)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(id)
}

/// Deletes a provider with its keys and models, reporting which keychain entries
/// that orphaned.
pub async fn delete_provider(pool: &SqlitePool, id: &str) -> AppResult<DeletedSecrets> {
    if !table_exists(pool, "llm_providers").await? {
        return Ok(DeletedSecrets::default());
    }
    let exists: i64 = sqlx::query("select count(*) from llm_providers where id = ?1")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .get(0);
    if exists == 0 {
        return Ok(DeletedSecrets::default());
    }

    let api_key_ids: Vec<String> = sqlx::query("select id from llm_api_keys where provider_id = ?1")
        .bind(id)
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .into_iter()
        .map(|row| row.get("id"))
        .collect();

    for statement in [
        "delete from llm_models where provider_id = ?1",
        "delete from llm_api_keys where provider_id = ?1",
        "delete from llm_providers where id = ?1",
    ] {
        sqlx::query(statement)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }

    Ok(DeletedSecrets {
        provider_ids: vec![id.to_string()],
        api_key_ids,
    })
}

/// Keychain entries a delete orphaned. The caller removes them; this layer has
/// no `AppHandle` and deliberately does not take one.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct DeletedSecrets {
    pub provider_ids: Vec<String>,
    pub api_key_ids: Vec<String>,
}

// --- API keys --------------------------------------------------------------

/// Records a key's metadata and returns its id, which is also its keychain key
/// suffix. The value is written by the caller.
pub async fn add_api_key(
    pool: &SqlitePool,
    provider_id: &str,
    masked: &str,
    label: Option<&str>,
) -> AppResult<String> {
    let provider_exists: i64 = sqlx::query("select count(*) from llm_providers where id = ?1")
        .bind(provider_id)
        .fetch_one(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .get(0);
    if provider_exists == 0 {
        return Err(AppError::validation(format!(
            "LLM provider {provider_id} was not found."
        )));
    }

    let next_order: i64 = sqlx::query(
        "select coalesce(max(sort_order), -1) + 1 from llm_api_keys where provider_id = ?1",
    )
    .bind(provider_id)
    .fetch_one(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .get(0);

    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "insert into llm_api_keys
            (id, provider_id, label, masked, status, sort_order, created_at)
         values (?1, ?2, ?3, ?4, 'unknown', ?5, ?6)",
    )
    .bind(&id)
    .bind(provider_id)
    .bind(label.map(str::trim).filter(|label| !label.is_empty()))
    .bind(masked)
    .bind(next_order)
    .bind(Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(id)
}

pub async fn update_api_key(
    pool: &SqlitePool,
    id: &str,
    label: Option<&str>,
    sort_order: Option<i64>,
) -> AppResult<()> {
    if let Some(label) = label {
        update_column!(pool, "llm_api_keys", id, "label", label.trim())?;
    }
    if let Some(sort_order) = sort_order {
        update_column!(pool, "llm_api_keys", id, "sort_order", sort_order)?;
    }
    Ok(())
}

/// Records what a probe or a real request learned about a key.
pub async fn set_api_key_status(
    pool: &SqlitePool,
    id: &str,
    status: LlmApiKeyStatus,
    message: Option<&str>,
) -> AppResult<()> {
    let affected = sqlx::query(
        "update llm_api_keys set status = ?1, status_message = ?2, checked_at = ?3 where id = ?4",
    )
    .bind(status.as_str())
    .bind(message)
    .bind(Utc::now().to_rfc3339())
    .bind(id)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::validation(format!(
            "LLM API key {id} was not found."
        )));
    }
    Ok(())
}

pub async fn delete_api_key(pool: &SqlitePool, id: &str) -> AppResult<()> {
    sqlx::query("delete from llm_api_keys where id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

/// A provider's keys in preference order, for both probing and picking one to
/// send with.
pub async fn list_api_keys(pool: &SqlitePool, provider_id: &str) -> AppResult<Vec<LlmApiKey>> {
    let rows = sqlx::query(
        "select * from llm_api_keys where provider_id = ?1 order by sort_order, created_at",
    )
    .bind(provider_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(rows.iter().map(api_key_from_row).collect())
}

// --- Models ----------------------------------------------------------------

/// Adds models to a provider, skipping ones it already has. Returns how many rows
/// were actually inserted so the UI can report "3 of 5 added".
pub async fn add_models(
    pool: &SqlitePool,
    provider_id: &str,
    models: &[AddLlmModelInput],
) -> AppResult<usize> {
    let provider_exists: i64 = sqlx::query("select count(*) from llm_providers where id = ?1")
        .bind(provider_id)
        .fetch_one(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .get(0);
    if provider_exists == 0 {
        return Err(AppError::validation(format!(
            "LLM provider {provider_id} was not found."
        )));
    }

    let now = Utc::now().to_rfc3339();
    let mut inserted = 0usize;
    for model in models {
        let model_id = model.model_id.trim();
        if model_id.is_empty() {
            continue;
        }
        // An explicit series wins; otherwise it is inferred from the model id.
        let series = model
            .series
            .as_deref()
            .map(str::trim)
            .filter(|series| !series.is_empty())
            .map(ToString::to_string)
            .unwrap_or_else(|| crate::chat::model_series::model_series(model_id));
        let capabilities = model
            .capabilities
            .unwrap_or_else(LlmModelCapabilities::chat_defaults);
        let capabilities = serde_json::to_string(&capabilities)
            .map_err(|error| AppError::storage(error.to_string()))?;

        let result = sqlx::query(
            "insert or ignore into llm_models
                (id, provider_id, model_id, series, display_name, model_type, capabilities,
                 is_default, context_window, max_input_tokens, max_output_tokens, created_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10, ?11)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(provider_id)
        .bind(model_id)
        .bind(series)
        .bind(model.display_name.as_deref())
        .bind(model.model_type.unwrap_or(LlmModelType::Chat).as_str())
        .bind(capabilities)
        .bind(model.context_window)
        .bind(model.max_input_tokens)
        .bind(model.max_output_tokens)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
        inserted += result.rows_affected() as usize;
    }

    Ok(inserted)
}

#[allow(clippy::too_many_arguments)]
pub async fn update_model(
    pool: &SqlitePool,
    id: &str,
    model_id: Option<&str>,
    series: Option<&str>,
    display_name: Option<&str>,
    model_type: Option<LlmModelType>,
    capabilities: Option<LlmModelCapabilities>,
    is_default: Option<bool>,
    context_window: Option<i64>,
    max_input_tokens: Option<i64>,
    max_output_tokens: Option<i64>,
) -> AppResult<()> {
    if let Some(model_id) = model_id {
        let model_id = model_id.trim();
        if model_id.is_empty() {
            return Err(AppError::validation("Model id is required."));
        }
        update_column!(pool, "llm_models", id, "model_id", model_id)?;
    }
    if let Some(series) = series {
        let series = series.trim();
        if series.is_empty() {
            return Err(AppError::validation("Model group is required."));
        }
        update_column!(pool, "llm_models", id, "series", series)?;
    }
    if let Some(display_name) = display_name {
        update_column!(pool, "llm_models", id, "display_name", display_name.trim())?;
    }
    if let Some(model_type) = model_type {
        update_column!(pool, "llm_models", id, "model_type", model_type.as_str())?;
    }
    if let Some(capabilities) = capabilities {
        let encoded = serde_json::to_string(&capabilities)
            .map_err(|error| AppError::storage(error.to_string()))?;
        update_column!(pool, "llm_models", id, "capabilities", encoded)?;
    }
    if let Some(context_window) = context_window {
        update_column!(pool, "llm_models", id, "context_window", context_window)?;
    }
    if let Some(max_input_tokens) = max_input_tokens {
        update_column!(pool, "llm_models", id, "max_input_tokens", max_input_tokens)?;
    }
    if let Some(max_output_tokens) = max_output_tokens {
        update_column!(
            pool,
            "llm_models",
            id,
            "max_output_tokens",
            max_output_tokens
        )?;
    }
    if let Some(is_default) = is_default {
        update_column!(pool, "llm_models", id, "is_default", i64::from(is_default))?;
        if is_default {
            // Exactly one default across every provider — it is what a new chat
            // session starts with, so a second one would be ambiguous.
            sqlx::query("update llm_models set is_default = 0 where id <> ?1")
                .bind(id)
                .execute(pool)
                .await
                .map_err(|error| AppError::storage(error.to_string()))?;
        }
    }
    Ok(())
}

pub async fn delete_model(pool: &SqlitePool, id: &str) -> AppResult<()> {
    sqlx::query("delete from llm_models where id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

// --- Shared helpers --------------------------------------------------------

/// Bumps `updated_at`. `llm_models` and `llm_api_keys` have no such column, so
/// this is a no-op there rather than a special case at every call site.
async fn touch_updated_at(pool: &SqlitePool, table: &str, id: &str) -> AppResult<()> {
    let statement = match table {
        "llm_providers" => "update llm_providers set updated_at = ?1 where id = ?2",
        _ => return Ok(()),
    };
    sqlx::query(statement)
        .bind(Utc::now().to_rfc3339())
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
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
        migrate(&pool).await.expect("migrate llm schema");
        pool
    }

    /// A pool with the presets removed, for tests that assert on a specific list.
    async fn empty_pool() -> SqlitePool {
        let pool = test_pool().await;
        for (id, _, _, _) in BUILT_IN_PROVIDERS {
            delete_provider(&pool, id).await.expect("drop preset");
        }
        pool
    }

    fn model(model_id: &str) -> AddLlmModelInput {
        AddLlmModelInput {
            model_id: model_id.to_string(),
            series: None,
            display_name: None,
            model_type: None,
            capabilities: None,
            context_window: None,
            max_input_tokens: None,
            max_output_tokens: None,
        }
    }

    #[tokio::test]
    async fn the_built_in_presets_are_seeded_disabled_and_keyless_with_the_right_address() {
        let pool = test_pool().await;
        let providers = list_providers(&pool).await.expect("list providers");

        // The domestic gateways speak the openai shape, so they differ from the
        // OpenAI preset only by the address the seed pinned for them — an address
        // that must NOT be the protocol default, or they would point at OpenAI.
        let seeded: Vec<(&str, LlmProtocol, &str)> = providers
            .iter()
            .map(|provider| (provider.name.as_str(), provider.protocol, provider.base_url.as_str()))
            .collect();
        assert_eq!(
            seeded,
            vec![
                ("OpenAI", LlmProtocol::Openai, "https://api.openai.com/v1"),
                (
                    "Anthropic",
                    LlmProtocol::Anthropic,
                    "https://api.anthropic.com/v1"
                ),
                (
                    "Gemini",
                    LlmProtocol::Gemini,
                    "https://generativelanguage.googleapis.com/v1beta"
                ),
                ("DeepSeek", LlmProtocol::Openai, "https://api.deepseek.com"),
                ("Kimi", LlmProtocol::Openai, "https://api.moonshot.cn/v1"),
                (
                    "Zhipu AI",
                    LlmProtocol::Openai,
                    "https://open.bigmodel.cn/api/paas/v4"
                ),
                (
                    "Qwen",
                    LlmProtocol::Openai,
                    "https://dashscope.aliyuncs.com/compatible-mode/v1"
                )
            ]
        );

        for provider in &providers {
            assert!(provider.built_in);
            // A preset is a form to fill in, not a live configuration.
            assert!(!provider.enabled);
            assert!(provider.api_keys.is_empty());
            assert!(provider.models.is_empty());
        }
    }

    #[tokio::test]
    async fn seeding_again_never_overwrites_or_resurrects() {
        let pool = test_pool().await;
        update_provider(
            &pool,
            "builtin-openai",
            Some("my gateway"),
            None,
            Some("https://gw.example/v1"),
            None,
            None,
        )
        .await
        .unwrap();
        delete_provider(&pool, "builtin-gemini").await.unwrap();

        migrate(&pool).await.expect("second migrate");

        let providers = list_providers(&pool).await.unwrap();
        let names: Vec<&str> = providers.iter().map(|p| p.name.as_str()).collect();
        // The edit survives, and a deleted preset stays deleted — unlike the chat
        // assistant's prompt, these rows are the user's to change. OpenAI was
        // renamed and Gemini removed; the four domestic presets are untouched.
        assert_eq!(
            names,
            vec![
                "my gateway",
                "Anthropic",
                "DeepSeek",
                "Kimi",
                "Zhipu AI",
                "Qwen"
            ]
        );
        assert_eq!(providers[0].base_url, "https://gw.example/v1");
    }

    #[tokio::test]
    async fn a_provider_carries_its_protocol_address_keys_and_models() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "agentrouter", LlmProtocol::Openai)
            .await
            .unwrap();
        add_api_key(&pool, &id, "sk-••••abcd", Some("primary"))
            .await
            .unwrap();
        add_models(&pool, &id, &[model("gpt-4o"), model("o3")])
            .await
            .unwrap();

        let providers = list_providers(&pool).await.unwrap();
        assert_eq!(providers.len(), 1);
        let provider = &providers[0];
        assert_eq!(provider.protocol, LlmProtocol::Openai);
        // A hand-made provider still starts from the protocol's usual address.
        assert_eq!(provider.base_url, "https://api.openai.com/v1");
        assert!(!provider.built_in);
        assert_eq!(provider.api_keys.len(), 1);
        assert_eq!(provider.models.len(), 2);
    }

    #[tokio::test]
    async fn base_urls_are_normalised_and_validated() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "p", LlmProtocol::Openai).await.unwrap();

        update_provider(&pool, &id, None, None, Some("https://x.example/v1/"), None, None)
            .await
            .expect("trailing slash is trimmed");
        assert_eq!(
            list_providers(&pool).await.unwrap()[0].base_url,
            "https://x.example/v1"
        );

        assert!(
            update_provider(&pool, &id, None, None, Some("x.example/v1"), None, None)
                .await
                .is_err()
        );
        assert!(update_provider(&pool, &id, Some(""), None, None, None, None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn a_provider_without_an_address_cannot_be_enabled() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "p", LlmProtocol::Openai).await.unwrap();
        update_provider(&pool, &id, None, None, Some(""), None, None)
            .await
            .unwrap();

        // Enabling means "requests may go here", so a blank address is refused
        // rather than accepted and failed at send time.
        assert!(update_provider(&pool, &id, None, None, None, Some(true), None)
            .await
            .is_err());

        update_provider(
            &pool,
            &id,
            None,
            None,
            Some("https://x.example/v1"),
            Some(true),
            None,
        )
        .await
        .expect("enabling works once an address is set");
        assert!(list_providers(&pool).await.unwrap()[0].enabled);
    }

    #[tokio::test]
    async fn the_protocol_can_be_switched_on_an_existing_provider() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "p", LlmProtocol::Openai).await.unwrap();

        update_provider(&pool, &id, None, Some(LlmProtocol::Gemini), None, None, None)
            .await
            .unwrap();
        assert_eq!(
            provider_protocol(&pool, &id).await.unwrap(),
            LlmProtocol::Gemini
        );
    }

    #[tokio::test]
    async fn duplicating_copies_the_setup_and_models_but_not_the_keys() {
        let pool = empty_pool().await;
        let source = create_provider(&pool, "Gemini", LlmProtocol::Gemini)
            .await
            .unwrap();
        update_provider(
            &pool,
            &source,
            None,
            None,
            Some("https://gw.example/v1beta"),
            Some(true),
            None,
        )
        .await
        .unwrap();
        set_provider_header_names(&pool, &source, &["X-Api-Token".to_string()])
            .await
            .unwrap();
        add_api_key(&pool, &source, "AIz••••abcd", None).await.unwrap();
        add_models(&pool, &source, &[model("gemini-3.5-flash")])
            .await
            .unwrap();
        let source_model_id = list_providers(&pool).await.unwrap()[0].models[0].id.clone();
        update_model(
            &pool,
            &source_model_id,
            None,
            None,
            None,
            None,
            None,
            Some(true),
            None,
            None,
            None,
        )
        .await
        .unwrap();

        let copy_id = duplicate_provider(&pool, &source, "Gemini (work)")
            .await
            .unwrap();
        let providers = list_providers(&pool).await.unwrap();
        let copy = providers
            .iter()
            .find(|provider| provider.id == copy_id)
            .expect("the copy is listed");

        assert_eq!(copy.name, "Gemini (work)");
        assert_eq!(copy.protocol, LlmProtocol::Gemini);
        assert_eq!(copy.base_url, "https://gw.example/v1beta");
        // Header *names* come along so the form shows what is expected; the values
        // do not, for the same reason the keys do not.
        assert_eq!(copy.header_names, vec!["X-Api-Token".to_string()]);
        // A duplicate points at a different account, so cloning a credential would
        // leave two places to revoke it from.
        assert!(copy.api_keys.is_empty());
        // Not enabled: it has no key yet, so switching it on would only fail.
        assert!(!copy.enabled);
        assert!(!copy.built_in);

        // Models are copied — re-importing a catalogue by hand is the tedious part.
        assert_eq!(copy.models.len(), 1);
        assert_eq!(copy.models[0].model_id, "gemini-3.5-flash");
        assert_ne!(copy.models[0].id, source_model_id, "the copy is its own row");
        // Exactly one model is the global default, so the copy must not contend.
        assert!(!copy.models[0].is_default);

        assert!(duplicate_provider(&pool, "missing", "x").await.is_err());
        assert!(duplicate_provider(&pool, &source, "  ").await.is_err());
    }

    #[tokio::test]
    async fn header_names_round_trip_and_tolerate_junk() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "p", LlmProtocol::Openai).await.unwrap();

        set_provider_header_names(&pool, &id, &["X-Api-Token".to_string(), "X-Org".to_string()])
            .await
            .unwrap();
        assert_eq!(
            list_providers(&pool).await.unwrap()[0].header_names,
            vec!["X-Api-Token".to_string(), "X-Org".to_string()]
        );

        // A value that is not a JSON array reads back as "no custom headers"
        // rather than failing the whole tree query.
        sqlx::query("update llm_providers set header_names = 'not json' where id = ?1")
            .bind(&id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(list_providers(&pool).await.unwrap()[0]
            .header_names
            .is_empty());
    }

    #[tokio::test]
    async fn api_keys_keep_their_order_and_status() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "p", LlmProtocol::Openai).await.unwrap();

        let first = add_api_key(&pool, &id, "sk-••••aaaa", Some("primary"))
            .await
            .unwrap();
        let second = add_api_key(&pool, &id, "sk-••••bbbb", None).await.unwrap();
        set_api_key_status(&pool, &first, LlmApiKeyStatus::Unhealthy, Some("401"))
            .await
            .unwrap();
        set_api_key_status(&pool, &second, LlmApiKeyStatus::Healthy, None)
            .await
            .unwrap();

        let keys = list_api_keys(&pool, &id).await.unwrap();
        assert_eq!(keys.len(), 2);
        assert_eq!(keys[0].id, first);
        assert_eq!(keys[0].status, LlmApiKeyStatus::Unhealthy);
        assert_eq!(keys[0].status_message.as_deref(), Some("401"));
        assert!(keys[0].checked_at.is_some());
        assert_eq!(keys[0].label.as_deref(), Some("primary"));
        assert_eq!(keys[1].status, LlmApiKeyStatus::Healthy);
        // Only the mask is stored; the value lives in the keychain.
        assert_eq!(keys[1].masked, "sk-••••bbbb");

        delete_api_key(&pool, &first).await.unwrap();
        assert_eq!(list_api_keys(&pool, &id).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_new_model_defaults_to_a_tool_calling_chat_model() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "p", LlmProtocol::Gemini).await.unwrap();
        add_models(&pool, &id, &[model("gemini-3.5-flash")])
            .await
            .unwrap();

        let stored = &list_providers(&pool).await.unwrap()[0].models[0];
        assert_eq!(stored.model_type, LlmModelType::Chat);
        assert_eq!(stored.capabilities, LlmModelCapabilities::chat_defaults());
        assert!(stored.capabilities.text);
        assert!(stored.capabilities.tool_calling);
        assert!(!stored.capabilities.vision);
        // The group is inferred from the id: `flash` is not a version segment, so
        // this one keeps its whole name.
        assert_eq!(stored.series, "gemini-3.5-flash");
    }

    #[tokio::test]
    async fn capabilities_and_token_limits_round_trip() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "p", LlmProtocol::Gemini).await.unwrap();
        add_models(
            &pool,
            &id,
            &[AddLlmModelInput {
                model_id: "gemini-3.5-flash".to_string(),
                series: Some("Gemini".to_string()),
                display_name: Some("Gemini 3.5 Flash".to_string()),
                model_type: Some(LlmModelType::Chat),
                capabilities: Some(LlmModelCapabilities {
                    reasoning: true,
                    tool_calling: true,
                    text: true,
                    vision: true,
                    audio: false,
                    video: false,
                }),
                context_window: Some(128_000),
                max_input_tokens: Some(128_000),
                max_output_tokens: Some(4_096),
            }],
        )
        .await
        .unwrap();

        let stored = list_providers(&pool).await.unwrap()[0].models[0].clone();
        assert_eq!(stored.series, "Gemini");
        assert_eq!(stored.display_name.as_deref(), Some("Gemini 3.5 Flash"));
        assert!(stored.capabilities.reasoning);
        assert!(stored.capabilities.vision);
        assert!(!stored.capabilities.audio);
        assert_eq!(stored.context_window, Some(128_000));
        assert_eq!(stored.max_input_tokens, Some(128_000));
        assert_eq!(stored.max_output_tokens, Some(4_096));

        // An edit replaces the whole capability set, not one flag.
        update_model(
            &pool,
            &stored.id,
            None,
            None,
            None,
            None,
            Some(LlmModelCapabilities::default()),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            list_providers(&pool).await.unwrap()[0].models[0].capabilities,
            LlmModelCapabilities::default()
        );
    }

    #[tokio::test]
    async fn adding_a_model_twice_is_ignored() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "p", LlmProtocol::Openai).await.unwrap();

        let first = add_models(&pool, &id, &[model("gpt-4o")]).await.unwrap();
        let second = add_models(&pool, &id, &[model("gpt-4o"), model("o3")])
            .await
            .unwrap();
        assert_eq!(first, 1);
        assert_eq!(second, 1, "only the new model is inserted");
        assert_eq!(stored_model_ids(&pool, &id).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn the_same_model_id_can_exist_under_two_providers() {
        // The uniqueness constraint is per provider: two accounts on the same
        // gateway legitimately offer the same model.
        let pool = empty_pool().await;
        let first = create_provider(&pool, "a", LlmProtocol::Openai).await.unwrap();
        let second = create_provider(&pool, "b", LlmProtocol::Openai).await.unwrap();

        assert_eq!(add_models(&pool, &first, &[model("gpt-4o")]).await.unwrap(), 1);
        assert_eq!(add_models(&pool, &second, &[model("gpt-4o")]).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn only_one_model_is_default_across_providers() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "p", LlmProtocol::Openai).await.unwrap();
        add_models(&pool, &id, &[model("gpt-4o"), model("o3")])
            .await
            .unwrap();

        let ids: Vec<String> = list_providers(&pool).await.unwrap()[0]
            .models
            .iter()
            .map(|model| model.id.clone())
            .collect();
        for model_id in &ids {
            update_model(
                &pool, model_id, None, None, None, None, None, Some(true), None, None, None,
            )
            .await
            .unwrap();
        }

        let defaults: Vec<String> = list_providers(&pool).await.unwrap()[0]
            .models
            .iter()
            .filter(|model| model.is_default)
            .map(|model| model.id.clone())
            .collect();
        assert_eq!(defaults, vec![ids[1].clone()]);
    }

    #[tokio::test]
    async fn resolve_model_picks_an_override_model_by_row_id() {
        let pool = empty_pool().await;
        let provider_id = create_provider(&pool, "gemini", LlmProtocol::Gemini).await.unwrap();
        // One default + one explicit model, so the override has something to
        // out-rank.
        add_models(
            &pool,
            &provider_id,
            &[model("gemini-3.5-flash"), model("gemini-4-flash")],
        )
        .await
        .unwrap();
        update_model(
            &pool,
            &list_providers(&pool).await.unwrap()[0].models[0].id,
            None,
            None,
            None,
            None,
            None,
            Some(true),
            None,
            None,
            None,
        )
        .await
        .unwrap();
        let row_id = list_providers(&pool).await.unwrap()[0].models[1].id.clone();
        update_provider(
            &pool,
            &provider_id,
            None,
            None,
            Some("https://gemini.example"),
            Some(true),
            None,
        )
        .await
        .unwrap();

        // Chat's own tables are separate; seed them so a session exists.
        crate::db::chat::migrate(&pool).await.unwrap();
        let assistants = crate::db::chat::list_assistants(&pool).await.unwrap();
        let session_id = crate::db::chat::create_session(&pool, &assistants[0].id, None, None)
            .await
            .unwrap();

        // The row id names the non-default model directly.
        let resolved =
            crate::chat::session::resolve_model(&pool, &session_id, Some(&row_id)).await.unwrap();
        assert_eq!(resolved.model_id, "gemini-4-flash");
        assert_eq!(resolved.provider_id, provider_id);
    }

    #[tokio::test]
    async fn deleting_a_provider_reports_every_orphaned_secret() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "p", LlmProtocol::Openai).await.unwrap();
        let key_id = add_api_key(&pool, &id, "sk-••••aaaa", None).await.unwrap();
        add_models(&pool, &id, &[model("gpt-4o")]).await.unwrap();

        // The returned ids are what the caller needs to clear the matching
        // keychain entries.
        let deleted = delete_provider(&pool, &id).await.unwrap();
        assert_eq!(deleted.provider_ids, vec![id.clone()]);
        assert_eq!(deleted.api_key_ids, vec![key_id]);

        assert!(list_providers(&pool).await.unwrap().is_empty());
        assert!(stored_model_ids(&pool, &id).await.unwrap().is_empty());
        assert!(list_api_keys(&pool, &id).await.unwrap().is_empty());

        // Deleting what is not there reports nothing rather than failing.
        assert_eq!(
            delete_provider(&pool, "missing").await.unwrap(),
            DeletedSecrets::default()
        );
    }

    #[tokio::test]
    async fn provider_target_reports_the_protocol_and_refuses_a_blank_address() {
        let pool = empty_pool().await;
        let id = create_provider(&pool, "p", LlmProtocol::Gemini).await.unwrap();
        update_provider(&pool, &id, None, None, Some(""), None, None)
            .await
            .unwrap();

        // Blank address: there is nowhere to send the request. The protocol alone
        // still resolves, because header validation needs it either way.
        assert!(provider_target(&pool, &id).await.is_err());
        assert_eq!(
            provider_protocol(&pool, &id).await.unwrap(),
            LlmProtocol::Gemini
        );

        update_provider(
            &pool,
            &id,
            None,
            None,
            Some("https://generativelanguage.googleapis.com/v1beta"),
            None,
            None,
        )
        .await
        .unwrap();
        let (protocol, base_url) = provider_target(&pool, &id).await.unwrap();
        assert_eq!(protocol, LlmProtocol::Gemini);
        assert_eq!(base_url, "https://generativelanguage.googleapis.com/v1beta");

        assert!(provider_target(&pool, "missing").await.is_err());
    }

    #[tokio::test]
    async fn writes_to_missing_rows_are_rejected() {
        let pool = empty_pool().await;
        assert!(update_provider(&pool, "nope", Some("x"), None, None, None, None)
            .await
            .is_err());
        assert!(update_model(
            &pool, "nope", None, Some("x"), None, None, None, None, None, None, None
        )
        .await
        .is_err());
        assert!(add_models(&pool, "nope", &[model("gpt-4o")]).await.is_err());
        assert!(add_api_key(&pool, "nope", "sk-••••aaaa", None).await.is_err());
        assert!(set_api_key_status(&pool, "nope", LlmApiKeyStatus::Healthy, None)
            .await
            .is_err());
        // Deleting what is not there is not an error — the end state matches.
        assert!(delete_model(&pool, "nope").await.is_ok());
        assert!(delete_api_key(&pool, "nope").await.is_ok());
    }

    #[tokio::test]
    async fn the_original_layout_is_replaced_and_the_presets_reseeded() {
        // Protocol as `kind` on the provider, one API key per endpoint.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "create table llm_providers (id text primary key, name text not null, kind text not null)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("create table llm_endpoints (id text primary key)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("insert into llm_endpoints (id) values ('ep-old')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("insert into llm_providers (id, name, kind) values ('p-old', 'x', 'openai')")
            .execute(&pool)
            .await
            .unwrap();

        assert!(has_legacy_schema(&pool).await.unwrap());

        // Migrating replaces the tables rather than failing against them.
        migrate(&pool).await.expect("migrate over the old layout");
        assert!(!has_legacy_schema(&pool).await.unwrap());
        // The presets are seeded into the rebuilt tables.
        assert_eq!(list_providers(&pool).await.unwrap().len(), 7);
    }

    #[tokio::test]
    async fn the_intermediate_layout_is_replaced_and_provider_scoped_writes_work() {
        // Protocol on a separate endpoints table; key values keyed by key id. This
        // is the layout that produced "no such column: provider_id", because its
        // table names match the current ones.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("create table llm_providers (id text primary key, name text not null)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("create table llm_endpoints (id text primary key, protocol text not null)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "create table llm_api_keys (id text primary key, endpoint_id text not null)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("insert into llm_api_keys (id, endpoint_id) values ('k-old', 'ep-old')")
            .execute(&pool)
            .await
            .unwrap();

        assert!(has_legacy_schema(&pool).await.unwrap());
        migrate(&pool).await.expect("migrate over the old layout");

        // The rebuilt tables take the new columns, so a write that the old shape
        // rejected now succeeds.
        let id = create_provider(&pool, "p", LlmProtocol::Openai).await.unwrap();
        add_api_key(&pool, &id, "sk-••••abcd", None)
            .await
            .expect("keys are scoped by provider now");
    }

    #[tokio::test]
    async fn migrate_is_idempotent_and_the_current_schema_is_not_legacy() {
        let pool = test_pool().await;
        migrate(&pool).await.expect("second migrate is a no-op");
        assert!(list_providers(&pool).await.is_ok());
        assert!(!has_legacy_schema(&pool).await.unwrap());
        // Seeding twice must not duplicate the presets.
        assert_eq!(list_providers(&pool).await.unwrap().len(), 7);
    }
}
