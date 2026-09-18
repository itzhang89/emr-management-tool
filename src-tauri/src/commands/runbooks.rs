//! Remediation runbook CRUD for the AI Assistant Runbooks tab.

use crate::db::repository;
use crate::db::runbooks::{self, RemediationRunbook, RemediationRunbookInput};
use crate::error::{AppError, AppResult};
use chrono::Utc;

#[tauri::command]
pub async fn list_remediation_runbooks() -> AppResult<Vec<RemediationRunbook>> {
    let pool = repository::pool().await?;
    runbooks::list_runbooks(&pool).await
}

#[tauri::command]
pub async fn create_remediation_runbook(
    request: RemediationRunbookInput,
) -> AppResult<RemediationRunbook> {
    if request.name.trim().is_empty() {
        return Err(AppError::validation("Runbook name is required."));
    }
    if request.actions.is_empty() {
        return Err(AppError::validation("Add at least one action."));
    }
    let now = Utc::now();
    let runbook = RemediationRunbook {
        id: uuid::Uuid::new_v4().to_string(),
        name: request.name.trim().to_string(),
        enabled: request.enabled,
        approved: request.approved,
        priority: request.priority,
        match_rules: request.match_rules,
        actions: request.actions,
        created_at: now,
        updated_at: now,
    };
    let pool = repository::pool().await?;
    runbooks::insert_runbook(&pool, &runbook).await?;
    Ok(runbook)
}

#[tauri::command]
pub async fn update_remediation_runbook(
    id: String,
    request: RemediationRunbookInput,
) -> AppResult<RemediationRunbook> {
    let pool = repository::pool().await?;
    let existing = runbooks::get_runbook(&pool, &id)
        .await?
        .ok_or_else(|| AppError::validation("Runbook was not found."))?;
    let runbook = RemediationRunbook {
        id,
        name: request.name.trim().to_string(),
        enabled: request.enabled,
        approved: request.approved,
        priority: request.priority,
        match_rules: request.match_rules,
        actions: request.actions,
        created_at: existing.created_at,
        updated_at: Utc::now(),
    };
    runbooks::update_runbook(&pool, &runbook).await?;
    Ok(runbook)
}

#[tauri::command]
pub async fn delete_remediation_runbook(id: String) -> AppResult<()> {
    let pool = repository::pool().await?;
    runbooks::delete_runbook(&pool, &id).await
}
