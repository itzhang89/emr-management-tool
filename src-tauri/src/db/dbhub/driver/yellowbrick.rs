//! Yellowbrick, over the Postgres wire protocol.
//!
//! Yellowbrick is wire-compatible with Postgres, so every method here
//! delegates to [`super::postgres`] — the point of the module is not the
//! delegation, it is having somewhere for the divergence to go. The design
//! (§11.2) commits only to `SELECT` and metadata probing working on standard
//! topologies; proprietary syntax and its system catalogs get their own
//! adapter where the generic `information_schema` reads turn out not to be
//! enough. When that happens, it happens here, and no other engine moves.

use async_trait::async_trait;

use crate::error::AppResult;
use crate::models::DbConnectionKind;

use super::postgres;
use super::{
    catalog_entries, DbCatalogEntry, DbDial, DbDriver, QueryPage, ServerInfo, MAX_PAGE_ROWS,
};

/// The engine behind a Yellowbrick connection.
pub struct YellowbrickDriver;

#[async_trait]
impl DbDriver for YellowbrickDriver {
    fn kind(&self) -> DbConnectionKind {
        DbConnectionKind::Yellowbrick
    }

    async fn initialize(&self, dial: &DbDial<'_>) -> AppResult<ServerInfo> {
        postgres::initialize(dial).await
    }

    async fn list_databases(&self, dial: &DbDial<'_>) -> AppResult<Vec<DbCatalogEntry>> {
        let page = postgres::read_page(dial, postgres::DATABASES_SQL, MAX_PAGE_ROWS).await?;
        Ok(catalog_entries(&page))
    }

    async fn list_tables(
        &self,
        dial: &DbDial<'_>,
        _database: &str,
    ) -> AppResult<Vec<DbCatalogEntry>> {
        let page = postgres::read_page(dial, &postgres::tables_sql(), MAX_PAGE_ROWS).await?;
        Ok(catalog_entries(&page))
    }

    async fn query(&self, dial: &DbDial<'_>, sql: &str, cap: usize) -> AppResult<QueryPage> {
        postgres::read_page(dial, sql, cap).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dbhub::driver::DialTarget;
    use crate::models::{DbConnection, DbReadOnlyPolicy};

    fn connection() -> DbConnection {
        DbConnection {
            id: "c1".into(),
            account_id: "acct-a".into(),
            kind: DbConnectionKind::Yellowbrick,
            name: "Warehouse".into(),
            host: "yb.internal".into(),
            port: 5432,
            database: Some("analytics".into()),
            username: "reader".into(),
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
    fn dials_the_postgres_wire() {
        let connection = connection();
        let target = DialTarget::direct(&connection);
        let dial = DbDial::new(&connection, &target, Some("pw"));
        assert_eq!(
            postgres::postgres_url(&dial),
            "postgresql://reader:pw@yb.internal:5432/analytics"
        );
    }

    #[tokio::test]
    async fn initialize_reports_a_readable_error_for_an_unreachable_host() {
        let mut connection = connection();
        connection.host = "127.0.0.1".into();
        connection.port = 1;
        let target = DialTarget::direct(&connection);
        let dial = DbDial::new(&connection, &target, Some("wrong"));
        let error = YellowbrickDriver
            .initialize(&dial)
            .await
            .expect_err("the dial must fail");
        assert!(
            error
                .message
                .starts_with("Could not reach 127.0.0.1:1 (direct):"),
            "{error:?}"
        );
        assert!(error.message.len() <= 300);
    }
}
