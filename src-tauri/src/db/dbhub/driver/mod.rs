//! The database-driver boundary: one trait every engine implements, and the
//! registry that maps a saved connection onto its implementation.
//!
//! All four things the app asks of a database — *can I get in* (initialize),
//! *what databases are there*, *what tables are in one*, and *run this
//! statement* — are answered differently by every engine. MySQL pins a session
//! read-only, Postgres opens a read-only transaction, Yellowbrick rides the
//! Postgres wire with its own catalog quirks, and MSSQL/Oracle will bring
//! their own clients entirely. Keeping those answers behind one boundary means
//! a new engine is a module beside this one, not a new `match` arm in the
//! executor, the catalog tree and the connection test.
//!
//! The trait is deliberately **driver-neutral**: no sqlx type appears in its
//! signature. It takes the saved connection, a resolved dial target and the
//! secret; it returns `ServerInfo`, `DbCatalogEntry` and `QueryPage` — the
//! last carrying `serde_json::Value` cells, which is the only row shape the
//! rest of the app speaks anyway. sqlx covers MySQL and Postgres today; MSSQL
//! (tiberius) and Oracle (oracle-rs) are not sqlx engines, and they can only
//! implement this trait because nothing sqlx-shaped leaks through it.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::models::{DbConnection, DbConnectionKind};

use super::session::QueryCancellation;
use mysql::MysqlDriver;
use postgres::PostgresDriver;
use yellowbrick::YellowbrickDriver;

pub mod mysql;
pub mod postgres;
pub mod yellowbrick;

/// Hard cap on the rows one page may carry. The workspace pages through a
/// larger result by re-running the query; catalog reads use it as their whole
/// budget.
pub const MAX_PAGE_ROWS: usize = 500;

/// Where a driver dials, and how it gets there.
///
/// Always already route-resolved: when a connection rides a Network Profile
/// this is the local forward's loopback address, never the database's literal
/// host. Drivers therefore never learn — and never need to care — how the
/// bytes reach the server.
///
/// `via` is the one exception, and it is only ever read while building an
/// error: without it, "No route to host" reads identically whether a tunnel
/// was in play or the database was dialed straight.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DialTarget {
    pub host: String,
    pub port: u16,
    pub via: Via,
}

/// How a dial target was reached.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Via {
    /// Straight to the database host.
    Direct,
    /// Through a Network Profile's local forward, named as the user named it.
    Profile { name: String },
}

impl DialTarget {
    /// The connection's own address — no network profile in play.
    pub fn direct(connection: &DbConnection) -> Self {
        Self {
            host: connection.host.clone(),
            port: connection.port as u16,
            via: Via::Direct,
        }
    }

    /// The loopback port a Network Profile's local forward bound.
    pub fn forwarded(profile_name: impl Into<String>, port: u16) -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port,
            via: Via::Profile {
                name: profile_name.into(),
            },
        }
    }
}

impl std::fmt::Display for DialTarget {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}:{}", self.host, self.port)?;
        match &self.via {
            Via::Direct => write!(formatter, " (direct)"),
            Via::Profile { name } => write!(formatter, " (via Network Profile \"{name}\")"),
        }
    }
}

/// Everything one driver call needs.
///
/// A parameter object on purpose: an engine that needs one more input (an
/// Oracle service name, an MSSQL named instance) adds a field here once,
/// instead of changing four method signatures and every implementation.
pub struct DbDial<'a> {
    pub connection: &'a DbConnection,
    pub target: &'a DialTarget,
    /// The password from the secrets store. `None` means the user chose not to
    /// save one — the driver dials without it and the server decides.
    pub secret: Option<&'a str>,
    /// Read this database instead of the connection's own — the catalog tree's
    /// selection. See [`DbDial::reading`].
    pub database: Option<&'a str>,
    /// Whether this session may write.
    ///
    /// `false` everywhere by default, and always for the AI paths: a driver
    /// that cannot write is what makes "the model cannot change your database"
    /// a property of the code rather than of a setting. Only a connection the
    /// user explicitly opted into carries `true`.
    pub writable: bool,
}

