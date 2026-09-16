//! The machinery every driver needs in the same shape: a bounded dial, a URL
//! a password cannot rewrite, driver errors projected into one readable
//! sentence, and rows turned into the JSON page the workspace renders.
//!
//! None of it is dialect knowledge — that lives beside the driver that has it
//! (`driver/mysql.rs` and friends). What is here is the part where being
//! different would be a bug: every engine should time out the same way, cap
//! its page the same way, and report a failed dial in the same voice.

use std::fmt::Display;
use std::time::Duration;

use crate::error::{AppError, AppResult};
use futures_util::TryStreamExt;
use serde_json::Value;
use sqlx::query::Query;
use sqlx::{Column, Database, Executor, IntoArguments, Row};
use tokio_util::sync::CancellationToken;

use super::driver::{DbDial, QueryPage};

/// How long one dial may take before we blame the network rather than keep
/// the user waiting on a socket that is going nowhere.
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

/// Bound route setup, dialing and execution together, so a stalled database or
/// network forward still answers the WebView with something actionable.
pub(crate) const OPERATION_TIMEOUT: Duration = Duration::from_secs(30);

/// Run `work`, failing with an actionable message when it outlives `duration`.
pub(crate) async fn complete_within<T>(
    duration: Duration,
    operation: &str,
    work: impl std::future::Future<Output = AppResult<T>>,
) -> AppResult<T> {
    tokio::time::timeout(duration, work).await.map_err(|_| {
        AppError::validation(format!(
            "Database {operation} timed out after {} seconds. Check the connection and network profile, then try again.",
            duration.as_secs().max(1)
        ))
    })?
}

/// `complete_within` at the standard database-operation budget.
pub(crate) async fn complete_operation<T>(
    operation: &str,
    work: impl std::future::Future<Output = AppResult<T>>,
) -> AppResult<T> {
    complete_within(OPERATION_TIMEOUT, operation, work).await
}

/// Project a driver error into a short, human explanation. Driver error chains
/// are noisy; the first line usually names the real problem.
pub(crate) fn describe_error(error: &dyn Display) -> String {
    let text = error.to_string();
    let first_line = text.lines().next().unwrap_or(&text);
    // Keep it bounded — driver timeouts embed long socket dumps.
    crate::error::capped(first_line.trim(), 300).unwrap_or_else(|| first_line.trim().to_string())
}

/// A dial that failed, said in the user's terms: what we tried to reach, how
/// we tried to reach it, and what the driver had to say about it.
///
/// The first two are the point. A bare "No route to host (os error 65)" reads
/// the same whether a tunnel was in play, whether the profile was bound at
/// all, or whether the database was dialed straight — and those need three
/// different fixes.
pub(crate) fn dial_error(dial: &DbDial<'_>, error: &dyn Display) -> AppError {
    // Bound the whole sentence, not just the driver's half: the target prefix
    // is short and always survives, while a driver timeout's socket dump does
    // not crowd out the reason.
    let message = format!("Could not reach {}: {}", dial.target, describe_error(error));
    AppError::validation(crate::error::capped(&message, 300).unwrap_or(message))
}

/// `scheme://user:password@host:port[/database]`.
///
/// Every user-supplied piece is percent-encoded, so a password containing `@`
/// or `/` cannot rewrite the URL's meaning, and a `None`/empty database omits
/// the path segment rather than leaving a bare trailing slash.
pub(crate) fn scheme_url(scheme: &str, dial: &DbDial<'_>, database: Option<&str>) -> String {
    let authority = format!(
        "{}:{}@{}:{}",
        urlencoding::encode(&dial.connection.username),
        urlencoding::encode(dial.secret_or_empty()),
        urlencoding::encode(&dial.target.host),
        dial.target.port,
    );
    match database.filter(|name| !name.is_empty()) {
        Some(database) => format!("{scheme}://{authority}/{}", urlencoding::encode(database)),
        None => format!("{scheme}://{authority}"),
    }
}

