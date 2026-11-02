//! Map a sqlparser [`Statement`] onto the gate's tier vocabulary.
//!
//! Unknown / unhandled AST shapes return `None` so the gate can fall back to
//! its heuristic classifier (fail-closed for unknowns).

use sqlparser::ast::{
    Expr, FromTable, ObjectNamePart, Query, SetExpr, Statement, TableFactor, TableObject, Value,
    ValueWithSpan,
};

use crate::models::StatementTier;

/// What the AST says a statement is — same fields the gate's `Classification`
/// carries, without depending on the gate module (avoids a cycle).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AstClass {
    pub tier: StatementTier,
    pub matched: String,
    pub verb: String,
    pub routine: Option<String>,
}

impl AstClass {
    fn of(tier: StatementTier, matched: impl Into<String>, verb: impl Into<String>) -> Self {
        Self {
            tier,
            matched: matched.into(),
            verb: verb.into(),
            routine: None,
        }
    }

    fn free(verb: impl Into<String>) -> Self {
        Self {
            tier: StatementTier::Free,
            matched: String::new(),
            verb: verb.into(),
            routine: None,
        }
    }

    fn with_routine(mut self, routine: Option<String>) -> Self {
        self.routine = routine;
        self
    }
}

/// Classify one parsed statement. `None` means fall back to the text heuristic.
pub fn classify_statement(statement: &Statement) -> Option<AstClass> {
    Some(match statement {
        Statement::Query(query) => classify_query(query)?,

        Statement::Insert(insert) => {
            let verb = if insert.replace_into {
                "REPLACE"
            } else {
                "INSERT"
            };
            AstClass::of(StatementTier::Confirm, verb, verb)
        }

        Statement::Update(update) => {
            classify_update_or_delete("UPDATE", update.selection.as_ref())
        }

        Statement::Delete(delete) => {
            classify_update_or_delete("DELETE", delete.selection.as_ref())
        }

        Statement::Merge { .. } => AstClass::of(StatementTier::Confirm, "MERGE", "MERGE"),

        Statement::Call(function) => {
            let name = object_name_last(&function.name);
            classify_routine_call("CALL", name)
        }

        Statement::Execute {
            name,
            immediate,
            ..
        } => {
            // Dynamic SQL is opaque; a named procedure can still be a read.
            if *immediate {
                AstClass::of(StatementTier::Confirm, "EXECUTE", "EXECUTE")
            } else {
                classify_routine_call("EXECUTE", name.as_ref().and_then(object_name_last))
            }
        }

        Statement::ShowCreate { .. }
        | Statement::ShowTables { .. }
        | Statement::ShowColumns { .. }
        | Statement::ShowDatabases { .. }
        | Statement::ShowSchemas { .. }
        | Statement::ShowFunctions { .. }
        | Statement::ShowVariable { .. }
        | Statement::ShowVariables { .. }
        | Statement::ShowStatus { .. }
        | Statement::ShowCollation { .. }
        | Statement::ShowCharset(_)
        | Statement::ShowObjects(_)
        | Statement::ShowViews { .. }
        | Statement::ShowCatalogs { .. }
        | Statement::ShowProcessList { .. } => AstClass::free("SHOW"),

        Statement::ExplainTable { describe_alias, .. } => {
            AstClass::free(describe_alias.to_string().to_ascii_uppercase())
        }
        Statement::Explain { describe_alias, .. } => {
            AstClass::free(describe_alias.to_string().to_ascii_uppercase())
        }

        Statement::Use(_) => AstClass::free("USE"),

        Statement::Drop { .. } | Statement::DropFunction { .. } | Statement::DropProcedure { .. } => {
            AstClass::of(StatementTier::Refuse, "DROP", "DROP")
        }

        Statement::Truncate(_) => AstClass::of(StatementTier::Refuse, "TRUNCATE", "TRUNCATE"),

        Statement::CreateTable(_)
        | Statement::CreateView { .. }
        | Statement::CreateIndex(_)
        | Statement::CreateSchema { .. }
        | Statement::CreateDatabase { .. }
        | Statement::CreateFunction(_)
        | Statement::CreateProcedure { .. }
        | Statement::CreateTrigger(_)
        | Statement::CreateType { .. }
        | Statement::CreateExtension { .. }
        | Statement::CreateRole { .. }
        | Statement::CreatePolicy { .. } => {
            AstClass::of(StatementTier::Refuse, "CREATE", "CREATE")
        }

        Statement::AlterTable { .. }
        | Statement::AlterIndex { .. }
        | Statement::AlterView { .. }
        | Statement::AlterSchema(_)
        | Statement::AlterRole { .. }
        | Statement::AlterFunction(_)
        | Statement::AlterType { .. } => {
            AstClass::of(StatementTier::Refuse, "ALTER", "ALTER")
        }

        Statement::Grant { .. } => AstClass::of(StatementTier::Refuse, "GRANT", "GRANT"),
        Statement::Revoke { .. } => AstClass::of(StatementTier::Refuse, "REVOKE", "REVOKE"),
        Statement::Set(_) => AstClass::of(StatementTier::Refuse, "SET", "SET"),
        Statement::Kill { .. } => AstClass::of(StatementTier::Refuse, "KILL", "KILL"),
        Statement::Load { .. } | Statement::Directory { .. } | Statement::LoadData { .. } => {
            AstClass::of(StatementTier::Refuse, "LOAD", "LOAD")
        }
        Statement::Copy { .. } => AstClass::of(StatementTier::Refuse, "COPY", "COPY"),
        Statement::Comment { .. } => AstClass::of(StatementTier::Refuse, "COMMENT", "COMMENT"),
        Statement::RenameTable(_) => AstClass::of(StatementTier::Refuse, "RENAME", "RENAME"),

        _ => return None,
    })
}

