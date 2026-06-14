use crate::db::app_data_dir;
use crate::error::{AppError, AppResult};
use crate::models::{ApplicationTemplate, AwsAccount, JobConfigTemplate, JobRunSummary, ResourceTemplate};
use chrono::{Duration, Utc};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::fs;

pub const JOB_HISTORY_RETENTION_DAYS: i64 = 7;

fn job_history_cutoff() -> String {
    (Utc::now() - Duration::days(JOB_HISTORY_RETENTION_DAYS)).to_rfc3339()
}

pub async fn pool() -> AppResult<SqlitePool> {
    let dir = app_data_dir()?;
    fs::create_dir_all(&dir).map_err(|error| AppError::storage(error.to_string()))?;
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
        "select payload from job_config_templates where account_id = ?1 order by name",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| from_payload(row.get::<String, _>("payload")))
        .collect()
}

pub async fn migrate_job_config_templates_to_account(
    pool: &SqlitePool,
    account_id: &str,
) -> AppResult<()> {
    sqlx::query(
        "update job_config_templates set account_id = ?1 where account_id is null or account_id = 'legacy'",
    )
        .bind(account_id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn upsert_job_config_template(
    pool: &SqlitePool,
    account_id: &str,
    template: &JobConfigTemplate,
) -> AppResult<()> {
    let mut stored = template.clone();
    stored.account_id = Some(account_id.to_string());
    let payload =
        serde_json::to_string(&stored).map_err(|error| AppError::storage(error.to_string()))?;
    sqlx::query(
        "insert into job_config_templates (account_id, id, name, payload) values (?1, ?2, ?3, ?4)
         on conflict(account_id, id) do update set name = excluded.name, payload = excluded.payload",
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

pub async fn delete_template(
    pool: &SqlitePool,
    table: &str,
    account_id: Option<&str>,
    id: &str,
) -> AppResult<()> {
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
        "jobConfig" => {
            if let Some(_account_id) = account_id {
                "delete from job_config_templates where account_id = ?1 and id = ?2 and json_extract(payload, '$.builtIn') = 0"
            } else {
                "delete from job_config_templates where id = ?1 and json_extract(payload, '$.builtIn') = 0"
            }
        }
        _ => return Err(AppError::validation("Unsupported template type.")),
    };
    let result = if table == "jobConfig" {
        if let Some(account_id) = account_id {
            sqlx::query(query)
                .bind(account_id)
                .bind(id)
                .execute(pool)
                .await
                .map_err(|error| AppError::storage(error.to_string()))?
        } else {
            sqlx::query(query)
                .bind(id)
                .execute(pool)
                .await
                .map_err(|error| AppError::storage(error.to_string()))?
        }
    } else {
        sqlx::query(query)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?
    };
    if result.rows_affected() == 0 {
        if table == "jobConfig" {
            let templates = if let Some(account_id) = account_id {
                list_job_config_templates(pool, account_id).await?
            } else {
                Vec::new()
            };
            if templates.iter().any(|template| template.id == id && template.built_in) {
                return Err(AppError::validation(
                    "Built-in job config templates cannot be deleted.",
                ));
            }
        }
        return Err(AppError::validation("Template was not found."));
    }
    Ok(())
}

pub async fn list_job_history(
    pool: &SqlitePool,
    account_id: Option<&str>,
    virtual_cluster_id: Option<&str>,
) -> AppResult<Vec<JobRunSummary>> {
    let cutoff = job_history_cutoff();
    let rows = sqlx::query(
        "select payload from job_history
         where (?1 is null or account_id = ?1)
           and (?2 is null or virtual_cluster_id = ?2)
           and created_at >= ?3
         order by created_at desc",
    )
    .bind(account_id)
    .bind(virtual_cluster_id)
    .bind(cutoff)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| from_payload(row.get::<String, _>("payload")))
        .collect()
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
    Ok(())
}

pub async fn upsert_job_history(pool: &SqlitePool, job: &JobRunSummary) -> AppResult<()> {
    let payload =
        serde_json::to_string(job).map_err(|error| AppError::storage(error.to_string()))?;
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
        "create table if not exists job_history (id text primary key, created_at text not null, payload text not null)",
        "create table if not exists aws_accounts (id text primary key, name text not null, region text not null, is_active integer not null default 0, payload text not null)",
        "alter table job_history add column account_id text",
        "alter table job_history add column region text",
        "alter table job_history add column virtual_cluster_id text",
    ] {
        if let Err(error) = sqlx::query(statement).execute(pool).await {
            if !error.to_string().contains("duplicate column name") {
                return Err(AppError::storage(error.to_string()));
            }
        }
    }

    migrate_job_config_templates_table(pool).await?;

    Ok(())
}

async fn table_create_sql_for(pool: &SqlitePool, table_name: &str) -> AppResult<Option<String>> {
    let row = sqlx::query("select sql from sqlite_master where type = 'table' and name = ?1")
        .bind(table_name)
        .fetch_optional(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(row.and_then(|row| row.get::<Option<String>, _>("sql")))
}

fn has_composite_account_id_primary_key(sql: &str) -> bool {
    sql.contains("primary key (account_id, id)")
}

async fn create_job_config_templates_table(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query(
        "create table if not exists job_config_templates (
            account_id text not null default 'legacy',
            id text not null,
            name text not null,
            payload text not null,
            primary key (account_id, id)
        )",
    )
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

async fn migrate_job_config_templates_table(pool: &SqlitePool) -> AppResult<()> {
    let main_sql = table_create_sql_for(pool, "job_config_templates").await?;
    if main_sql
        .as_deref()
        .is_some_and(has_composite_account_id_primary_key)
    {
        let _ = sqlx::query("drop table if exists job_config_templates_v2")
            .execute(pool)
            .await;
        return Ok(());
    }

    let v2_sql = table_create_sql_for(pool, "job_config_templates_v2").await?;
    if v2_sql
        .as_deref()
        .is_some_and(has_composite_account_id_primary_key)
    {
        if main_sql.is_some()
            && !main_sql
                .as_deref()
                .is_some_and(has_composite_account_id_primary_key)
        {
            sqlx::query(
                "insert or ignore into job_config_templates_v2 (account_id, id, name, payload)
                 select coalesce(account_id, 'legacy'), id, name, payload from job_config_templates",
            )
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
        }

        sqlx::query("drop table if exists job_config_templates")
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
        sqlx::query("alter table job_config_templates_v2 rename to job_config_templates")
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
        return Ok(());
    }

    if main_sql.is_none() {
        return create_job_config_templates_table(pool).await;
    }

    sqlx::query(
        "create table job_config_templates_v2 (
            account_id text not null default 'legacy',
            id text not null,
            name text not null,
            payload text not null,
            primary key (account_id, id)
        )",
    )
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    sqlx::query(
        "insert into job_config_templates_v2 (account_id, id, name, payload)
         select coalesce(account_id, 'legacy'), id, name, payload from job_config_templates",
    )
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    sqlx::query("drop table job_config_templates")
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    sqlx::query("alter table job_config_templates_v2 rename to job_config_templates")
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    Ok(())
}

fn from_payload<T: serde::de::DeserializeOwned>(payload: String) -> AppResult<T> {
    serde_json::from_str(&payload).map_err(|error| AppError::storage(error.to_string()))
}