/// Wrap a value as a SQL string literal, doubling embedded quotes.
///
/// Catalog reads filter on a name the user picked in the tree — a value, not
/// a fragment. Engines that can bind parameters should prefer that; this is
/// for the ones whose catalog query is assembled as a string anyway.
pub(crate) fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Turn a fetched row set into the page the workspace renders: column names
/// read off the first row, the first `cap` rows as JSON objects, and whether
/// the driver's sentinel row proved there were more.
///
/// `decode` is the engine's own cell reader — what a MySQL `BLOB` and a
/// Postgres `numeric` become is dialect knowledge, and it stays with the
/// dialect.
pub(crate) fn project<R>(rows: &[R], cap: usize, decode: impl Fn(&R, usize) -> Value) -> QueryPage
where
    R: Row,
{
    let columns = rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect()
        })
        .unwrap_or_default();

    // Read the sentinel *before* the page is cut — after `take(cap)` the
    // length can never exceed the cap again.
    let truncated = rows.len() > cap;

    let page = rows
        .iter()
        .take(cap)
        .map(|row| {
            let mut object = serde_json::Map::new();
            for (index, column) in row.columns().iter().enumerate() {
                object.insert(column.name().to_string(), decode(row, index));
            }
            Value::Object(object)
        })
        .collect();

    QueryPage {
        columns,
        rows: page,
        truncated,
    }
}

/// A handle onto a running query's stop request.
///
/// Deliberately not an `Option`: the catalog reads run under a token that is
/// never cancelled, so every call site passes one and no implementation can
/// quietly forget to look.
#[derive(Clone)]
pub struct QueryCancellation<'a>(&'a CancellationToken);

impl<'a> QueryCancellation<'a> {
    pub fn new(token: &'a CancellationToken) -> Self {
        Self(token)
    }

    /// For work nothing can stop — the catalog reads, which are short and
    /// app-authored.
    pub fn never() -> QueryCancellation<'static> {
        static NEVER: std::sync::OnceLock<CancellationToken> = std::sync::OnceLock::new();
        QueryCancellation(NEVER.get_or_init(CancellationToken::new))
    }

    async fn cancelled(&self) {
        self.0.cancelled().await
    }
}

