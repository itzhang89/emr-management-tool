//! Configurable log desensitization rules.
//!
//! Source of truth for which built-in redactions run (each is an on/off switch)
//! and for the user's custom `pattern → replacement` rules. The table holds
//! both kinds in one flat list; the Redaction tab reads it whole, edits a local
//! copy, and posts the whole set back on Save (the reference "Shield" UI behaves
//! the same way). Custom rules apply in `sort_order` after the built-ins.

use crate::error::{AppError, AppResult};
use crate::models::{RedactRule, RedactRuleKind};
use sqlx::{Row, SqlitePool};

/// Kind value stored in the `kind` column.
fn kind_column(kind: RedactRuleKind) -> &'static str {
    match kind {
        RedactRuleKind::Builtin => "builtin",
        RedactRuleKind::Custom => "custom",
    }
}

fn kind_from_column(value: &str) -> RedactRuleKind {
    match value {
        "custom" => RedactRuleKind::Custom,
        _ => RedactRuleKind::Builtin,
    }
}

pub(crate) async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    for statement in ["create table if not exists redact_rules (
            id text primary key,
            name text not null,
            category text not null default 'custom',
            pattern text,
            replacement text,
            sample text,
            enabled integer not null default 1,
            kind text not null default 'custom',
            sort_order integer not null default 0,
            created_at text not null,
            updated_at text not null
        )"]
    {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|error| AppError::storage(error.to_string()))?;
    }

    seed_built_ins(pool).await
}

/// Ensure every built-in rule has a row. Uses `insert or ignore` so a built-in
/// the user switched off is never force-enabled again on the next launch or
/// upgrade, while genuinely new built-ins added in a later build still appear
/// (enabled) on first run.
async fn seed_built_ins(pool: &SqlitePool) -> AppResult<()> {
    for rule in crate::mcp::sanitize::default_rule_models() {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "insert or ignore into redact_rules
                (id, name, category, pattern, replacement, sample, enabled, kind, sort_order, created_at, updated_at)
             values (?1, ?2, ?3, null, null, null, ?4, ?5, ?6, ?7, ?7)",
        )
        .bind(&rule.id)
        .bind(&rule.name)
        .bind(&rule.category)
        .bind(if rule.enabled { 1 } else { 0 })
        .bind(kind_column(rule.kind))
        .bind(rule.sort_order)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    }
    Ok(())
}

/// Read every rule: built-ins first (canonical order), then custom rules in
/// `sort_order`.
pub async fn list_rules(pool: &SqlitePool) -> AppResult<Vec<RedactRule>> {
    let rows = sqlx::query(
        "select id, name, category, pattern, replacement, sample, enabled, kind, sort_order
           from redact_rules
          order by
            case kind when 'builtin' then 0 else 1 end,
            sort_order,
            name collate nocase",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::storage(error.to_string()))?;

    rows.iter().map(row_to_rule).collect()
}

fn row_to_rule(row: &sqlx::sqlite::SqliteRow) -> AppResult<RedactRule> {
    Ok(RedactRule {
        id: row.get("id"),
        name: row.get("name"),
        category: row.get("category"),
        pattern: row.get("pattern"),
        replacement: row.get("replacement"),
        sample: row.get("sample"),
        enabled: row.get::<i64, _>("enabled") != 0,
        kind: kind_from_column(&row.get::<String, _>("kind")),
        sort_order: row.get("sort_order"),
    })
}

/// Persist a full rule set, replacing whatever is stored. The caller has already
/// assigned ids to new custom rows, so this clears and re-inserts in one
/// transaction.
pub async fn save_rules(pool: &SqlitePool, rules: &[RedactRule]) -> AppResult<()> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    sqlx::query("delete from redact_rules")
        .execute(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;

    for (index, rule) in rules.iter().enumerate() {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "insert into redact_rules
                (id, name, category, pattern, replacement, sample, enabled, kind, sort_order, created_at, updated_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        )
        .bind(&rule.id)
        .bind(&rule.name)
        .bind(&rule.category)
        .bind(rule.pattern.as_deref())
        .bind(rule.replacement.as_deref())
        .bind(rule.sample.as_deref())
        .bind(if rule.enabled { 1 } else { 0 })
        .bind(kind_column(rule.kind))
        .bind(index as i64)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|error| AppError::storage(error.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|error| AppError::storage(error.to_string()))
}

/// Restore the built-in defaults and drop every custom rule.
pub async fn reset_to_defaults(pool: &SqlitePool) -> AppResult<()> {
    save_rules(pool, &crate::mcp::sanitize::default_rule_models()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn custom(id: &str, pattern: &str) -> RedactRule {
        RedactRule {
            id: id.to_string(),
            name: id.to_string(),
            category: "custom".to_string(),
            pattern: Some(pattern.to_string()),
            replacement: Some("__MASK_ALL__".to_string()),
            sample: None,
            enabled: true,
            kind: RedactRuleKind::Custom,
            sort_order: 999,
        }
    }

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("pool");
        migrate(&pool).await.expect("migrate");
        pool
    }

    #[tokio::test]
    async fn seeds_all_six_built_ins_enabled() {
        let p = pool().await;
        let rules = list_rules(&p).await.unwrap();
        let builtins: Vec<_> = rules
            .iter()
            .filter(|rule| rule.kind == RedactRuleKind::Builtin)
            .collect();
        assert_eq!(builtins.len(), 6, "six built-in rules seeded");
        assert!(builtins.iter().all(|rule| rule.enabled));
    }

    #[tokio::test]
    async fn keep_a_disabled_builtin_disabled_across_reseed() {
        let p = pool().await;
        let mut rules = crate::mcp::sanitize::default_rule_models();
        for rule in &mut rules {
            if rule.id == "fqdn" {
                rule.enabled = false;
            }
        }
        save_rules(&p, &rules).await.unwrap();

        // Re-running migrate must not force the disabled rule back on.
        migrate(&p).await.unwrap();
        let persisted = list_rules(&p).await.unwrap();
        let fqdn = persisted.iter().find(|rule| rule.id == "fqdn").unwrap();
        assert!(!fqdn.enabled, "seeding respects a user's off switch");
    }

    #[tokio::test]
    async fn save_replace_then_reset_returns_to_builtin_defaults() {
        let p = pool().await;
        let mut rules = crate::mcp::sanitize::default_rule_models();
        rules.push(custom("c1", "[A-Z]+"));
        save_rules(&p, &rules).await.unwrap();

        let saved = list_rules(&p).await.unwrap();
        assert_eq!(
            saved
                .iter()
                .filter(|r| r.kind == RedactRuleKind::Custom)
                .count(),
            1,
            "custom rule persisted"
        );

        reset_to_defaults(&p).await.unwrap();
        let rules = list_rules(&p).await.unwrap();
        assert!(
            rules
                .iter()
                .all(|rule| rule.kind == RedactRuleKind::Builtin),
            "reset drops custom rules"
        );
        assert_eq!(rules.len(), 6);
        assert!(rules.iter().all(|rule| rule.enabled));
    }
}
