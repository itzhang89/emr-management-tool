//! Dial one DBHub connection through sqlx and read back its server version.
//!
//! This is the batch-3 replacement for the shape-only test: `test_db_connection`
//! now opens a real wire connection (direct for now — tunnel routing lands with
//! the tunnel batch) with a short timeout, runs `SELECT 1`, and reports the
//! server's version string. Everything happens in the Rust process; the password
//! comes from the secrets store, never the WebView.

use crate::error::{AppError, AppResult};
use crate::models::DbConnection;
use sqlx::Executor;

/// How long a test dial may take before we give up and blame the network.
pub const TEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

/// A minimal read that every supported engine answers.
const PING: &str = "SELECT 1";

/// Open a connection, run `SELECT 1`, and return the server version.
pub async fn test_connection(connection: &DbConnection, password: Option<String>) -> AppResult<String> {
    match connection.kind {
        crate::models::DbConnectionKind::Mysql => {
            test_mysql(connection, password).await
        }
        crate::models::DbConnectionKind::Postgres | crate::models::DbConnectionKind::Yellowbrick => {
            test_postgres(connection, password).await
        }
    }
}

async fn test_mysql(connection: &DbConnection, password: Option<String>) -> AppResult<String> {
    let url = mysql_url(connection, password.as_deref())?;
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .acquire_timeout(TEST_TIMEOUT)
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|error| AppError::validation(describe_dial_error(&error)))?;

    let row: (String,) = sqlx::query_as(PING_VERSION_MYSQL)
        .fetch_one(&pool)
        .await
        .map_err(|error| AppError::validation(describe_dial_error(&error)))?;
    pool.close().await;
    Ok(row.0)
}

async fn test_postgres(connection: &DbConnection, password: Option<String>) -> AppResult<String> {
    let url = postgres_url(connection, password.as_deref())?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(TEST_TIMEOUT)
        .max_connections(1)
        .connect(&url)
        .await
        .map_err(|error| AppError::validation(describe_dial_error(&error)))?;

    let row: (String,) = sqlx::query_as(PING_VERSION_PG)
        .fetch_one(&pool)
        .await
        .map_err(|error| AppError::validation(describe_dial_error(&error)))?;
    pool.close().await;
    Ok(row.0)
}

const PING_VERSION_MYSQL: &str = "select version()";
const PING_VERSION_PG: &str = "select version()";

/// Build a MySQL connection URL. Percent-encodes every user-supplied piece so
/// a password containing `@` or `/` cannot rewrite the URL's meaning.
pub(crate) fn mysql_url(connection: &DbConnection, password: Option<&str>) -> AppResult<String> {
    let mut url = format!(
        "mysql://{}:{}@{}:{}/{}",
        urlencoding::encode(&connection.username),
        urlencoding::encode(password.unwrap_or_default()),
        urlencoding::encode(&connection.host),
        connection.port,
        urlencoding::encode(connection.database.as_deref().unwrap_or(""))
    );
    if connection.database.as_deref().unwrap_or("").is_empty() {
        url = format!(
            "mysql://{}:{}@{}:{}",
            urlencoding::encode(&connection.username),
            urlencoding::encode(password.unwrap_or_default()),
            urlencoding::encode(&connection.host),
            connection.port
        );
    }
    Ok(url)
}

/// Build a PostgreSQL connection URL (also used for Yellowbrick's wire).
pub(crate) fn postgres_url(connection: &DbConnection, password: Option<&str>) -> AppResult<String> {
    let database = connection.database.as_deref().filter(|value| !value.is_empty()).unwrap_or("postgres");
    Ok(format!(
        "postgresql://{}:{}@{}:{}/{}",
        urlencoding::encode(&connection.username),
        urlencoding::encode(password.unwrap_or_default()),
        urlencoding::encode(&connection.host),
        connection.port,
        urlencoding::encode(database)
    ))
}

/// Project driver errors into a short, human explanation. Driver error chains
/// are noisy; the first line usually names the real problem.
pub(crate) fn describe_dial_error(error: &dyn std::fmt::Display) -> String {
    let text = error.to_string();
    let first_line = text.lines().next().unwrap_or(&text);
    // Keep it bounded — driver timeouts embed long socket dumps.
    crate::error::capped(first_line.trim(), 300)
        .unwrap_or_else(|| first_line.trim().to_string())
}

/// Convenience used by commands: run `SELECT 1` on an open MySQL pool.
/// Kept next to the test helpers so the gate's "read-only" story stays in one
/// module family.
pub async fn ping_pool_mysql(
    pool: &sqlx::MySqlPool,
) -> AppResult<()> {
    let mut conn = pool.acquire().await.map_err(|error| AppError::storage(error.to_string()))?;
    conn.execute(PING).await.map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

pub async fn ping_pool_postgres(
    pool: &sqlx::PgPool,
) -> AppResult<()> {
    let mut conn = pool.acquire().await.map_err(|error| AppError::storage(error.to_string()))?;
    conn.execute(PING).await.map_err(|error| AppError::storage(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DbConnection, DbConnectionKind, DbReadOnlyPolicy};

    fn connection(kind: DbConnectionKind) -> DbConnection {
        DbConnection {
            id: "c1".into(),
            account_id: "acct-a".into(),
            kind,
            name: "Test".into(),
            host: "db.internal".into(),
            port: 3306,
            database: Some("sales db".into()),
            username: "bi reader".into(),
            network_profile_id: None,
            show_as_tab: false,
            enabled_for_ai: true,
            ai_read_only_policy: DbReadOnlyPolicy::SelectOnly,
            sort_order: 0,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn mysql_url_percent_encodes_user_pieces() {
        let url = mysql_url(&connection(DbConnectionKind::Mysql), Some("p@ss/word"))
            .expect("url");
        // The spaces in user/database and the @ / in the password must not
        // change the URL's structure — everything rides in percent-encoded.
        assert!(url.starts_with("mysql://bi%20reader:p%40ss%2Fword@db.internal:3306/sales%20db"));
    }

    #[test]
    fn postgres_url_defaults_database_when_missing() {
        let mut conn = connection(DbConnectionKind::Postgres);
        conn.port = 5432;
        conn.database = None;
        let url = postgres_url(&conn, None).expect("url");
        assert!(url.starts_with("postgresql://bi%20reader:@db.internal:5432/postgres"));
    }

    #[test]
    fn mysql_url_omits_database_segment_when_empty() {
        let mut conn = connection(DbConnectionKind::Mysql);
        conn.database = None;
        let url = mysql_url(&conn, None).expect("url");
        assert!(!url.ends_with("/"));
        assert!(url.starts_with("mysql://bi%20reader:@db.internal:3306"));
    }

    #[tokio::test]
    async fn test_connection_refuses_unreachable_host_with_readable_error() {
        // Port 1 on localhost is closed — the dial fails fast and the error is
        // projected into a short message, not a driver dump.
        let mut conn = connection(DbConnectionKind::Postgres);
        conn.host = "127.0.0.1".into();
        conn.port = 1;
        conn.database = Some("postgres".into());
        let result = test_connection(&conn, Some("wrong".into())).await;
        assert!(result.is_err());
        let message = result.unwrap_err().message;
        assert!(message.len() <= 300);
    }
}