fn classify_query(query: &Query) -> Option<AstClass> {
    if !query.locks.is_empty() || query.for_clause.is_some() {
        return Some(AstClass::of(StatementTier::Refuse, "UPDATE", "SELECT"));
    }

    match query.body.as_ref() {
        SetExpr::Select(select) => {
            if select.into.is_some() {
                return Some(AstClass::of(StatementTier::Refuse, "INTO", "SELECT"));
            }
            Some(AstClass::free("SELECT"))
        }
        SetExpr::Query(inner) => classify_query(inner),
        SetExpr::SetOperation { left, right, .. } => {
            let left = classify_query_body(left)?;
            let right = classify_query_body(right)?;
            Some(if right.tier > left.tier { right } else { left })
        }
        SetExpr::Values(_) | SetExpr::Table(_) => Some(AstClass::free("SELECT")),
        _ => None,
    }
}

fn classify_query_body(body: &SetExpr) -> Option<AstClass> {
    match body {
        SetExpr::Select(select) => {
            if select.into.is_some() {
                Some(AstClass::of(StatementTier::Refuse, "INTO", "SELECT"))
            } else {
                Some(AstClass::free("SELECT"))
            }
        }
        SetExpr::Query(query) => classify_query(query),
        SetExpr::SetOperation { left, right, .. } => {
            let left = classify_query_body(left)?;
            let right = classify_query_body(right)?;
            Some(if right.tier > left.tier { right } else { left })
        }
        SetExpr::Values(_) | SetExpr::Table(_) => Some(AstClass::free("SELECT")),
        _ => None,
    }
}

fn classify_update_or_delete(verb: &str, selection: Option<&Expr>) -> AstClass {
    match selection {
        None => AstClass::of(
            StatementTier::Refuse,
            format!("{verb} without WHERE"),
            verb,
        ),
        Some(expr) if is_tautology(expr) => AstClass::of(
            StatementTier::Refuse,
            format!("{verb} without WHERE"),
            verb,
        ),
        Some(_) => AstClass::of(StatementTier::Confirm, verb, verb),
    }
}

