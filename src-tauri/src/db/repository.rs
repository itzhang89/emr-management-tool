use crate::db::app_data_dir;
use crate::error::{AppError, AppResult};
use crate::models::{
    AccountTemplateVariable, AccountTemplateVariables, ApplicationTemplate, AwsAccount,
    JobConfigTemplate, JobConfigTemplateScope, JobRunSummary, ResourceTemplate,
};
use chrono::{Duration, Utc};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Executor, Row, Sqlite, SqlitePool};
use std::collections::{BTreeMap, HashSet};
use std::fs;

pub const JOB_HISTORY_RETENTION_DAYS: i64 = 30;
pub const SUBMISSION_HISTORY_LIMIT: i64 = 20;
/// Audit rows older than this many days are pruned on every insert.
pub const MCP_AUDIT_RETENTION_DAYS: i64 = 30;
/// The audit table is additionally capped at this many most-recent rows.
pub const MCP_AUDIT_RETENTION_LIMIT: i64 = 10_000;

fn job_history_cutoff() -> String {
    (Utc::now() - Duration::days(JOB_HISTORY_RETENTION_DAYS)).to_rfc3339()
}

pub async fn pool() -> AppResult<SqlitePool> {
    let dir = app_data_dir()?;
    fs::create_dir_all(&dir).map_err(|error| {
        if crate::distribution::is_portable() {
            AppError::storage(format!(
                "Unable to create portable data directory at {}. Move the app to a writable folder. ({error})",
                dir.display()
            ))
        } else {
            AppError::storage(error.to_string())
        }
    })?;
    let options = SqliteConnectOptions::new()
        .filename(dir.join("emr-management-tool.sqlite"))
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    migrate(&pool).await?;

    Ok(pool)
}

pub async fn list_application_templates(pool: &SqlitePool) -> AppResult<Vec<ApplicationTemplate>> {
    let rows = sqlx::query("select payload from application_templates order by name")
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| from_payload(row.get::<String, _>("payload")))
        .collect()
}

pub async fn upsert_application_template(
    pool: &SqlitePool,
    template: &ApplicationTemplate,
) -> AppResult<()> {
    let payload =
        serde_json::to_string(template).map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query(
        "insert into application_templates (id, name, payload) values (?1, ?2, ?3)
         on conflict(id) do update set name = excluded.name, payload = excluded.payload",
    )
    .bind(&template.id)
    .bind(&template.name)
    .bind(payload)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn list_resource_templates(pool: &SqlitePool) -> AppResult<Vec<ResourceTemplate>> {
    let rows = sqlx::query("select payload from resource_templates order by name")
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| from_payload(row.get::<String, _>("payload")))
        .collect()
}

pub async fn upsert_resource_template(
    pool: &SqlitePool,
    template: &ResourceTemplate,
) -> AppResult<()> {
    let payload =
        serde_json::to_string(template).map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query(
        "insert into resource_templates (id, name, payload) values (?1, ?2, ?3)
         on conflict(id) do update set name = excluded.name, payload = excluded.payload",
    )
    .bind(&template.id)
    .bind(&template.name)
    .bind(payload)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn list_job_config_templates(
    pool: &SqlitePool,
    account_id: &str,
) -> AppResult<Vec<JobConfigTemplate>> {
    let rows = sqlx::query(
        "select account_id, scope, id, payload from job_config_templates
         where scope = 'shared' or (scope = 'private' and account_id = ?1)
         order by name, id",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| {
            let mut template: JobConfigTemplate = from_payload(row.get::<String, _>("payload"))?;
            let shared = row.get::<String, _>("scope") == "shared";
            template.id = row.get("id");
            template.scope = if shared {
                JobConfigTemplateScope::Shared
            } else {
                JobConfigTemplateScope::Private
            };
            template.account_id = (!shared).then(|| row.get("account_id"));
            Ok(template)
        })
        .collect()
}

