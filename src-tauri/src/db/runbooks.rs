//! Remediation runbooks: match diagnosed ETL/EMR failures to advise text and
//! optional auto-rerun of EMR jobs when the runbook is approved.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use crate::error::{AppError, AppResult};
use crate::db::parse_timestamp;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunbookMatch {
    #[serde(default)]
    pub job_name_regex: Option<String>,
    #[serde(default)]
    pub error_contains: Option<String>,
    #[serde(default)]
    pub current_status_prefix: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RunbookAction {
    Advise { message: String },
    /// When the parent runbook is `approved`, Chat may auto-call start_job_run.
    /// When not approved, match_runbooks only surfaces advise actions.
    RerunEmrJob,
    /// Reserved for a future source↔Yellowbrick row-count / freshness compare.
    /// Matching ignores this action; nothing executes it yet.
    CompareSourceYellowbrick,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemediationRunbook {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub approved: bool,
    pub priority: i64,
    pub match_rules: RunbookMatch,
    pub actions: Vec<RunbookAction>,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemediationRunbookInput {
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub approved: bool,
    #[serde(default)]
    pub priority: i64,
    pub match_rules: RunbookMatch,
    pub actions: Vec<RunbookAction>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchRunbooksContext {
    #[serde(default)]
    pub job_name: Option<String>,
    #[serde(default)]
    pub error_summary: Option<String>,
    #[serde(default)]
    pub current_status: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
    #[serde(default)]
    pub application_id: Option<String>,
    #[serde(default)]
    pub job_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchedRunbook {
    pub runbook: RemediationRunbook,
    pub advice: Vec<String>,
    pub would_auto_rerun: bool,
}

pub(crate) async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query(
        "create table if not exists remediation_runbooks (
            id text primary key,
            name text not null,
            enabled integer not null default 1,
            approved integer not null default 0,
            priority integer not null default 0,
            match_json text not null,
            actions_json text not null,
            created_at text not null,
            updated_at text not null
        )",
    )
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    seed_examples(pool).await?;
    Ok(())
}

async fn seed_examples(pool: &SqlitePool) -> AppResult<()> {
    let now = Utc::now();
    // Idempotent by id so new example runbooks appear on existing installs.
    let examples = [
        RemediationRunbook {
            id: "rb-consecutive-failures".into(),
            name: "Consecutive ETL failures".into(),
            enabled: true,
            approved: false,
            priority: 10,
            match_rules: RunbookMatch {
                job_name_regex: None,
                error_contains: None,
                current_status_prefix: Some("consecutive failures".into()),
                project_name: None,
            },
            actions: vec![
                RunbookAction::Advise {
                    message: "Check step_log.error for the latest job_id of this job_name in bigdata_etl, then correlate application_id with analyze_job_failure. Approve this runbook to allow automatic EMR rerun.".into(),
                },
                RunbookAction::RerunEmrJob,
            ],
            created_at: now,
            updated_at: now,
        },
        RemediationRunbook {
            id: "rb-streaming-failed".into(),
            name: "Streaming job not running".into(),
            enabled: true,
            approved: false,
            priority: 20,
            match_rules: RunbookMatch {
                job_name_regex: Some("_streaming$".into()),
                error_contains: None,
                current_status_prefix: Some("streaming job is failed".into()),
                project_name: None,
            },
            actions: vec![RunbookAction::Advise {
                message: "Streaming jobs should stay RUNNING. Inspect controller/driver logs via analyze_job_failure once you have the Spark application id, then restart only after the root cause is fixed.".into(),
            }],
            created_at: now,
            updated_at: now,
        },
        RemediationRunbook {
            id: "rb-freshness-lag".into(),
            name: "Source warehouse freshness lag".into(),
            enabled: true,
            approved: false,
            priority: 30,
            match_rules: RunbookMatch {
                job_name_regex: None,
                error_contains: Some("lag".into()),
                current_status_prefix: None,
                project_name: None,
            },
            actions: vec![RunbookAction::Advise {
                message: "Call compare_table_freshness with the source and Yellowbrick (or warehouse) connection tool slugs, tables, and watermark column. On mismatch, check Glue table metadata and related EMR job logs, then summarize attribution — do not repair warehouse data automatically.".into(),
            }],
            created_at: now,
            updated_at: now,
        },
    ];

    for runbook in examples {
        if get_runbook(pool, &runbook.id).await?.is_some() {
            continue;
        }
        insert_runbook(pool, &runbook).await?;
    }
    Ok(())
}

pub async fn list_runbooks(pool: &SqlitePool) -> AppResult<Vec<RemediationRunbook>> {
    let rows = sqlx::query(
        "select id, name, enabled, approved, priority, match_json, actions_json, created_at, updated_at
         from remediation_runbooks
         order by priority asc, name asc",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    rows.into_iter().map(row_to_runbook).collect()
}

pub async fn get_runbook(pool: &SqlitePool, id: &str) -> AppResult<Option<RemediationRunbook>> {
    let row = sqlx::query(
        "select id, name, enabled, approved, priority, match_json, actions_json, created_at, updated_at
         from remediation_runbooks where id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    row.map(row_to_runbook).transpose()
}

pub async fn insert_runbook(pool: &SqlitePool, runbook: &RemediationRunbook) -> AppResult<()> {
    let match_json = serde_json::to_string(&runbook.match_rules)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let actions_json = serde_json::to_string(&runbook.actions)
        .map_err(|error| AppError::internal(error.to_string()))?;
    sqlx::query(
        "insert into remediation_runbooks
         (id, name, enabled, approved, priority, match_json, actions_json, created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )
    .bind(&runbook.id)
    .bind(&runbook.name)
    .bind(if runbook.enabled { 1 } else { 0 })
    .bind(if runbook.approved { 1 } else { 0 })
    .bind(runbook.priority)
    .bind(match_json)
    .bind(actions_json)
    .bind(runbook.created_at.to_rfc3339())
    .bind(runbook.updated_at.to_rfc3339())
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn update_runbook(pool: &SqlitePool, runbook: &RemediationRunbook) -> AppResult<()> {
    let match_json = serde_json::to_string(&runbook.match_rules)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let actions_json = serde_json::to_string(&runbook.actions)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let result = sqlx::query(
        "update remediation_runbooks
         set name = ?2, enabled = ?3, approved = ?4, priority = ?5,
             match_json = ?6, actions_json = ?7, updated_at = ?8
         where id = ?1",
    )
    .bind(&runbook.id)
    .bind(&runbook.name)
    .bind(if runbook.enabled { 1 } else { 0 })
    .bind(if runbook.approved { 1 } else { 0 })
    .bind(runbook.priority)
    .bind(match_json)
    .bind(actions_json)
    .bind(runbook.updated_at.to_rfc3339())
    .execute(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;
    if result.rows_affected() == 0 {
        return Err(AppError::validation("Runbook was not found."));
    }
    Ok(())
}

pub async fn delete_runbook(pool: &SqlitePool, id: &str) -> AppResult<()> {
    sqlx::query("delete from remediation_runbooks where id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn match_runbooks(
    pool: &SqlitePool,
    context: &MatchRunbooksContext,
) -> AppResult<Vec<MatchedRunbook>> {
    let mut matched = Vec::new();
    for runbook in list_runbooks(pool).await? {
        if !runbook.enabled {
            continue;
        }
        if !rules_match(&runbook.match_rules, context) {
            continue;
        }
        let advice = runbook
            .actions
            .iter()
            .filter_map(|action| match action {
                RunbookAction::Advise { message } => Some(message.clone()),
                RunbookAction::RerunEmrJob | RunbookAction::CompareSourceYellowbrick => None,
            })
            .collect();
        let would_auto_rerun = runbook.approved
            && runbook
                .actions
                .iter()
                .any(|action| matches!(action, RunbookAction::RerunEmrJob));
        matched.push(MatchedRunbook {
            runbook,
            advice,
            would_auto_rerun,
        });
    }
    Ok(matched)
}

fn rules_match(rules: &RunbookMatch, context: &MatchRunbooksContext) -> bool {
    let mut any_rule = false;
    if let Some(prefix) = rules.current_status_prefix.as_deref() {
        any_rule = true;
        let status = context.current_status.as_deref().unwrap_or("");
        if !status.to_ascii_lowercase().starts_with(&prefix.to_ascii_lowercase()) {
            return false;
        }
    }
    if let Some(needle) = rules.error_contains.as_deref() {
        any_rule = true;
        let hay = context.error_summary.as_deref().unwrap_or("");
        if !hay.to_ascii_lowercase().contains(&needle.to_ascii_lowercase()) {
            return false;
        }
    }
    if let Some(project) = rules.project_name.as_deref() {
        any_rule = true;
        if context.project_name.as_deref() != Some(project) {
            return false;
        }
    }
    if let Some(pattern) = rules.job_name_regex.as_deref() {
        any_rule = true;
        let name = context.job_name.as_deref().unwrap_or("");
        match regex::Regex::new(pattern) {
            Ok(re) => {
                if !re.is_match(name) {
                    return false;
                }
            }
            Err(_) => return false,
        }
    }
    // An empty match object would match everything — refuse that as too broad.
    any_rule
}

fn row_to_runbook(row: sqlx::sqlite::SqliteRow) -> AppResult<RemediationRunbook> {
    let match_json: String = row.get("match_json");
    let actions_json: String = row.get("actions_json");
    let created_at: String = row.get("created_at");
    let updated_at: String = row.get("updated_at");
    Ok(RemediationRunbook {
        id: row.get("id"),
        name: row.get("name"),
        enabled: row.get::<i64, _>("enabled") != 0,
        approved: row.get::<i64, _>("approved") != 0,
        priority: row.get("priority"),
        match_rules: serde_json::from_str(&match_json)
            .map_err(|error| AppError::storage(format!("Bad runbook match_json: {error}")))?,
        actions: serde_json::from_str(&actions_json)
            .map_err(|error| AppError::storage(format!("Bad runbook actions_json: {error}")))?,
        created_at: parse_timestamp(&created_at),
        updated_at: parse_timestamp(&updated_at),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn seeds_examples_and_matches_status_prefix() {
        let pool = pool().await;
        let matched = match_runbooks(
            &pool,
            &MatchRunbooksContext {
                job_name: Some("sales__load".into()),
                current_status: Some("consecutive failures 2".into()),
                error_summary: None,
                project_name: None,
                application_id: None,
                job_id: None,
            },
        )
        .await
        .unwrap();
        assert!(!matched.is_empty());
        assert!(matched.iter().any(|item| item.runbook.id == "rb-consecutive-failures"));
        assert!(!matched[0].would_auto_rerun);
    }

    #[tokio::test]
    async fn approved_runbook_flags_auto_rerun() {
        let pool = pool().await;
        let mut runbook = get_runbook(&pool, "rb-consecutive-failures")
            .await
            .unwrap()
            .unwrap();
        runbook.approved = true;
        runbook.updated_at = Utc::now();
        update_runbook(&pool, &runbook).await.unwrap();
        let matched = match_runbooks(
            &pool,
            &MatchRunbooksContext {
                current_status: Some("consecutive failures N times".into()),
                job_name: None,
                error_summary: None,
                project_name: None,
                application_id: None,
                job_id: None,
            },
        )
        .await
        .unwrap();
        let hit = matched
            .into_iter()
            .find(|item| item.runbook.id == "rb-consecutive-failures")
            .unwrap();
        assert!(hit.would_auto_rerun);
    }
}
