use crate::db::app_data_dir;
use crate::error::{AppError, AppResult};
use crate::models::{ApplicationTemplate, AwsAccount, JobRunSummary, ResourceTemplate};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::fs;

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

pub async fn delete_template(pool: &SqlitePool, table: &str, id: &str) -> AppResult<()> {
    let query = match table {
        "application" => "delete from application_templates where id = ?1",
        "resource" => "delete from resource_templates where id = ?1 and json_extract(payload, '$.builtIn') = 0",
        _ => return Err(AppError::validation("Template type must be application or resource.")),
    };
    sqlx::query(query)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn list_job_history(
    pool: &SqlitePool,
    account_id: Option<&str>,
    virtual_cluster_id: Option<&str>,
) -> AppResult<Vec<JobRunSummary>> {
    let rows = sqlx::query(
        "select payload from job_history
         where (?1 is null or account_id = ?1)
           and (?2 is null or virtual_cluster_id = ?2)
         order by created_at desc",
    )
    .bind(account_id)
    .bind(virtual_cluster_id)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| from_payload(row.get::<String, _>("payload")))
        .collect()
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

    Ok(())
}

fn from_payload<T: serde::de::DeserializeOwned>(payload: String) -> AppResult<T> {
    serde_json::from_str(&payload).map_err(|error| AppError::storage(error.to_string()))
}