impl<'a> DbDial<'a> {
    pub fn new(
        connection: &'a DbConnection,
        target: &'a DialTarget,
        secret: Option<&'a str>,
    ) -> Self {
        Self {
            connection,
            target,
            secret,
            database: None,
            writable: false,
        }
    }

    /// The same dial, in a session that may write.
    pub fn writable(mut self) -> Self {
        self.writable = true;
        self
    }

    /// The same dial, reading another database.
    ///
    /// The catalog tree walks databases, and a server that separates database
    /// from schema (Postgres, Yellowbrick) has no cross-database query — so
    /// reading a database's schemas and tables means connecting *to* it, not
    /// to whatever database the connection was saved with.
    pub fn reading<'b>(&'b self, database: &'b str) -> DbDial<'b> {
        DbDial {
            connection: self.connection,
            target: self.target,
            secret: self.secret,
            database: Some(database),
            writable: self.writable,
        }
    }

    /// The database this dial reads: the tree's selection when it has one,
    /// otherwise the connection's own.
    pub fn database(&self) -> Option<&str> {
        let named = |name: &&str| !name.is_empty();
        self.database
            .filter(named)
            .or_else(|| self.connection.database.as_deref().filter(named))
    }

    /// The secret, with "no password saved" normalised to the empty string the
    /// URL builders want.
    pub fn secret_or_empty(&self) -> &str {
        self.secret.unwrap_or_default()
    }
}

/// What a successful dial reports back.
///
/// One field today. The type exists so the connection test can grow (product
/// name, protocol version) without every driver's signature changing with it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub version: String,
}

/// One page of results, in the only row shape the app speaks: JSON.
///
/// `truncated` is honest rather than inferred — the driver streams one row
/// past the cap and reports whether that sentinel arrived, so the UI can say
/// "more rows exist" without running the query again.
#[derive(Debug)]
pub struct QueryPage {
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>,
    pub truncated: bool,
}

/// What a schema can hold.
///
/// A fixed set rather than the engine's own spelling: MySQL says `BASE TABLE`
/// and Postgres says `FOREIGN`, and a tree that has to know that is a tree
/// that has to know every engine. Each driver maps its own vocabulary onto
/// these, in SQL, so what comes back is already the app's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SchemaObject {
    Table,
    View,
    ForeignTable,
    MaterializedView,
    Procedure,
    Function,
    Event,
}

impl SchemaObject {
    /// The word the WebView uses, and the one the SQL tags rows with.
    pub fn as_str(self) -> &'static str {
        match self {
            SchemaObject::Table => "table",
            SchemaObject::View => "view",
            SchemaObject::ForeignTable => "foreign-table",
            SchemaObject::MaterializedView => "materialized-view",
            SchemaObject::Procedure => "procedure",
            SchemaObject::Function => "function",
            SchemaObject::Event => "event",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        [
            SchemaObject::Table,
            SchemaObject::View,
            SchemaObject::ForeignTable,
            SchemaObject::MaterializedView,
            SchemaObject::Procedure,
            SchemaObject::Function,
            SchemaObject::Event,
        ]
        .into_iter()
        .find(|kind| kind.as_str() == value)
    }

    /// Whether a statement about this object is a plain read — a table you can
    /// `select * from`, rather than a routine you call.
    pub fn is_relation(self) -> bool {
        matches!(
            self,
            SchemaObject::Table
                | SchemaObject::View
                | SchemaObject::ForeignTable
                | SchemaObject::MaterializedView
        )
    }
}

/// One entry in the query workspace's catalog tree: a database, a schema, or
/// something inside one.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbCatalogEntry {
    pub name: String,
    /// Absent for databases and schemas, which are levels rather than objects.
    pub kind: Option<SchemaObject>,
}

/// One database engine, behind the app's four questions.
#[async_trait]
pub trait DbDriver: Send + Sync {
    /// Which connection kind this implementation serves. The registry and the
    /// driver agree by construction; the accessor exists so a driver can name
    /// itself in its own errors.
    fn kind(&self) -> DbConnectionKind;

