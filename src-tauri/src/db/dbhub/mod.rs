//! DBHub — the data hub's database side: saved connections, the network
//! profiles that reach them, and the read-only query path over both.
//!
//! Where things live:
//!
//! - [`store`] — persistence for connections and network profiles, scoped to
//!   the active AWS account. No SQL driver and no secrets here.
//! - [`driver`] — the engine boundary. One trait (`DbDriver`), one module per
//!   engine, and a registry that maps a connection's kind onto its
//!   implementation. **A new engine is a module there and an arm in
//!   `driver_for`** — nothing else in the codebase matches on kind.
//! - [`query`] — the single read-only execution path: gate, then driver, then
//!   a JSON page. Engine-agnostic.
//! - [`catalog`] — the workspace tree's two questions (which databases, which
//!   tables), asked through the same drivers.
//! - [`gate`] — the read-only SQL classifier. Refuses anything it cannot prove
//!   is a read, before a statement reaches a database.
//! - [`session`] — the machinery every driver shares: bounded dials, URL
//!   building, error projection, row projection.
//! - [`tunnel`] — SSH and SOCKS5 routing. Turns a profiled connection into a
//!   loopback [`driver::DialTarget`] that drivers dial without knowing why.

pub mod catalog;
pub mod credentials;
pub mod driver;
pub mod gate;
pub mod query;
pub mod session;
pub mod store;
pub mod tunnel;

// The persistence API keeps its original flat names (`dbhub::get_connection`,
// `dbhub::list_connections`, …) — callers have no reason to care that it moved
// into a submodule.
pub use query::{DbCatalogEntry, DbConnectionShape, DbQueryResult};
pub use store::*;
