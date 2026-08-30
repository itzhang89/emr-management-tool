//! SQLite storage for the LLM provider → endpoint → model tree.
//!
//! Kept out of `repository.rs` (already ~1000 lines of AWS/job concerns) since
//! nothing here touches AWS. API keys are absent by design: they live in
//! `crate::secrets`, keyed by endpoint id.

use crate::error::{AppError, AppResult};
use crate::models::{
    AddLlmModelInput, LlmEndpoint, LlmModel, LlmProvider, LlmProviderKind,
};
use chrono::{DateTime, Utc};
use sqlx::{Row, SqlitePool};

/// Schema for the three LLM tables. Follows `repository::migrate`'s
/// `create table if not exists` style rather than introducing a version-number
/// migration mechanism.
///
/// Foreign keys are declared for documentation, but deletes cascade explicitly
/// in Rust: the app's pool does not enable `pragma foreign_keys`, so relying on
/// `on delete cascade` here would silently leave orphans.
pub(crate) async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    for statement in [
        "create table if not exists llm_providers (
            id text primary key,
            name text not null,
            kind text not null,
            enabled integer not null default 1,
            sort_order integer not null default 0,
            created_at text not null,
            updated_at text not null
        )",
        "create table if not exists llm_endpoints (
            id text primary key,
            provider_id text not null references llm_providers(id),
            name text not null,
            base_url text not null,
            is_default integer not null default 0,
            created_at text not null,
            updated_at text not null
        )",
        "create table if not exists llm_models (
            id text primary key,
            endpoint_id text not null references llm_endpoints(id),
            model_id text not null,
            series text not null,
            display_name text,
            is_default integer not null default 0,
            context_window integer,
            max_output_tokens integer,
            created_at text not null,
            unique (endpoint_id, model_id)
        )",
        "create index if not exists idx_llm_endpoints_provider on llm_endpoints(provider_id)",
        "create index if not exists idx_llm_models_endpoint on llm_models(endpoint_id)",
    ] {
        sqlx::query(statement)
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

fn parse_timestamp(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|parsed| parsed.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

// --- Reads -----------------------------------------------------------------

/// The whole tree in three queries. Providers and their endpoints/models are
/// only ever a few dozen rows, so assembling it here beats making the frontend
/// issue one call per level.
///
/// `has_api_key` / `api_key_masked` are left at their "no key" values — the
/// caller fills them in from `secrets`, which needs an `AppHandle` this layer
/// deliberately does not take.
pub async fn list_providers(pool: &SqlitePool) -> AppResult<Vec<LlmProvider>> {
    let provider_rows =
        sqlx::query("select * from llm_providers order by sort_order, name collate nocase")
            .fetch_all(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;

    let endpoint_rows = sqlx::query(
        "select * from llm_endpoints order by is_default desc, name collate nocase",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    let model_rows = sqlx::query(
        "select * from llm_models order by series collate nocase, model_id collate nocase",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    let mut models_by_endpoint: std::collections::HashMap<String, Vec<LlmModel>> =
        std::collections::HashMap::new();
    for row in model_rows {
        let model = LlmModel {
            id: row.get("id"),
            endpoint_id: row.get("endpoint_id"),
            model_id: row.get("model_id"),
            series: row.get("series"),
            display_name: row.get("display_name"),
            is_default: row.get::<i64, _>("is_default") != 0,
            context_window: row.get("context_window"),
            max_output_tokens: row.get("max_output_tokens"),
            created_at: parse_timestamp(&row.get::<String, _>("created_at")),
        };
        models_by_endpoint
            .entry(model.endpoint_id.clone())
            .or_default()
            .push(model);
    }

    let mut endpoints_by_provider: std::collections::HashMap<String, Vec<LlmEndpoint>> =
        std::collections::HashMap::new();
    for row in endpoint_rows {
        let id: String = row.get("id");
        let endpoint = LlmEndpoint {
            models: models_by_endpoint.remove(&id).unwrap_or_default(),
            id,
            provider_id: row.get("provider_id"),
            name: row.get("name"),
            base_url: row.get("base_url"),
            is_default: row.get::<i64, _>("is_default") != 0,
            has_api_key: false,
            api_key_masked: None,
            created_at: parse_timestamp(&row.get::<String, _>("created_at")),
            updated_at: parse_timestamp(&row.get::<String, _>("updated_at")),
        };
        endpoints_by_provider
            .entry(endpoint.provider_id.clone())
            .or_default()
            .push(endpoint);
    }

    let mut providers = Vec::with_capacity(provider_rows.len());
    for row in provider_rows {
        let id: String = row.get("id");
        let kind_text: String = row.get("kind");
        providers.push(LlmProvider {
            endpoints: endpoints_by_provider.remove(&id).unwrap_or_default(),
            id,
            name: row.get("name"),
            kind: LlmProviderKind::parse(&kind_text).ok_or_else(|| {
                AppError::storage(format!("Unknown LLM provider kind {kind_text}."))
            })?,
            enabled: row.get::<i64, _>("enabled") != 0,
            sort_order: row.get("sort_order"),
            created_at: parse_timestamp(&row.get::<String, _>("created_at")),
            updated_at: parse_timestamp(&row.get::<String, _>("updated_at")),
        });
    }

    Ok(providers)
}

/// The endpoint's provider kind and base URL — what the model-sync and
/// connection-test paths need without walking the whole tree.
pub async fn endpoint_target(
    pool: &SqlitePool,
    endpoint_id: &str,
) -> AppResult<(LlmProviderKind, String)> {
    let row = sqlx::query(
        "select e.base_url as base_url, p.kind as kind
         from llm_endpoints e join llm_providers p on p.id = e.provider_id
         where e.id = ?1",
    )
    .bind(endpoint_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .ok_or_else(|| AppError::validation(format!("LLM endpoint {endpoint_id} was not found.")))?;

    let kind_text: String = row.get("kind");
    let kind = LlmProviderKind::parse(&kind_text)
        .ok_or_else(|| AppError::storage(format!("Unknown LLM provider kind {kind_text}.")))?;
    Ok((kind, row.get("base_url")))
}

/// Model ids already stored for an endpoint, so the sync dialog can mark them.
pub async fn stored_model_ids(pool: &SqlitePool, endpoint_id: &str) -> AppResult<Vec<String>> {
    let rows = sqlx::query("select model_id from llm_models where endpoint_id = ?1")
        .bind(endpoint_id)
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(rows.into_iter().map(|row| row.get("model_id")).collect())
}

// --- Providers -------------------------------------------------------------

pub async fn create_provider(
    pool: &SqlitePool,
    name: &str,
    kind: LlmProviderKind,
) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Provider name is required."));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    // New providers land at the end of the list.
    let next_order: i64 = sqlx::query("select coalesce(max(sort_order), -1) + 1 from llm_providers")
        .fetch_one(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .get(0);

    sqlx::query(
        "insert into llm_providers (id, name, kind, enabled, sort_order, created_at, updated_at)
         values (?1, ?2, ?3, 1, ?4, ?5, ?5)",
    )
    .bind(&id)
    .bind(name)
    .bind(kind.as_str())
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
    if let Some(enabled) = enabled {
        update_column!(pool, "llm_providers", id, "enabled", i64::from(enabled))?;
    }
    if let Some(sort_order) = sort_order {
        update_column!(pool, "llm_providers", id, "sort_order", sort_order)?;
    }
    Ok(())
}

/// Deletes the provider with its endpoints and models. Returns the deleted
/// endpoint ids so the caller can clear their keychain entries — leaving those
/// behind would keep API keys on the machine after the user removed them.
pub async fn delete_provider(pool: &SqlitePool, id: &str) -> AppResult<Vec<String>> {
    let endpoint_ids: Vec<String> =
        sqlx::query("select id from llm_endpoints where provider_id = ?1")
            .bind(id)
            .fetch_all(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?
            .into_iter()
            .map(|row| row.get("id"))
            .collect();

    for endpoint_id in &endpoint_ids {
        delete_models_for_endpoint(pool, endpoint_id).await?;
    }
    sqlx::query("delete from llm_endpoints where provider_id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query("delete from llm_providers where id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(endpoint_ids)
}

// --- Endpoints -------------------------------------------------------------

pub async fn create_endpoint(
    pool: &SqlitePool,
    provider_id: &str,
    name: &str,
    base_url: &str,
    is_default: bool,
) -> AppResult<String> {
    let name = name.trim();
    let base_url = base_url.trim().trim_end_matches('/');
    if name.is_empty() {
        return Err(AppError::validation("Endpoint name is required."));
    }
    if base_url.is_empty() {
        return Err(AppError::validation("API base URL is required."));
    }
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err(AppError::validation(
            "API base URL must start with http:// or https://.",
        ));
    }

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

    // The provider's first endpoint is its default, whatever the caller asked.
    let existing: i64 = sqlx::query("select count(*) from llm_endpoints where provider_id = ?1")
        .bind(provider_id)
        .fetch_one(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .get(0);
    let is_default = is_default || existing == 0;

    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "insert into llm_endpoints (id, provider_id, name, base_url, is_default, created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
    )
    .bind(&id)
    .bind(provider_id)
    .bind(name)
    .bind(base_url)
    .bind(i64::from(is_default))
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    if is_default {
        clear_other_default_endpoints(pool, provider_id, &id).await?;
    }

    Ok(id)
}

pub async fn update_endpoint(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    base_url: Option<&str>,
    is_default: Option<bool>,
) -> AppResult<()> {
    if let Some(name) = name {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::validation("Endpoint name is required."));
        }
        update_column!(pool, "llm_endpoints", id, "name", name)?;
    }
    if let Some(base_url) = base_url {
        let base_url = base_url.trim().trim_end_matches('/');
        if base_url.is_empty() {
            return Err(AppError::validation("API base URL is required."));
        }
        if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
            return Err(AppError::validation(
                "API base URL must start with http:// or https://.",
            ));
        }
        update_column!(pool, "llm_endpoints", id, "base_url", base_url)?;
    }
    if is_default == Some(true) {
        let provider_id: String = sqlx::query("select provider_id from llm_endpoints where id = ?1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?
            .ok_or_else(|| AppError::validation(format!("LLM endpoint {id} was not found.")))?
            .get("provider_id");
        update_column!(pool, "llm_endpoints", id, "is_default", 1_i64)?;
        clear_other_default_endpoints(pool, &provider_id, id).await?;
    }
    touch_updated_at(pool, "llm_endpoints", id).await
}

/// Deletes an endpoint and its models. The caller clears the keychain entry.
pub async fn delete_endpoint(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let row = sqlx::query("select provider_id, is_default from llm_endpoints where id = ?1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    let Some(row) = row else {
        return Ok(());
    };
    let provider_id: String = row.get("provider_id");
    let was_default = row.get::<i64, _>("is_default") != 0;

    delete_models_for_endpoint(pool, id).await?;
    sqlx::query("delete from llm_endpoints where id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    // A provider must not be left with endpoints but no default one, or the
    // chat loop has no endpoint to pick.
    if was_default {
        if let Some(next_id) = sqlx::query(
            "select id from llm_endpoints where provider_id = ?1 order by created_at limit 1",
        )
        .bind(&provider_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .map(|row| row.get::<String, _>("id"))
        {
            update_column!(pool, "llm_endpoints", &next_id, "is_default", 1_i64)?;
        }
    }

    Ok(())
}

async fn clear_other_default_endpoints(
    pool: &SqlitePool,
    provider_id: &str,
    keep_id: &str,
) -> AppResult<()> {
    sqlx::query("update llm_endpoints set is_default = 0 where provider_id = ?1 and id <> ?2")
        .bind(provider_id)
        .bind(keep_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

// --- Models ----------------------------------------------------------------

/// Adds models to an endpoint, skipping ones it already has. Returns how many
/// rows were actually inserted so the UI can report "3 of 5 added".
pub async fn add_models(
    pool: &SqlitePool,
    endpoint_id: &str,
    models: &[AddLlmModelInput],
) -> AppResult<usize> {
    let endpoint_exists: i64 = sqlx::query("select count(*) from llm_endpoints where id = ?1")
        .bind(endpoint_id)
        .fetch_one(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?
        .get(0);
    if endpoint_exists == 0 {
        return Err(AppError::validation(format!(
            "LLM endpoint {endpoint_id} was not found."
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

        let result = sqlx::query(
            "insert or ignore into llm_models
                (id, endpoint_id, model_id, series, display_name, is_default, context_window, max_output_tokens, created_at)
             values (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(endpoint_id)
        .bind(model_id)
        .bind(series)
        .bind(model.display_name.as_deref())
        .bind(model.context_window)
        .bind(model.max_output_tokens)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
        inserted += result.rows_affected() as usize;
    }

    Ok(inserted)
}

pub async fn update_model(
    pool: &SqlitePool,
    id: &str,
    series: Option<&str>,
    display_name: Option<&str>,
    is_default: Option<bool>,
    context_window: Option<i64>,
    max_output_tokens: Option<i64>,
) -> AppResult<()> {
    if let Some(series) = series {
        let series = series.trim();
        if series.is_empty() {
            return Err(AppError::validation("Model series is required."));
        }
        update_column!(pool, "llm_models", id, "series", series)?;
    }
    if let Some(display_name) = display_name {
        update_column!(pool, "llm_models", id, "display_name", display_name.trim())?;
    }
    if let Some(context_window) = context_window {
        update_column!(pool, "llm_models", id, "context_window", context_window)?;
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

async fn delete_models_for_endpoint(pool: &SqlitePool, endpoint_id: &str) -> AppResult<()> {
    sqlx::query("delete from llm_models where endpoint_id = ?1")
        .bind(endpoint_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

// --- Shared helpers --------------------------------------------------------

/// Bumps `updated_at`. `llm_models` has no such column, so this is a no-op
/// there rather than a special case at every call site.
async fn touch_updated_at(pool: &SqlitePool, table: &str, id: &str) -> AppResult<()> {
    let statement = match table {
        "llm_providers" => "update llm_providers set updated_at = ?1 where id = ?2",
        "llm_endpoints" => "update llm_endpoints set updated_at = ?1 where id = ?2",
        // llm_models rows are immutable apart from the fields set explicitly.
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

    fn model(model_id: &str) -> AddLlmModelInput {
        AddLlmModelInput {
            model_id: model_id.to_string(),
            series: None,
            display_name: None,
            context_window: None,
            max_output_tokens: None,
        }
    }

    #[tokio::test]
    async fn provider_endpoint_and_models_round_trip_as_a_tree() {
        let pool = test_pool().await;
        let provider_id = create_provider(&pool, "agentrouter", LlmProviderKind::Openai)
            .await
            .expect("create provider");
        let endpoint_id = create_endpoint(
            &pool,
            &provider_id,
            "default",
            "https://gateway.example/v1",
            false,
        )
        .await
        .expect("create endpoint");
        add_models(
            &pool,
            &endpoint_id,
            &[model("claude-opus-4-8"), model("gpt-5.6-sol")],
        )
        .await
        .expect("add models");

        let providers = list_providers(&pool).await.expect("list providers");
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].kind, LlmProviderKind::Openai);
        assert!(providers[0].enabled);

        let endpoints = &providers[0].endpoints;
        assert_eq!(endpoints.len(), 1);
        // The first endpoint of a provider is its default even when not asked.
        assert!(endpoints[0].is_default);
        // Keys live in the keychain, so the tree never carries one.
        assert!(!endpoints[0].has_api_key);
        assert_eq!(endpoints[0].api_key_masked, None);

        let series: Vec<&str> = endpoints[0]
            .models
            .iter()
            .map(|model| model.series.as_str())
            .collect();
        assert!(series.contains(&"claude-opus"), "{series:?}");
        assert!(series.contains(&"gpt-5.6-sol"), "{series:?}");
    }

    #[tokio::test]
    async fn base_urls_are_normalised_and_validated() {
        let pool = test_pool().await;
        let provider_id = create_provider(&pool, "p", LlmProviderKind::Openai)
            .await
            .unwrap();

        let endpoint_id = create_endpoint(&pool, &provider_id, "e", "https://x.example/v1/", false)
            .await
            .expect("trailing slash is trimmed");
        let providers = list_providers(&pool).await.unwrap();
        assert_eq!(providers[0].endpoints[0].base_url, "https://x.example/v1");

        assert!(create_endpoint(&pool, &provider_id, "e2", "x.example/v1", false)
            .await
            .is_err());
        assert!(create_endpoint(&pool, &provider_id, "", "https://x.example", false)
            .await
            .is_err());
        assert!(update_endpoint(&pool, &endpoint_id, None, Some("ftp://x"), None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn endpoints_never_lose_their_default() {
        let pool = test_pool().await;
        let provider_id = create_provider(&pool, "p", LlmProviderKind::Anthropic)
            .await
            .unwrap();
        let first = create_endpoint(&pool, &provider_id, "first", "https://a.example", false)
            .await
            .unwrap();
        let second = create_endpoint(&pool, &provider_id, "second", "https://b.example", true)
            .await
            .unwrap();

        // Making the second one default demotes the first.
        let providers = list_providers(&pool).await.unwrap();
        let defaults: Vec<&str> = providers[0]
            .endpoints
            .iter()
            .filter(|endpoint| endpoint.is_default)
            .map(|endpoint| endpoint.id.as_str())
            .collect();
        assert_eq!(defaults, vec![second.as_str()]);

        // Deleting the default promotes the remaining endpoint rather than
        // leaving the provider without one.
        delete_endpoint(&pool, &second).await.unwrap();
        let providers = list_providers(&pool).await.unwrap();
        assert_eq!(providers[0].endpoints.len(), 1);
        assert_eq!(providers[0].endpoints[0].id, first);
        assert!(providers[0].endpoints[0].is_default);
    }

    #[tokio::test]
    async fn adding_a_model_twice_is_ignored() {
        let pool = test_pool().await;
        let provider_id = create_provider(&pool, "p", LlmProviderKind::Openai)
            .await
            .unwrap();
        let endpoint_id = create_endpoint(&pool, &provider_id, "e", "https://x.example", false)
            .await
            .unwrap();

        let first = add_models(&pool, &endpoint_id, &[model("gpt-4o")])
            .await
            .unwrap();
        let second = add_models(&pool, &endpoint_id, &[model("gpt-4o"), model("o3")])
            .await
            .unwrap();
        assert_eq!(first, 1);
        assert_eq!(second, 1, "only the new model is inserted");

        let stored = stored_model_ids(&pool, &endpoint_id).await.unwrap();
        assert_eq!(stored.len(), 2);
    }

    #[tokio::test]
    async fn an_explicit_series_overrides_the_inferred_one() {
        let pool = test_pool().await;
        let provider_id = create_provider(&pool, "p", LlmProviderKind::Openai)
            .await
            .unwrap();
        let endpoint_id = create_endpoint(&pool, &provider_id, "e", "https://x.example", false)
            .await
            .unwrap();

        add_models(
            &pool,
            &endpoint_id,
            &[AddLlmModelInput {
                model_id: "custom-thing-9".to_string(),
                series: Some("My Series".to_string()),
                display_name: None,
                context_window: None,
                max_output_tokens: None,
            }],
        )
        .await
        .unwrap();

        let providers = list_providers(&pool).await.unwrap();
        assert_eq!(providers[0].endpoints[0].models[0].series, "My Series");
    }

    #[tokio::test]
    async fn only_one_model_is_default_across_providers() {
        let pool = test_pool().await;
        let provider_id = create_provider(&pool, "p", LlmProviderKind::Openai)
            .await
            .unwrap();
        let endpoint_id = create_endpoint(&pool, &provider_id, "e", "https://x.example", false)
            .await
            .unwrap();
        add_models(&pool, &endpoint_id, &[model("gpt-4o"), model("o3")])
            .await
            .unwrap();

        let providers = list_providers(&pool).await.unwrap();
        let ids: Vec<String> = providers[0].endpoints[0]
            .models
            .iter()
            .map(|model| model.id.clone())
            .collect();

        update_model(&pool, &ids[0], None, None, Some(true), None, None)
            .await
            .unwrap();
        update_model(&pool, &ids[1], None, None, Some(true), None, None)
            .await
            .unwrap();

        let providers = list_providers(&pool).await.unwrap();
        let defaults: Vec<&str> = providers[0].endpoints[0]
            .models
            .iter()
            .filter(|model| model.is_default)
            .map(|model| model.id.as_str())
            .collect();
        assert_eq!(defaults, vec![ids[1].as_str()]);
    }

    #[tokio::test]
    async fn deleting_a_provider_removes_its_endpoints_and_models() {
        let pool = test_pool().await;
        let provider_id = create_provider(&pool, "p", LlmProviderKind::Openai)
            .await
            .unwrap();
        let endpoint_id = create_endpoint(&pool, &provider_id, "e", "https://x.example", false)
            .await
            .unwrap();
        add_models(&pool, &endpoint_id, &[model("gpt-4o")])
            .await
            .unwrap();

        // The returned endpoint ids are what the caller needs to clear the
        // matching keychain entries.
        let endpoint_ids = delete_provider(&pool, &provider_id).await.unwrap();
        assert_eq!(endpoint_ids, vec![endpoint_id.clone()]);

        assert!(list_providers(&pool).await.unwrap().is_empty());
        assert!(stored_model_ids(&pool, &endpoint_id)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn endpoint_target_reports_the_providers_kind() {
        let pool = test_pool().await;
        let provider_id = create_provider(&pool, "p", LlmProviderKind::Anthropic)
            .await
            .unwrap();
        let endpoint_id = create_endpoint(&pool, &provider_id, "e", "https://a.example/v1", false)
            .await
            .unwrap();

        let (kind, base_url) = endpoint_target(&pool, &endpoint_id).await.unwrap();
        assert_eq!(kind, LlmProviderKind::Anthropic);
        assert_eq!(base_url, "https://a.example/v1");

        assert!(endpoint_target(&pool, "missing").await.is_err());
    }

    #[tokio::test]
    async fn writes_to_missing_rows_are_rejected() {
        let pool = test_pool().await;
        assert!(update_provider(&pool, "nope", Some("x"), None, None)
            .await
            .is_err());
        assert!(update_model(&pool, "nope", Some("x"), None, None, None, None)
            .await
            .is_err());
        assert!(add_models(&pool, "nope", &[model("gpt-4o")]).await.is_err());
        // Deleting what is not there is not an error — the end state matches.
        assert!(delete_endpoint(&pool, "nope").await.is_ok());
        assert!(delete_model(&pool, "nope").await.is_ok());
    }

    #[tokio::test]
    async fn migrate_is_idempotent() {
        let pool = test_pool().await;
        migrate(&pool).await.expect("second migrate is a no-op");
        assert!(list_providers(&pool).await.is_ok());
    }
}