    /// Open a session, authenticate, read the server's version, close.
    ///
    /// This is the "test connection" probe and the "is this connection usable
    /// at all" check in one: everything that can go wrong with reaching a
    /// database (route, dial, TLS, credentials) goes wrong here, and the error
    /// it returns is what the user reads on the Test Connection button.
    async fn initialize(&self, dial: &DbDial<'_>) -> AppResult<ServerInfo>;

    /// The top level of the catalog tree: what this engine calls a database.
    ///
    /// MySQL's schemata and Postgres's databases are both this level — the
    /// names differ, the tree does not.
    async fn list_databases(&self, dial: &DbDial<'_>) -> AppResult<Vec<DbCatalogEntry>>;

    /// The schemas inside the database this dial reads.
    ///
    /// Engines whose "schema" *is* their database — MySQL — answer with an
    /// empty list, which is how they say "this tree has no third level": the
    /// tree skips a level that would hold exactly one meaningless choice.
    async fn list_schemas(&self, dial: &DbDial<'_>) -> AppResult<Vec<DbCatalogEntry>>;

    /// The objects of one schema, of the requested kinds only, inside the
    /// database this dial reads (see [`DbDial::reading`]).
    ///
    /// Asking for kinds rather than returning everything is deliberate: a
    /// schema can hold thousands of routines, and the tree opens on its
    /// tables. Each implementation runs one catalogue read per kind it
    /// actually needs, and tags every row with the [`SchemaObject`] it is.
    ///
    /// `schema` is a name the tree handed back from `list_schemas`, but it is
    /// still a value — implementations must bind or quote it, never splice it
    /// into SQL raw. MySQL ignores it: its schema and its database are the
    /// same thing, and the dial already names that.
    async fn list_objects(
        &self,
        dial: &DbDial<'_>,
        schema: &str,
        kinds: &[SchemaObject],
    ) -> AppResult<Vec<DbCatalogEntry>>;

    /// Run one **already-gated** read-only statement and return at most `cap`
    /// rows.
    ///
    /// `cancel` is the caller's stop request; implementations race it against
    /// the row stream so a query the user abandoned stops in bounded time.
    ///
    /// The read-only gate (`dbhub::gate`) runs before this is called for user
    /// SQL, and each implementation opens its session read-only as the second
    /// line of defence. Callers other than `dbhub::query` — the catalog reads
    /// — pass SQL this crate authored, which is why classification is the
    /// caller's job rather than the driver's.
    async fn query(
        &self,
        dial: &DbDial<'_>,
        sql: &str,
        cap: usize,
        cancel: &QueryCancellation<'_>,
    ) -> AppResult<QueryPage>;
}

/// The driver for one connection kind — the only `match` on kind left in the
/// codebase.
///
/// Adding an engine is: a module beside this one, an arm here, and (for a kind
/// that is not sqlx-backed) a dependency in `Cargo.toml`. Nothing in
/// `query`, `catalog` or the commands needs to know it happened.
pub fn driver_for(kind: DbConnectionKind) -> &'static dyn DbDriver {
    match kind {
        DbConnectionKind::Mysql => &MysqlDriver,
        DbConnectionKind::Postgres => &PostgresDriver,
        DbConnectionKind::Yellowbrick => &YellowbrickDriver,
    }
}

/// Project a catalog page into tree entries. Every engine's catalog queries
/// select the two aliases this reads (`name`, `kind`), so the projection is
/// shared rather than repeated per driver.
pub(crate) fn catalog_entries(page: &QueryPage) -> Vec<DbCatalogEntry> {
    page.rows
        .iter()
        .filter_map(|row| {
            let name = row.get("name").and_then(|value| value.as_str())?;
            // A row whose tag we do not recognise is skipped rather than
            // guessed at: the tags are ours, so an unknown one means a query
            // and this enum have drifted apart, and a wrong icon is worse
            // than a missing row.
            let kind = row
                .get("kind")
                .and_then(|value| value.as_str())
                .and_then(SchemaObject::parse);
            Some(DbCatalogEntry {
                name: name.to_string(),
                kind,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DbConnection, DbConnectionKind, DbReadOnlyPolicy};

    fn connection(kind: DbConnectionKind, host: &str, port: i64) -> DbConnection {
        DbConnection {
            id: "c1".into(),
            account_id: "acct-a".into(),
            kind,
            name: "Test".into(),
            host: host.into(),
            port,
            database: Some("sales".into()),
            username: "reader".into(),
            network_profile_id: None,
            show_as_tab: false,
            enabled_for_ai: true,
            ai_read_only_policy: DbReadOnlyPolicy::SelectOnly,
            allow_writes: false,
            auth_mode: crate::models::DbAuthMode::Manual,
            secret_arn: None,
            secret_name: None,
            sort_order: 0,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn dial_target_direct_reads_the_connection_address() {
        let connection = connection(DbConnectionKind::Mysql, "db.internal", 3306);
        let target = DialTarget::direct(&connection);
        assert_eq!(target.host, "db.internal");
        assert_eq!(target.port, 3306);
        assert_eq!(target.via, Via::Direct);
    }

    /// The route is what makes a failed dial readable: the same errno means
    /// "your tunnel is down" or "that host is unreachable from here", and the
    /// message has to say which.
    #[test]
    fn dial_target_says_how_it_was_reached() {
        let connection = connection(DbConnectionKind::Mysql, "db.internal", 3306);
        assert_eq!(
            DialTarget::direct(&connection).to_string(),
            "db.internal:3306 (direct)"
        );
        assert_eq!(
            DialTarget::forwarded("Office bastion", 54321).to_string(),
            "127.0.0.1:54321 (via Network Profile \"Office bastion\")"
        );
    }

    #[test]
    fn dial_exposes_database_and_secret_shapes() {
        let connection = connection(DbConnectionKind::Mysql, "db.internal", 3306);
        let target = DialTarget::direct(&connection);

        let dial = DbDial::new(&connection, &target, Some("pw"));
        assert_eq!(dial.database(), Some("sales"));
        assert_eq!(dial.secret_or_empty(), "pw");

        // "No saved password" dials with an empty one rather than failing to
        // build a URL.
        let dial = DbDial::new(&connection, &target, None);
        assert_eq!(dial.secret_or_empty(), "");

        // An empty database name is the same as naming none.
        let mut blank = connection;
        blank.database = Some(String::new());
        assert_eq!(DbDial::new(&blank, &target, None).database(), None);
    }

    #[test]
    fn every_kind_has_a_driver_that_names_itself() {
        for kind in [
            DbConnectionKind::Mysql,
            DbConnectionKind::Postgres,
            DbConnectionKind::Yellowbrick,
        ] {
            assert_eq!(driver_for(kind).kind(), kind);
        }
    }

    #[test]
    fn catalog_entries_need_a_name_and_keep_an_unknown_kind_as_none() {
        // Databases and schemas come back with no kind by design — they are
        // levels, not objects — so a row without one is kept, and only a
        // nameless row is dropped. The tags this crate writes are recognised;
        // anything else arrives as *no* kind rather than as a wrong one.
        let page = QueryPage {
            columns: vec!["name".into(), "kind".into()],
            rows: vec![
                serde_json::json!({ "name": "sales", "kind": "table" }),
                serde_json::json!({ "name": "views", "kind": "view" }),
                serde_json::json!({ "name": "mystery", "kind": "SEQUENCE" }),
                serde_json::json!({ "kind": "table" }),
            ],
            truncated: false,
        };
        let entries = catalog_entries(&page);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].name, "sales");
        assert_eq!(entries[0].kind, Some(SchemaObject::Table));
        assert_eq!(entries[1].kind, Some(SchemaObject::View));
        assert_eq!(entries[2].kind, None);
    }

    #[test]
    fn only_relations_can_be_read_with_a_select() {
        // The tree uses this to decide whether clicking an entry can build a
        // statement: `select * from my_procedure` is not SQL.
        assert!(SchemaObject::Table.is_relation());
        assert!(SchemaObject::MaterializedView.is_relation());
        assert!(!SchemaObject::Procedure.is_relation());
        assert!(!SchemaObject::Event.is_relation());
    }
}
