//! SQL Server driver placeholder.
//!
//! The kind, form, and sqlparser dialect are live so connections can be saved
//! and scripts classified. The wire client (tiberius) lands in a follow-up;
//! until then every dial returns a clear validation error rather than a
//! mysterious network failure.

use async_trait::async_trait;

use crate::error::{AppError, AppResult};
use crate::models::DbConnectionKind;

use super::super::session::QueryCancellation;
use super::{
    DbCatalogEntry, DbColumnEntry, DbDial, DbDriver, DbTableDetail, QueryPage, SchemaObject,
    ServerInfo,
};

pub struct SqlServerDriver;

fn not_ready() -> AppError {
    AppError::validation(
        "SQL Server connections can be saved and their SQL classified, but the \
         wire driver is not enabled in this build yet. Use MySQL or PostgreSQL \
         for live queries, or wait for the SQL Server driver release.",
    )
}

#[async_trait]
impl DbDriver for SqlServerDriver {
    fn kind(&self) -> DbConnectionKind {
        DbConnectionKind::SqlServer
    }

    async fn initialize(&self, _dial: &DbDial<'_>) -> AppResult<ServerInfo> {
        Err(not_ready())
    }

    async fn list_databases(&self, _dial: &DbDial<'_>) -> AppResult<Vec<DbCatalogEntry>> {
        Err(not_ready())
    }

    async fn list_schemas(&self, _dial: &DbDial<'_>) -> AppResult<Vec<DbCatalogEntry>> {
        Err(not_ready())
    }

    async fn list_objects(
        &self,
        _dial: &DbDial<'_>,
        _schema: &str,
        _kinds: &[SchemaObject],
    ) -> AppResult<Vec<DbCatalogEntry>> {
        Err(not_ready())
    }

    async fn list_columns(
        &self,
        _dial: &DbDial<'_>,
        _schema: &str,
        _table: &str,
    ) -> AppResult<Vec<DbColumnEntry>> {
        Err(not_ready())
    }

    async fn describe_table(
        &self,
        _dial: &DbDial<'_>,
        _schema: &str,
        _table: &str,
    ) -> AppResult<DbTableDetail> {
        Err(not_ready())
    }

    async fn update_table_metadata(
        &self,
        _dial: &DbDial<'_>,
        _schema: &str,
        _table: &str,
        _comment: Option<&str>,
        _column_comments: &[(String, Option<String>)],
    ) -> AppResult<()> {
        Err(not_ready())
    }

    async fn query(
        &self,
        _dial: &DbDial<'_>,
        _sql: &str,
        _cap: usize,
        _cancel: &QueryCancellation<'_>,
    ) -> AppResult<QueryPage> {
        Err(not_ready())
    }
}