/// Cheap constant-fold for the known blind spot: `WHERE 1 = 1`, `WHERE true`.
fn is_tautology(expr: &Expr) -> bool {
    match expr {
        Expr::Value(ValueWithSpan {
            value: Value::Boolean(true),
            ..
        }) => true,
        Expr::BinaryOp { left, op, right } if matches!(op, sqlparser::ast::BinaryOperator::Eq) => {
            is_one(left) && is_one(right)
        }
        _ => false,
    }
}

fn is_one(expr: &Expr) -> bool {
    matches!(
        expr,
        Expr::Value(ValueWithSpan {
            value: Value::Number(n, _),
            ..
        }) if n == "1"
    )
}

fn object_name_last(name: &sqlparser::ast::ObjectName) -> Option<String> {
    name.0.last().and_then(|part| match part {
        ObjectNamePart::Identifier(ident) => Some(ident.value.clone()),
        _ => None,
    })
}

/// The primary relation a statement names — what a Result tab prefers to show.
///
/// For `SELECT` this is the first non-derived `FROM` table (skipping subqueries
/// until a real name appears). Inserts / updates / deletes / calls name their
/// target the same way. Returns `None` when there is no useful label
/// (`SELECT 1`, `SHOW …`).
pub fn primary_relation_name(statement: &Statement) -> Option<String> {
    match statement {
        Statement::Query(query) => primary_relation_from_query(query),
        Statement::Insert(insert) => match &insert.table {
            TableObject::TableName(name) => object_name_last(name),
            TableObject::TableFunction(_) => None,
            TableObject::TableQuery(query) => primary_relation_from_query(query),
        },
        Statement::Update(update) => table_factor_name(&update.table.relation),
        Statement::Delete(delete) => {
            let from_tables = match &delete.from {
                FromTable::WithFromKeyword(tables) | FromTable::WithoutKeyword(tables) => tables,
            };
            from_tables
                .first()
                .and_then(|entry| table_factor_name(&entry.relation))
                .or_else(|| delete.tables.first().and_then(object_name_last))
        }
        Statement::CreateTable(create) => object_name_last(&create.name),
        Statement::Drop { names, .. } => names.first().and_then(object_name_last),
        Statement::Truncate(truncate) => truncate
            .table_names
            .first()
            .and_then(|name| object_name_last(&name.name)),
        Statement::Call(function) => object_name_last(&function.name),
        Statement::Execute { name, .. } => name.as_ref().and_then(object_name_last),
        _ => None,
    }
}

fn primary_relation_from_query(query: &Query) -> Option<String> {
    match query.body.as_ref() {
        SetExpr::Select(select) => select
            .from
            .first()
            .and_then(|entry| table_factor_name(&entry.relation)),
        SetExpr::Query(inner) => primary_relation_from_query(inner),
        SetExpr::SetOperation { left, .. } => match left.as_ref() {
            SetExpr::Select(select) => select
                .from
                .first()
                .and_then(|entry| table_factor_name(&entry.relation)),
            SetExpr::Query(inner) => primary_relation_from_query(inner),
            _ => None,
        },
        _ => None,
    }
}

fn table_factor_name(factor: &TableFactor) -> Option<String> {
    match factor {
        TableFactor::Table { name, .. } => object_name_last(name),
        TableFactor::Derived { subquery, .. } => primary_relation_from_query(subquery),
        _ => None,
    }
}

/// Routine name prefixes treated as reads when called.
///
/// A procedure's body is invisible to the classifier, so `CALL`/`EXEC` defaults
/// to Confirm. Names that begin with one of these prefixes are the known
/// read-shaped exception — `sp_get_*` and friends — so Observer AI and a
/// human on a read-only connection can run them without opening writes.
const FREE_ROUTINE_PREFIXES: &[&str] = &["sp_get"];

/// Whether this routine name is treated as a free read when called.
pub fn is_read_like_routine(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    FREE_ROUTINE_PREFIXES
        .iter()
        .any(|prefix| lower.starts_with(prefix))
}

fn classify_routine_call(verb: &str, routine: Option<String>) -> AstClass {
    if routine.as_deref().is_some_and(is_read_like_routine) {
        AstClass::free(verb).with_routine(routine)
    } else {
        AstClass::of(StatementTier::Confirm, verb, verb).with_routine(routine)
    }
}

