//! SQL parse / statement-span helpers for DBHub (and Athena reuse).
//!
//! The editor and the gate share this module so "the statement under the
//! cursor" and "what kind of statement is this" cannot drift apart. Parsing
//! uses [`sqlparser`]; when a dialect cannot parse a fragment the gate keeps
//! its existing heuristic classifier as a fail-closed fallback.

mod classify_ast;
mod parse;

pub use classify_ast::{
    classify_statement, is_read_like_routine, primary_relation_name, statement_changes_schema,
    statement_is_pageable, AstClass,
};
pub use parse::{
    parse_script, statement_at, ParseErrorSpan, ParseScript, ParsedStatement, SqlDialect,
};
