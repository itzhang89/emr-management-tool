use crate::db::app_data_dir;
use crate::error::{AppError, AppResult};
use crate::models::{ApplicationTemplate, JobRunSummary, ResourceTemplate};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::fs;

pub async fn pool() -> AppResult<SqlitePool> {
    let dir = app_data_dir()?;
    fs::create_dir_all(&dir).map_err(|error| AppError::Storage(error.to_string()))?;
    let options = SqliteConnectOptions::new()
        .filename(dir.join("emr-management-tool.sqlite"))
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .map_err(|error| AppError::Storage(error.to_string()))?;

    migrate(&pool).await?;

    Ok(pool)
}

pub async fn list_application_templates(pool: &SqlitePool) -> AppResult<Vec<ApplicationTemplate>> {
    let rows = sqlx::query("select payload from application_templates order by name")
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::Storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| from_payload(row.get::<String, _>("payload")))
        .collect()
}

pub async fn upsert_application_template(pool: &SqlitePool, template: &ApplicationTemplate) -> AppResult<()> {
    let payload = serde_json::to_string(template).map_err(|error| AppError::Storage(error.to_string()))?;
    sqlx::query(
        "insert into application_templates (id, name, payload) values (?1, ?2, ?3)
         on conflict(id) do update set name = excluded.name, payload = excluded.payload",
    )
    .bind(&template.id)
    .bind(&template.name)
    .bind(payload)
    .execute(pool)
    .await
    .map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(())
}

pub async fn list_resource_templates(pool: &SqlitePool) -> AppResult<Vec<ResourceTemplate>> {
    let rows = sqlx::query("select payload from resource_templates order by name")
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::Storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| from_payload(row.get::<String, _>("payload")))
        .collect()
}

pub async fn upsert_resource_template(pool: &SqlitePool, template: &ResourceTemplate) -> AppResult<()> {
    let payload = serde_json::to_string(template).map_err(|error| AppError::Storage(error.to_string()))?;
    sqlx::query(
        "insert into resource_templates (id, name, payload) values (?1, ?2, ?3)
         on conflict(id) do update set name = excluded.name, payload = excluded.payload",
    )
    .bind(&template.id)
    .bind(&template.name)
    .bind(payload)
    .execute(pool)
    .await
    .map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(())
}

pub async fn delete_template(pool: &SqlitePool, table: &str, id: &str) -> AppResult<()> {
    let query = match table {
        "application" => "delete from application_templates where id = ?1",
        "resource" => "delete from resource_templates where id = ?1 and json_extract(payload, '$.builtIn') = 0",
        _ => return Err(AppError::Validation("Template type must be application or resource.".to_string())),
    };
    sqlx::query(query)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(())
}

pub async fn list_job_history(pool: &SqlitePool) -> AppResult<Vec<JobRunSummary>> {
    let rows = sqlx::query("select payload from job_history order by created_at desc")
        .fetch_all(pool)
        .await
        .map_err(|error| AppError::Storage(error.to_string()))?;

    rows.into_iter()
        .map(|row| from_payload(row.get::<String, _>("payload")))
        .collect()
}

pub async fn upsert_job_history(pool: &SqlitePool, job: &JobRunSummary) -> AppResult<()> {
    let payload = serde_json::to_string(job).map_err(|error| AppError::Storage(error.to_string()))?;
    sqlx::query(
        "insert into job_history (id, created_at, payload) values (?1, ?2, ?3)
         on conflict(id) do update set created_at = excluded.created_at, payload = excluded.payload",
    )
    .bind(&job.id)
    .bind(&job.created_at)
    .bind(payload)
    .execute(pool)
    .await
    .map_err(|error| AppError::Storage(error.to_string()))?;
    Ok(())
}

async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    for statement in [
        "create table if not exists application_templates (id text primary key, name text not null, payload text not null)",
        "create table if not exists resource_templates (id text primary key, name text not null, payload text not null)",
        "create table if not exists job_history (id text primary key, created_at text not null, payload text not null)",
    ] {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|error| AppError::Storage(error.to_string()))?;
    }

    Ok(())
}

fn from_payload<T: serde::de::DeserializeOwned>(payload: String) -> AppResult<T> {
    serde_json::from_str(&payload).map_err(|error| AppError::Storage(error.to_string()))
}