pub async fn migrate_job_config_templates_to_account(
    pool: &SqlitePool,
    account_id: &str,
) -> AppResult<()> {
    // Older versions left unassigned templates for the first active account.
    sqlx::query(
        "update job_config_templates as legacy
         set account_id = ?1, scope = 'private',
             id = case when exists (
                 select 1 from job_config_templates as existing
                 where existing.id = legacy.id
                   and (existing.scope = 'shared' or (existing.scope = 'private' and existing.account_id = ?1))
             ) then lower(hex(randomblob(16))) else legacy.id end
         where legacy.scope = 'unassigned'
           and exists (select 1 from aws_accounts where id = ?1 and is_active = 1)",
    )
    .bind(account_id)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn seed_job_config_template(
    pool: &SqlitePool,
    account_id: &str,
    template: &JobConfigTemplate,
) -> AppResult<()> {
    let payload = job_config_template_payload(account_id, template)?;
    sqlx::query(
        "insert into job_config_templates (scope, account_id, id, name, payload)
         values ('private', ?1, ?2, ?3, ?4) on conflict(scope, account_id, id) do nothing",
    )
    .bind(account_id)
    .bind(&template.id)
    .bind(&template.name)
    .bind(payload)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn create_job_config_template(
    pool: &SqlitePool,
    account_id: &str,
    template: &JobConfigTemplate,
) -> AppResult<()> {
    insert_job_config_template(pool, account_id, template).await
}

pub async fn import_job_config_template(
    pool: &SqlitePool,
    account_id: &str,
    mut template: JobConfigTemplate,
) -> AppResult<()> {
    template.scope = JobConfigTemplateScope::Private;
    let mut tx = pool
        .begin_with("begin immediate")
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    let names: HashSet<String> = sqlx::query_scalar(
        "select name from job_config_templates
         where scope = 'shared' or (scope = 'private' and account_id = ?1)",
    )
    .bind(account_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .into_iter()
    .collect();
    if names.contains(&template.name) {
        let base = format!("{}_Imported", template.name);
        template.name = base.clone();
        let mut index = 2;
        while names.contains(&template.name) {
            template.name = format!("{base}_{index}");
            index += 1;
        }
    }
    insert_job_config_template(&mut *tx, account_id, &template).await?;
    tx.commit()
        .await
        .map_err(|error| AppError::storage(error.to_string()))
}

async fn insert_job_config_template<'e>(
    executor: impl Executor<'e, Database = Sqlite>,
    account_id: &str,
    template: &JobConfigTemplate,
) -> AppResult<()> {
    let (scope, owner) = template_storage_scope(account_id, template.scope);
    let payload = job_config_template_payload(account_id, template)?;
    let result = sqlx::query(
        "insert into job_config_templates (scope, account_id, id, name, payload)
         select ?1, ?2, ?3, ?4, ?5
         where not exists (
             select 1 from job_config_templates where id = ?3
               and (?1 = 'shared' or scope = 'shared' or (scope = 'private' and account_id = ?2))
         )",
    )
    .bind(scope)
    .bind(owner)
    .bind(&template.id)
    .bind(&template.name)
    .bind(payload)
    .execute(executor)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    if result.rows_affected() == 0 {
        return Err(AppError::validation(
            "A template with this ID already exists.",
        ));
    }
    Ok(())
}

pub async fn update_job_config_template(
    pool: &SqlitePool,
    account_id: &str,
    template: &JobConfigTemplate,
) -> AppResult<()> {
    write_job_config_template(pool, account_id, template).await
}

pub async fn set_job_config_template_scope(
    pool: &SqlitePool,
    account_id: &str,
    id: &str,
    scope: JobConfigTemplateScope,
) -> AppResult<()> {
    let mut tx = pool
        .begin_with("begin immediate")
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    let payload = sqlx::query_scalar(
        "select payload from job_config_templates where id = ?1
         and (scope = 'shared' or (scope = 'private' and account_id = ?2))",
    )
    .bind(id)
    .bind(account_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?
    .ok_or_else(|| AppError::validation("Template was not found."))?;
    let mut template: JobConfigTemplate = from_payload(payload)?;
    template.id = id.to_string();
    template.scope = scope;
    template.updated_at = Utc::now();
    write_job_config_template(&mut *tx, account_id, &template).await?;
    tx.commit()
        .await
        .map_err(|error| AppError::storage(error.to_string()))
}

async fn write_job_config_template<'e>(
    executor: impl Executor<'e, Database = Sqlite>,
    account_id: &str,
    template: &JobConfigTemplate,
) -> AppResult<()> {
    let (scope, owner) = template_storage_scope(account_id, template.scope);
    let payload = job_config_template_payload(account_id, template)?;
    let result = sqlx::query(
        "update job_config_templates as current
         set scope = ?1, account_id = ?2, name = ?3,
             payload = json_set(
                 ?4, '$.builtIn', json(case when json_extract(current.payload, '$.builtIn') then 'true' else 'false' end),
                     '$.createdAt', json_extract(current.payload, '$.createdAt')
             )
         where current.id = ?5
           and (current.scope = 'shared' or (current.scope = 'private' and current.account_id = ?6))
           and (?1 = 'private' or (
               coalesce(json_extract(current.payload, '$.builtIn'), 0) = 0
               and not exists (
                   select 1 from job_config_templates as other
                   where other.id = current.id
                     and (other.scope <> current.scope or other.account_id <> current.account_id)
               )
           ))",
    )
    .bind(scope)
    .bind(owner)
    .bind(&template.name)
    .bind(payload)
    .bind(&template.id)
    .bind(account_id)
    .execute(executor)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    if result.rows_affected() == 0 {
        return Err(AppError::validation(
            "The template is unavailable, or its ID cannot be shared. Refresh or duplicate the template and try again.",
        ));
    }
    Ok(())
}

pub async fn delete_job_config_template(
    pool: &SqlitePool,
    account_id: &str,
    id: &str,
) -> AppResult<()> {
    let result = sqlx::query(
        "delete from job_config_templates where id = ?1
         and (scope = 'shared' or (scope = 'private' and account_id = ?2))
         and coalesce(json_extract(payload, '$.builtIn'), 0) = 0",
    )
    .bind(id)
    .bind(account_id)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    if result.rows_affected() == 0 {
        return Err(AppError::validation(
            "The template is unavailable or is a built-in template.",
        ));
    }
    Ok(())
}

fn template_storage_scope(account_id: &str, scope: JobConfigTemplateScope) -> (&'static str, &str) {
    match scope {
        JobConfigTemplateScope::Private => ("private", account_id),
        JobConfigTemplateScope::Shared => ("shared", ""),
    }
}

fn job_config_template_payload(
    account_id: &str,
    template: &JobConfigTemplate,
) -> AppResult<String> {
    let mut stored = template.clone();
    stored.account_id =
        (template.scope == JobConfigTemplateScope::Private).then(|| account_id.to_string());
    serde_json::to_string(&stored).map_err(|error| AppError::storage(error.to_string()))
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum StoredAccountTemplateVariable {
    Current(AccountTemplateVariable),
    Legacy(String),
}

pub async fn list_account_template_variables(
    pool: &SqlitePool,
    account_id: &str,
) -> AppResult<AccountTemplateVariables> {
    let payload: Option<String> =
        sqlx::query_scalar("select payload from account_template_variables where account_id = ?1")
            .bind(account_id)
            .fetch_optional(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    let Some(payload) = payload else {
        return Ok(AccountTemplateVariables::new());
    };
    let variables = from_payload::<BTreeMap<String, StoredAccountTemplateVariable>>(payload)?;
    Ok(variables
        .into_iter()
        .map(|(name, stored)| {
            let variable = match stored {
                StoredAccountTemplateVariable::Current(variable) => variable,
                StoredAccountTemplateVariable::Legacy(value) => AccountTemplateVariable {
                    value,
                    description: None,
                },
            };
            (name, variable)
        })
        .collect())
}

pub async fn save_account_template_variables(
    pool: &SqlitePool,
    account_id: &str,
    variables: &AccountTemplateVariables,
) -> AppResult<()> {
    let payload =
        serde_json::to_string(variables).map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query(
        "insert into account_template_variables (account_id, payload) values (?1, ?2)
         on conflict(account_id) do update set payload = excluded.payload",
    )
    .bind(account_id)
    .bind(payload)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn delete_template(pool: &SqlitePool, table: &str, id: &str) -> AppResult<()> {
    if table == "resource" {
        let templates = list_resource_templates(pool).await?;
        if templates
            .iter()
            .any(|template| template.id == id && template.built_in)
        {
            return Err(AppError::validation(
                "Built-in resource templates cannot be deleted.",
            ));
        }
    }

    let query = match table {
        "application" => "delete from application_templates where id = ?1",
        "resource" => "delete from resource_templates where id = ?1",
        _ => return Err(AppError::validation("Unsupported template type.")),
    };
    let result = sqlx::query(query)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    if result.rows_affected() == 0 {
        return Err(AppError::validation("Template was not found."));
    }
    Ok(())
}

pub async fn list_job_history(
    pool: &SqlitePool,
    account_id: Option<&str>,
    virtual_cluster_id: Option<&str>,
    keyword: Option<&str>,
) -> AppResult<Vec<JobRunSummary>> {
    let cutoff = job_history_cutoff();
    let keyword = keyword.map(str::trim).filter(|value| !value.is_empty());
    let keyword_pattern = keyword.map(|value| format!("%{}%", value.to_lowercase()));
    let rows = sqlx::query(
        "select payload from job_history
         where (?1 is null or account_id = ?1)
           and (?2 is null or virtual_cluster_id = ?2)
           and created_at >= ?3
           and (
             ?4 is null
             or lower(id) like ?4
             or lower(json_extract(payload, '$.name')) like ?4
             or lower(json_extract(payload, '$.state')) like ?4
           )
         order by created_at desc",
    )
    .bind(account_id)
    .bind(virtual_cluster_id)
    .bind(cutoff)
    .bind(keyword_pattern)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| from_payload(row.get::<String, _>("payload")))
        .collect()
}

/// Earliest `created_at` among jobs that are not COMPLETED/FAILED, within retention.
/// Timestamps are stored/compared as RFC3339 (UTC offset preserved); callers should
/// convert with timezone-aware parsers before talking to AWS.
pub async fn earliest_non_terminal_created_at(
    pool: &SqlitePool,
    account_id: &str,
    virtual_cluster_id: &str,
) -> AppResult<Option<String>> {
    let cutoff = job_history_cutoff();
    let row = sqlx::query(
        "select min(created_at) as earliest
         from job_history
         where account_id = ?1
           and virtual_cluster_id = ?2
           and created_at >= ?3
           and lower(coalesce(json_extract(payload, '$.state'), '')) not in ('completed', 'failed')",
    )
    .bind(account_id)
    .bind(virtual_cluster_id)
    .bind(cutoff)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(row.and_then(|row| row.get::<Option<String>, _>("earliest")))
}

pub async fn list_submission_history(
    pool: &SqlitePool,
    account_id: Option<&str>,
    virtual_cluster_id: Option<&str>,
    limit: i64,
) -> AppResult<Vec<JobRunSummary>> {
    let cutoff = job_history_cutoff();
    let rows = sqlx::query(
        "select payload from job_history
         where (?1 is null or account_id = ?1)
           and (?2 is null or virtual_cluster_id = ?2)
           and created_at >= ?3
           and json_extract(payload, '$.sourceRequest') is not null
         order by created_at desc
         limit ?4",
    )
    .bind(account_id)
    .bind(virtual_cluster_id)
    .bind(cutoff)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| from_payload(row.get::<String, _>("payload")))
        .collect()
}

pub async fn get_job_history(pool: &SqlitePool, id: &str) -> AppResult<Option<JobRunSummary>> {
    let row = sqlx::query("select payload from job_history where id = ?1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    row.map(|row| from_payload(row.get::<String, _>("payload")))
        .transpose()
}

/// Write one MCP tool invocation to the audit table, then prune entries older
/// than the retention window. Both transports record through the shared
/// [`crate::mcp::audit`] helper — the Streamable HTTP server after each external
/// call, the Chat loop after each in-process call (which also supplies the
/// driving provider/model). The Audit Log tab reads from the same table.
pub async fn insert_mcp_audit_entry(
    pool: &SqlitePool,
    entry: &crate::models::McpAuditEntry,
) -> AppResult<()> {
    let args_json =
        serde_json::to_string(&entry.args).map_err(|e| AppError::storage(e.to_string()))?;
    let result_json =
        serde_json::to_string(&entry.result).map_err(|e| AppError::storage(e.to_string()))?;
    sqlx::query(
        "insert into mcp_audit (id, timestamp, status, tool, client, duration_ms, args_json, result_json, error, provider_id, model_id)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         on conflict(id) do nothing",
    )
    .bind(&entry.id)
    .bind(&entry.timestamp)
    .bind(&entry.status)
    .bind(&entry.tool)
    .bind(&entry.client)
    .bind(entry.duration_ms)
    .bind(args_json)
    .bind(result_json)
    .bind(&entry.error)
    .bind(&entry.provider_id)
    .bind(&entry.model_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::storage(e.to_string()))?;

    prune_mcp_audit(pool).await
}

/// Cap the audit table at both bounds: drop rows older than the retention
/// window, and drop anything beyond the most recent [`MCP_AUDIT_RETENTION_LIMIT`]
/// rows. Time keeps old-but-recent chatter from piling up forever; the count cap
/// keeps a burst (say, a busy Chat session) from ballooning the table between
/// day boundaries.
async fn prune_mcp_audit(pool: &SqlitePool) -> AppResult<()> {
    let cutoff = (Utc::now() - Duration::days(MCP_AUDIT_RETENTION_DAYS)).to_rfc3339();
    sqlx::query("delete from mcp_audit where timestamp < ?1")
        .bind(cutoff)
        .execute(pool)
        .await
        .map_err(|e| AppError::storage(e.to_string()))?;

    // timestamp desc is not unique (tools can finish in the same millisecond),
    // so id breaks ties for a deterministic keep-set.
    sqlx::query(
        "delete from mcp_audit
         where id not in (
             select id from mcp_audit order by timestamp desc, id desc limit ?1
         )",
    )
    .bind(MCP_AUDIT_RETENTION_LIMIT)
    .execute(pool)
    .await
    .map_err(|e| AppError::storage(e.to_string()))?;

    Ok(())
}

pub async fn prune_job_history(pool: &SqlitePool, account_id: Option<&str>) -> AppResult<()> {
    let cutoff = job_history_cutoff();
    sqlx::query(
        "delete from job_history
         where (?1 is null or account_id = ?1)
           and created_at < ?2",
    )
    .bind(account_id)
    .bind(cutoff)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    prune_submission_history(pool, account_id).await
}

pub async fn prune_submission_history(
    pool: &SqlitePool,
    account_id: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        "delete from job_history
         where (?1 is null or account_id = ?1)
           and json_extract(payload, '$.sourceRequest') is not null
           and id not in (
             select id from job_history
             where (?1 is null or account_id = ?1)
               and json_extract(payload, '$.sourceRequest') is not null
             order by created_at desc
             limit ?2
           )",
    )
    .bind(account_id)
    .bind(SUBMISSION_HISTORY_LIMIT)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn upsert_job_history(pool: &SqlitePool, job: &JobRunSummary) -> AppResult<()> {
    let mut job = job.clone();
    if job.source_request.is_none() {
        if let Some(existing) = get_job_history(pool, &job.id).await? {
            job.source_request = existing.source_request;
        }
    }
    let payload =
        serde_json::to_string(&job).map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query(
        "insert into job_history (id, account_id, region, virtual_cluster_id, created_at, payload) values (?1, ?2, ?3, ?4, ?5, ?6)
         on conflict(id) do update set account_id = excluded.account_id, region = excluded.region, virtual_cluster_id = excluded.virtual_cluster_id, created_at = excluded.created_at, payload = excluded.payload",
    )
    .bind(&job.id)
    .bind(&job.account_id)
    .bind(&job.region)
    .bind(&job.virtual_cluster_id)
    .bind(&job.created_at)
    .bind(payload)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn list_aws_accounts(pool: &SqlitePool) -> AppResult<Vec<AwsAccount>> {
    let rows = sqlx::query("select payload from aws_accounts order by name")
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| from_payload(row.get::<String, _>("payload")))
        .collect()
}

pub async fn get_aws_account(pool: &SqlitePool, id: &str) -> AppResult<Option<AwsAccount>> {
    let row = sqlx::query("select payload from aws_accounts where id = ?1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    row.map(|row| from_payload(row.get::<String, _>("payload")))
        .transpose()
}

pub async fn upsert_aws_account(pool: &SqlitePool, account: &AwsAccount) -> AppResult<()> {
    let payload =
        serde_json::to_string(account).map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query(
        "insert into aws_accounts (id, name, region, is_active, payload) values (?1, ?2, ?3, ?4, ?5)
         on conflict(id) do update set name = excluded.name, region = excluded.region, is_active = excluded.is_active, payload = excluded.payload",
    )
    .bind(&account.id)
    .bind(&account.name)
    .bind(&account.region)
    .bind(account.is_active)
    .bind(payload)
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn delete_aws_account(pool: &SqlitePool, id: &str) -> AppResult<()> {
    sqlx::query("delete from aws_accounts where id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn set_active_aws_account(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let mut accounts = list_aws_accounts(pool).await?;
    let mut found = false;
    for account in &mut accounts {
        account.is_active = account.id == id;
        found |= account.is_active;
        upsert_aws_account(pool, account).await?;
    }

    if found {
        Ok(())
    } else {
        Err(AppError::validation(format!(
            "AWS account {id} was not found."
        )))
    }
}

pub async fn active_aws_account(pool: &SqlitePool) -> AppResult<Option<AwsAccount>> {
    Ok(list_aws_accounts(pool)
        .await?
        .into_iter()
        .find(|account| account.is_active))
}

async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    for statement in [
        "create table if not exists application_templates (id text primary key, name text not null, payload text not null)",
        "create table if not exists resource_templates (id text primary key, name text not null, payload text not null)",
        "create table if not exists job_history (id text primary key, account_id text, region text, virtual_cluster_id text, created_at text not null, payload text not null)",
        "create table if not exists aws_accounts (id text primary key, name text not null, region text not null, is_active integer not null default 0, payload text not null)",
        "create table if not exists mcp_audit (id text primary key, timestamp text not null, status text not null, tool text not null, client text, duration_ms integer not null, args_json text not null default '{}', result_json text not null default '{}', error text, provider_id text, model_id text)",
        JOB_CONFIG_TEMPLATES_SCHEMA,
        "create table if not exists account_template_variables (
            account_id text primary key references aws_accounts(id) on delete cascade,
            payload text not null
        )",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }

    migrate_legacy_job_config_templates(pool).await?;
    crate::db::llm::migrate(pool).await?;
    crate::db::chat::migrate(pool).await?;
    crate::db::redact::migrate(pool).await?;
    crate::db::dbhub::migrate(pool).await?;
    crate::db::runbooks::migrate(pool).await?;

    Ok(())
}

const JOB_CONFIG_TEMPLATES_SCHEMA: &str = "create table if not exists job_config_templates (
    scope text not null check (scope in ('private', 'shared', 'unassigned')),
    account_id text not null,
    id text not null,
    name text not null,
    payload text not null,
    primary key (scope, account_id, id),
    check (scope = 'private' or account_id = '')
)";

async fn migrate_legacy_job_config_templates(pool: &SqlitePool) -> AppResult<()> {
    const LAYOUT: &str = "select case
        when exists (select 1 from pragma_table_info('job_config_templates') where name = 'scope') then 'scoped'
        when exists (select 1 from pragma_table_info('job_config_templates') where name = 'account_id') then 'account'
        else 'unscoped'
    end";
    let layout: String = sqlx::query_scalar(LAYOUT)
        .fetch_one(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    if layout == "scoped" {
        return Ok(());
    }

    let mut tx = pool
        .begin_with("begin immediate")
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    let layout: String = sqlx::query_scalar(LAYOUT)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    let copy = match layout.as_str() {
        "account" => {
            "insert into job_config_templates (scope, account_id, id, name, payload)
            select case when owner is null then 'unassigned' else 'private' end,
                   coalesce(owner, ''), id, name, payload
            from (
                select case when account_id = 'legacy'
                             and not exists (select 1 from aws_accounts where id = 'legacy')
                           then null else account_id end as owner, id, name, payload
                from job_config_templates_legacy
            )"
        }
        "unscoped" => {
            "insert into job_config_templates (scope, account_id, id, name, payload)
            select case when owner is null then 'unassigned' else 'private' end,
                   coalesce(owner, ''), id, name, payload
            from (
                select nullif(json_extract(payload, '$.accountId'), '') as owner, id, name, payload
                from job_config_templates_legacy
            )"
        }
        _ => return Ok(()),
    };
    for statement in [
        "alter table job_config_templates rename to job_config_templates_legacy",
        JOB_CONFIG_TEMPLATES_SCHEMA,
        copy,
        "drop table job_config_templates_legacy",
    ] {
        sqlx::query(statement)
            .execute(&mut *tx)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }
    tx.commit()
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

fn from_payload<T: serde::de::DeserializeOwned>(payload: String) -> AppResult<T> {
    serde_json::from_str(&payload).map_err(|error| AppError::storage(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        earliest_non_terminal_created_at, list_job_history, list_submission_history, migrate,
        prune_submission_history, upsert_job_history,
    };
    use crate::models::{
        JarApplicationConfig, JobDriverRequest, JobRunSummary, SparkResourceConfig,
        SparkSubmitJobDriverRequest, StartJobRunRequest,
    };
    use chrono::{Duration, Utc};
    use sqlx::sqlite::SqlitePoolOptions;
    use std::collections::HashMap;

    #[tokio::test]
    async fn imports_keep_the_original_name_until_it_conflicts_with_a_visible_template() {
        use super::{
            create_job_config_template, import_job_config_template, list_job_config_templates,
            seed_job_config_template, JobConfigTemplateScope,
        };

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();

        let mut template = crate::state::default_job_config_templates().remove(0);
        seed_job_config_template(&pool, "acct-a", &template)
            .await
            .unwrap();
        template.built_in = false;
        template.name = "Daily ETL".into();
        template.id = "private-in-b".into();
        create_job_config_template(&pool, "acct-b", &template)
            .await
            .unwrap();
        template.id = "shared-in-b".into();
        template.name = "Shared job".into();
        template.scope = JobConfigTemplateScope::Shared;
        create_job_config_template(&pool, "acct-b", &template)
            .await
            .unwrap();

        for (id, name) in [
            ("new", "Daily ETL"),
            ("duplicate", "Daily ETL"),
            ("repeated", "Daily ETL"),
            ("built-in", "example"),
            ("shared-name", "Shared job"),
        ] {
            template.id = id.into();
            template.name = name.into();
            import_job_config_template(&pool, "acct-a", template.clone())
                .await
                .unwrap();
        }

        let templates = list_job_config_templates(&pool, "acct-a").await.unwrap();
        for (id, expected) in [
            ("new", "Daily ETL"),
            ("duplicate", "Daily ETL_Imported"),
            ("repeated", "Daily ETL_Imported_2"),
            ("built-in", "example_Imported"),
            ("shared-name", "Shared job_Imported"),
        ] {
            let imported = templates.iter().find(|template| template.id == id).unwrap();
            assert_eq!(imported.name, expected);
            assert_eq!(imported.scope, JobConfigTemplateScope::Private);
        }
    }

    #[tokio::test]
    async fn shared_job_config_moves_between_scopes_without_copying() {
        use super::{
            create_job_config_template, delete_job_config_template, list_job_config_templates,
            set_job_config_template_scope, update_job_config_template, JobConfigTemplateScope,
        };

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();

        let mut template = crate::state::default_job_config_templates().remove(0);
        template.id = "custom".into();
        template.built_in = false;
        create_job_config_template(&pool, "acct-a", &template)
            .await
            .unwrap();
        assert_eq!(
            list_job_config_templates(&pool, "acct-a")
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(list_job_config_templates(&pool, "acct-b")
            .await
            .unwrap()
            .is_empty());

        set_job_config_template_scope(
            &pool,
            "acct-a",
            &template.id,
            JobConfigTemplateScope::Shared,
        )
        .await
        .unwrap();
        let mut shared = list_job_config_templates(&pool, "acct-b")
            .await
            .unwrap()
            .remove(0);
        assert_eq!(shared.id, template.id);
        assert_eq!(shared.scope, JobConfigTemplateScope::Shared);
        assert_eq!(shared.account_id, None);
        assert_eq!(shared.created_at, template.created_at);

        shared.name = "Edited from B".into();
        update_job_config_template(&pool, "acct-b", &shared)
            .await
            .unwrap();
        assert_eq!(
            list_job_config_templates(&pool, "acct-a").await.unwrap()[0].name,
            shared.name
        );
        assert_eq!(
            list_job_config_templates(&pool, "new-account")
                .await
                .unwrap()[0]
                .name,
            shared.name
        );

        set_job_config_template_scope(&pool, "acct-b", &shared.id, JobConfigTemplateScope::Private)
            .await
            .unwrap();
        assert!(list_job_config_templates(&pool, "acct-a")
            .await
            .unwrap()
            .is_empty());
        let private = list_job_config_templates(&pool, "acct-b")
            .await
            .unwrap()
            .remove(0);
        assert_eq!(private.id, template.id);
        assert_eq!(private.name, "Edited from B");
        assert_eq!(private.account_id.as_deref(), Some("acct-b"));
        assert!(delete_job_config_template(&pool, "acct-a", &private.id)
            .await
            .is_err());

        shared.scope = JobConfigTemplateScope::Shared;
        update_job_config_template(&pool, "acct-b", &shared)
            .await
            .unwrap();
        delete_job_config_template(&pool, "acct-a", &shared.id)
            .await
            .unwrap();
        assert!(list_job_config_templates(&pool, "acct-b")
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn legacy_job_config_keeps_its_original_account() {
        use super::{list_job_config_templates, JobConfigTemplateScope};

        let mut template = crate::state::default_job_config_templates().remove(0);
        template.id = "legacy-custom".into();
        template.built_in = false;
        template.account_id = Some("acct-a".into());
        let mut payload = serde_json::to_value(&template).unwrap();
        payload.as_object_mut().unwrap().remove("scope");

        for (schema, insert) in [
            (
                "create table job_config_templates (id text primary key, name text not null, payload text not null)",
                "insert into job_config_templates values (?1, ?2, ?3)",
            ),
            (
                "create table job_config_templates (
                    account_id text not null, id text not null, name text not null, payload text not null,
                    primary key (account_id, id)
                )",
                "insert into job_config_templates values ('acct-a', ?1, ?2, ?3)",
            ),
        ] {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::query(schema).execute(&pool).await.unwrap();
            sqlx::query(insert)
                .bind(&template.id)
                .bind(&template.name)
                .bind(payload.to_string())
                .execute(&pool)
                .await
                .unwrap();

            migrate(&pool).await.unwrap();
            migrate(&pool).await.unwrap();

            let migrated = list_job_config_templates(&pool, "acct-a").await.unwrap().remove(0);
            assert_eq!(migrated.id, template.id);
            assert_eq!(migrated.scope, JobConfigTemplateScope::Private);
            assert_eq!(migrated.account_id, template.account_id);
            assert_eq!(migrated.payload_template, template.payload_template);
            assert!(list_job_config_templates(&pool, "acct-b").await.unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn account_template_variable_values_are_isolated() {
        use super::{
            delete_aws_account, list_account_template_variables, save_account_template_variables,
        };

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        for account in ["acct-a", "acct-b"] {
            sqlx::query("insert into aws_accounts (id, name, region, payload) values (?1, ?1, 'us-east-1', '{}')")
                .bind(account)
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query("insert into account_template_variables (account_id, payload) values ('acct-a', ?1)")
            .bind(r#"{"ENV":"dev"}"#)
            .execute(&pool)
            .await
            .unwrap();
        save_account_template_variables(
            &pool,
            "acct-b",
            &[(
                "ENV".into(),
                crate::models::AccountTemplateVariable {
                    value: "prod".into(),
                    description: Some("Production environment".into()),
                },
            )]
            .into(),
        )
        .await
        .unwrap();

        let legacy = list_account_template_variables(&pool, "acct-a").await.unwrap();
        assert_eq!(legacy["ENV"].value, "dev");
        assert_eq!(legacy["ENV"].description, None);
        assert_eq!(
            list_account_template_variables(&pool, "acct-b")
                .await
                .unwrap()["ENV"].description.as_deref(),
            Some("Production environment")
        );
        delete_aws_account(&pool, "acct-a").await.unwrap();
        assert!(list_account_template_variables(&pool, "acct-a")
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            list_account_template_variables(&pool, "acct-b")
                .await
                .unwrap()["ENV"].value,
            "prod"
        );
    }

    #[tokio::test]
    async fn list_job_history_filters_by_keyword_in_cached_payload() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        migrate(&pool).await.expect("migrate schema");

        upsert_job_history(
            &pool,
            &job(
                "job-running",
                "daily-etl",
                "RUNNING",
                "acct-1",
                "vc-1",
                &Utc::now().to_rfc3339(),
            ),
        )
        .await
        .expect("insert running job");
        upsert_job_history(
            &pool,
            &job(
                "job-failed",
                "batch-etl",
                "FAILED",
                "acct-1",
                "vc-1",
                &Utc::now().to_rfc3339(),
            ),
        )
        .await
        .expect("insert failed job");
        upsert_job_history(
            &pool,
            &job(
                "job-other",
                "failed-other-cluster",
                "FAILED",
                "acct-1",
                "vc-2",
                &Utc::now().to_rfc3339(),
            ),
        )
        .await
        .expect("insert other cluster job");

        let by_state = list_job_history(&pool, Some("acct-1"), Some("vc-1"), Some("failed"))
            .await
            .expect("search failed jobs");
        let by_name = list_job_history(&pool, Some("acct-1"), Some("vc-1"), Some("daily"))
            .await
            .expect("search by name");
        let by_id = list_job_history(&pool, Some("acct-1"), Some("vc-1"), Some("job-running"))
            .await
            .expect("search by id");

        assert_eq!(
            by_state
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["job-failed"]
        );
        assert_eq!(
            by_name
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["job-running"]
        );
        assert_eq!(
            by_id.iter().map(|job| job.id.as_str()).collect::<Vec<_>>(),
            vec!["job-running"]
        );

        // "running" must not match COMPLETED jobs just because the word appears in payload JSON.
        upsert_job_history(
            &pool,
            &job(
                "job-completed",
                "nightly-etl",
                "COMPLETED",
                "acct-1",
                "vc-1",
                &Utc::now().to_rfc3339(),
            ),
        )
        .await
        .expect("insert completed job");
        let by_running = list_job_history(&pool, Some("acct-1"), Some("vc-1"), Some("running"))
            .await
            .expect("search running");
        assert_eq!(
            by_running
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["job-running"]
        );
    }

    #[tokio::test]
    async fn earliest_non_terminal_created_at_ignores_completed_and_failed() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        migrate(&pool).await.expect("migrate schema");

        let oldest_running = (Utc::now() - Duration::days(5)).to_rfc3339();
        let newer_pending = (Utc::now() - Duration::days(1)).to_rfc3339();
        let old_failed = (Utc::now() - Duration::days(6)).to_rfc3339();

        upsert_job_history(
            &pool,
            &job(
                "job-failed",
                "batch",
                "FAILED",
                "acct-1",
                "vc-1",
                &old_failed,
            ),
        )
        .await
        .expect("insert failed");
        upsert_job_history(
            &pool,
            &job(
                "job-running",
                "batch",
                "RUNNING",
                "acct-1",
                "vc-1",
                &oldest_running,
            ),
        )
        .await
        .expect("insert running");
        upsert_job_history(
            &pool,
            &job(
                "job-pending",
                "batch",
                "PENDING",
                "acct-1",
                "vc-1",
                &newer_pending,
            ),
        )
        .await
        .expect("insert pending");

        let earliest = earliest_non_terminal_created_at(&pool, "acct-1", "vc-1")
            .await
            .expect("query earliest")
            .expect("expected earliest non-terminal");
        assert_eq!(earliest, oldest_running);
    }

    #[tokio::test]
    async fn prune_submission_history_keeps_only_recent_submissions() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        migrate(&pool).await.expect("migrate schema");

        for index in 0..7 {
            let created_at = (Utc::now() - Duration::days(6 - index as i64)).to_rfc3339();
            upsert_job_history(
                &pool,
                &submitted_job(&format!("job-{index}"), &created_at, "acct-1", "vc-1"),
            )
            .await
            .expect("insert submitted job");
        }
        upsert_job_history(
            &pool,
            &job(
                "job-synced",
                "synced-etl",
                "RUNNING",
                "acct-1",
                "vc-1",
                &Utc::now().to_rfc3339(),
            ),
        )
        .await
        .expect("insert synced job");

        prune_submission_history(&pool, Some("acct-1"))
            .await
            .expect("prune submissions");

        let remaining = list_job_history(&pool, Some("acct-1"), Some("vc-1"), None)
            .await
            .expect("list remaining jobs");
        let submitted = remaining
            .iter()
            .filter(|job| job.source_request.is_some())
            .map(|job| job.id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            submitted,
            vec!["job-6", "job-5", "job-4", "job-3", "job-2", "job-1", "job-0"]
        );
        assert!(remaining.iter().any(|job| job.id == "job-synced"));
    }

    #[tokio::test]
    async fn list_submission_history_returns_only_app_submitted_jobs() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        migrate(&pool).await.expect("migrate schema");

        upsert_job_history(
            &pool,
            &submitted_job("job-submitted", &Utc::now().to_rfc3339(), "acct-1", "vc-1"),
        )
        .await
        .expect("insert submitted job");
        upsert_job_history(
            &pool,
            &job(
                "job-synced",
                "synced-etl",
                "RUNNING",
                "acct-1",
                "vc-1",
                &Utc::now().to_rfc3339(),
            ),
        )
        .await
        .expect("insert synced job");

        let submissions = list_submission_history(&pool, Some("acct-1"), Some("vc-1"), 20)
            .await
            .expect("list submissions");

        assert_eq!(submissions.len(), 1);
        assert_eq!(submissions[0].id, "job-submitted");
    }

    fn submitted_job(
        id: &str,
        created_at: &str,
        account_id: &str,
        virtual_cluster_id: &str,
    ) -> JobRunSummary {
        JobRunSummary {
            id: id.to_string(),
            name: id.to_string(),
            state: "SUBMITTED".to_string(),
            account_id: Some(account_id.to_string()),
            region: Some("us-east-1".to_string()),
            virtual_cluster_id: virtual_cluster_id.to_string(),
            virtual_cluster_name: None,
            created_at: created_at.to_string(),
            started_at: None,
            finished_at: None,
            duration_seconds: None,
            source_request: Some(StartJobRunRequest {
                account_id: Some(account_id.to_string()),
                name: id.to_string(),
                virtual_cluster_id: virtual_cluster_id.to_string(),
                execution_role_arn: "arn:aws:iam::123456789012:role/EMR".to_string(),
                release_label: "emr-7.2.0-latest".to_string(),
                application: JarApplicationConfig {
                    r#type: "jar".to_string(),
                    jar_path: "s3://bucket/app.jar".to_string(),
                    main_class: "com.example.Main".to_string(),
                },
                arguments: vec![],
                resources: SparkResourceConfig {
                    driver_cores: 1,
                    driver_memory: "1G".to_string(),
                    executor_cores: 1,
                    executor_memory: "1G".to_string(),
                    executor_instances: 1,
                },
                spark_config: HashMap::new(),
                job_driver: JobDriverRequest {
                    spark_submit_job_driver: SparkSubmitJobDriverRequest {
                        entry_point: "s3://bucket/app.jar".to_string(),
                        entry_point_arguments: vec![],
                        spark_submit_parameters: String::new(),
                    },
                },
                configuration_overrides: None,
                template_name: None,
            }),
            describe_details: None,
        }
    }

    fn job(
        id: &str,
        name: &str,
        state: &str,
        account_id: &str,
        virtual_cluster_id: &str,
        created_at: &str,
    ) -> JobRunSummary {
        JobRunSummary {
            id: id.to_string(),
            name: name.to_string(),
            state: state.to_string(),
            account_id: Some(account_id.to_string()),
            region: Some("us-east-1".to_string()),
            virtual_cluster_id: virtual_cluster_id.to_string(),
            virtual_cluster_name: None,
            created_at: created_at.to_string(),
            started_at: None,
            finished_at: None,
            duration_seconds: None,
            source_request: None,
            describe_details: None,
        }
    }
}