/// Whether a statement may have changed what the catalogue lists.
pub fn statement_changes_schema(statement: &Statement) -> bool {
    matches!(
        statement,
        Statement::CreateTable(_)
            | Statement::CreateView { .. }
            | Statement::CreateIndex(_)
            | Statement::CreateSchema { .. }
            | Statement::CreateDatabase { .. }
            | Statement::CreateFunction(_)
            | Statement::CreateProcedure { .. }
            | Statement::CreateTrigger(_)
            | Statement::CreateType { .. }
            | Statement::CreateExtension { .. }
            | Statement::Drop { .. }
            | Statement::DropFunction { .. }
            | Statement::DropProcedure { .. }
            | Statement::AlterTable { .. }
            | Statement::AlterIndex { .. }
            | Statement::AlterView { .. }
            | Statement::AlterSchema(_)
            | Statement::AlterFunction(_)
            | Statement::AlterType { .. }
            | Statement::Truncate(_)
            | Statement::RenameTable(_)
            | Statement::Comment { .. }
    )
}

/// Whether a statement can be wrapped for paging (`SELECT` / `WITH` shape).
pub fn statement_is_pageable(statement: &Statement) -> bool {
    match statement {
        Statement::Query(query) => {
            if !query.locks.is_empty() || query.for_clause.is_some() {
                return false;
            }
            match query.body.as_ref() {
                SetExpr::Select(select) => select.into.is_none(),
                SetExpr::Query(inner) => statement_is_pageable(&Statement::Query(inner.clone())),
                SetExpr::SetOperation { .. } | SetExpr::Values(_) | SetExpr::Table(_) => true,
                _ => false,
            }
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlparser::dialect::MySqlDialect;
    use sqlparser::parser::Parser;

    fn classify_sql(sql: &str) -> AstClass {
        let stmts = Parser::parse_sql(&MySqlDialect {}, sql).expect("parse");
        assert_eq!(stmts.len(), 1);
        classify_statement(&stmts[0]).expect("classified")
    }

    #[test]
    fn show_create_is_free() {
        let class = classify_sql("SHOW CREATE TABLE t");
        assert_eq!(class.tier, StatementTier::Free);
        assert_eq!(class.verb, "SHOW");
    }

    #[test]
    fn delete_without_where_is_refused() {
        let class = classify_sql("DELETE FROM t");
        assert_eq!(class.tier, StatementTier::Refuse);
        assert!(class.matched.contains("without WHERE"));
    }

    #[test]
    fn delete_where_one_equals_one_is_refused() {
        let class = classify_sql("DELETE FROM t WHERE 1 = 1");
        assert_eq!(class.tier, StatementTier::Refuse);
    }

    #[test]
    fn select_into_table_is_refused() {
        // MySQL's INTO OUTFILE is not accepted by sqlparser; the gate's
        // heuristic still catches it. The portable SELECT … INTO form is.
        let class = classify_sql("SELECT * INTO orders_backup FROM orders");
        assert_eq!(class.tier, StatementTier::Refuse);
        assert_eq!(class.matched, "INTO");
    }

    #[test]
    fn sp_get_calls_are_free_reads() {
        let class = classify_sql("CALL sp_get_orders(1)");
        assert_eq!(class.tier, StatementTier::Free);
        assert_eq!(class.routine.as_deref(), Some("sp_get_orders"));

        let other = classify_sql("CALL sp_rebuild_index()");
        assert_eq!(other.tier, StatementTier::Confirm);
    }

    #[test]
    fn primary_relation_prefers_from_table() {
        let stmts = Parser::parse_sql(&MySqlDialect {}, "SELECT * FROM sales.orders LIMIT 10")
            .expect("parse");
        assert_eq!(
            primary_relation_name(&stmts[0]).as_deref(),
            Some("orders")
        );
        let bare = Parser::parse_sql(&MySqlDialect {}, "SELECT 1").expect("parse");
        assert_eq!(primary_relation_name(&bare[0]), None);
    }
}