/// Stream at most `cap + 1` rows and stop.
///
/// The extra row is the sentinel: fetching it (rather than exhausting the
/// result set with `fetch_all`) is what lets the UI say "the page was cut
/// short" while a query against a large table still returns promptly.
pub(crate) async fn fetch_capped<'q, DB, A, E>(
    query: Query<'q, DB, A>,
    executor: E,
    cap: usize,
    cancel: &QueryCancellation<'_>,
) -> AppResult<Vec<DB::Row>>
where
    DB: Database,
    A: IntoArguments<DB> + 'q,
    E: Executor<'q, Database = DB>,
{
    let mut rows = Vec::with_capacity(cap.saturating_add(1));
    let mut stream = query.fetch(executor);
    while rows.len() <= cap {
        // Raced against the stop request, not polled between rows: a query
        // waiting on the socket for its first row would otherwise sit through
        // the whole timeout with the Stop button apparently dead.
        tokio::select! {
            _ = cancel.cancelled() => {
                return Err(AppError::cancelled("Query cancelled."));
            }
            next = stream.try_next() => match next {
                Ok(Some(row)) => rows.push(row),
                Ok(None) => break,
                Err(error) => return Err(AppError::validation(describe_error(&error))),
            },
        }
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DbConnection, DbConnectionKind, DbReadOnlyPolicy};

    fn dial_with<'a>(
        connection: &'a DbConnection,
        target: &'a super::super::driver::DialTarget,
        secret: Option<&'a str>,
    ) -> DbDial<'a> {
        DbDial::new(connection, target, secret)
    }

    fn connection() -> DbConnection {
        DbConnection {
            id: "c1".into(),
            account_id: "acct-a".into(),
            kind: DbConnectionKind::Mysql,
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
    fn scheme_url_percent_encodes_every_user_piece() {
        let connection = connection();
        let target = super::super::driver::DialTarget::forwarded("Office bastion", 45678);
        let url = scheme_url(
            "mysql",
            &dial_with(&connection, &target, Some("p@ss/word")),
            connection.database.as_deref(),
        );
        assert_eq!(
            url,
            "mysql://bi%20reader:p%40ss%2Fword@127.0.0.1:45678/sales%20db"
        );
    }

    #[test]
    fn scheme_url_omits_an_empty_database_segment() {
        let connection = connection();
        let target = super::super::driver::DialTarget::direct(&connection);
        for database in [None, Some("")] {
            let url = scheme_url("mysql", &dial_with(&connection, &target, None), database);
            assert_eq!(url, "mysql://bi%20reader:@db.internal:3306");
        }
    }

    #[test]
    fn quote_literal_doubles_embedded_quotes() {
        assert_eq!(quote_literal("sales"), "'sales'");
        assert_eq!(quote_literal("o'brien"), "'o''brien'");
        // The classic escape attempt stays inside the literal.
        assert_eq!(
            quote_literal("x'; drop table t; --"),
            "'x''; drop table t; --'"
        );
    }

    #[test]
    fn describe_error_keeps_only_the_first_line_and_bounds_it() {
        let error = format!("could not connect: refused\n{}", "stack ".repeat(200));
        let described = describe_error(&error);
        assert!(described.starts_with("could not connect: refused"));
        assert!(described.len() <= 300);
    }

    #[tokio::test]
    async fn a_stopped_query_is_observed_and_an_unstoppable_one_is_not() {
        let token = CancellationToken::new();
        let cancelling = QueryCancellation::new(&token);
        token.cancel();
        // Resolves immediately once the token is fired.
        tokio::time::timeout(std::time::Duration::from_millis(50), cancelling.cancelled())
            .await
            .expect("a cancelled token resolves at once");

        // The catalog's token is never fired, so it never resolves — which is
        // exactly what makes it safe to race against.
        let never = QueryCancellation::never();
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), never.cancelled())
                .await
                .is_err()
        );
    }

    #[test]
    fn dial_error_names_the_target_its_route_and_the_reason() {
        let connection = connection();
        let direct = super::super::driver::DialTarget::direct(&connection);
        let error = dial_error(
            &dial_with(&connection, &direct, None),
            &"No route to host (os error 65)",
        );
        assert_eq!(
            &*error.message,
            "Could not reach db.internal:3306 (direct): No route to host (os error 65)"
        );

        let forwarded = super::super::driver::DialTarget::forwarded("Office bastion", 54321);
        let error = dial_error(
            &dial_with(&connection, &forwarded, None),
            &"Connection refused (os error 61)",
        );
        assert_eq!(
            &*error.message,
            "Could not reach 127.0.0.1:54321 (via Network Profile \"Office bastion\"): \
             Connection refused (os error 61)"
        );
    }

    #[test]
    fn dial_error_stays_bounded_with_the_target_first() {
        // A driver timeout embeds a socket dump; the target must survive the
        // cut and the dump must not.
        let connection = connection();
        let target = super::super::driver::DialTarget::direct(&connection);
        let dump = format!("timed out\n{}", "socket ".repeat(200));
        let error = dial_error(&dial_with(&connection, &target, None), &dump);
        assert!(error.message.len() <= 300);
        assert!(error
            .message
            .starts_with("Could not reach db.internal:3306 (direct):"));
    }

    #[tokio::test]
    async fn complete_within_reports_the_operation_and_the_budget() {
        let error = complete_within(
            Duration::from_millis(1),
            "query",
            std::future::pending::<AppResult<()>>(),
        )
        .await
        .expect_err("the pending operation must time out");
        assert!(error
            .message
            .contains("Database query timed out after 1 seconds"));
    }
}
