//! Tokenize a script into statement spans and parse each fragment.
//!
//! Spans are UTF-8 byte offsets into the original string. The WebView converts
//! them to CodeMirror document offsets at the IPC boundary.

use serde::{Deserialize, Serialize};
use sqlparser::ast::Statement;
use sqlparser::dialect::{
    Dialect, GenericDialect, MsSqlDialect, MySqlDialect, PostgreSqlDialect,
};
use sqlparser::parser::Parser;
use sqlparser::tokenizer::{Location, Token, Tokenizer, TokenizerError};

use crate::models::DbConnectionKind;

/// Which SQL dialect to parse with.
///
/// Yellowbrick rides the Postgres wire and the Postgres dialect; SQL Server
/// uses MSSql. `Generic` is the default when a caller has no connection kind
/// (Glue/Athena tests, pure classifier checks).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SqlDialect {
    Mysql,
    Postgres,
    Yellowbrick,
    SqlServer,
    Generic,
}

impl SqlDialect {
    pub fn from_kind(kind: DbConnectionKind) -> Self {
        match kind {
            DbConnectionKind::Mysql => Self::Mysql,
            DbConnectionKind::Postgres => Self::Postgres,
            DbConnectionKind::Yellowbrick => Self::Yellowbrick,
            DbConnectionKind::SqlServer => Self::SqlServer,
        }
    }

    pub fn from_name(name: &str) -> Self {
        match name.to_ascii_lowercase().as_str() {
            "mysql" => Self::Mysql,
            "postgres" | "postgresql" => Self::Postgres,
            "yellowbrick" => Self::Yellowbrick,
            "sqlserver" | "mssql" | "sql_server" => Self::SqlServer,
            _ => Self::Generic,
        }
    }

    fn as_dyn(self) -> &'static dyn Dialect {
        match self {
            Self::Mysql => &MySqlDialect {},
            Self::Postgres | Self::Yellowbrick => &PostgreSqlDialect {},
            Self::SqlServer => &MsSqlDialect {},
            Self::Generic => &GenericDialect {},
        }
    }
}

/// One statement's place in the source, and whether sqlparser accepted it.
#[derive(Debug, Clone)]
pub struct ParsedStatement {
    /// Inclusive start, exclusive end — UTF-8 byte offsets into the script.
    pub start: usize,
    pub end: usize,
    /// Trimmed statement text (no trailing semicolon).
    pub text: String,
    /// `Ok` when the fragment parsed as exactly one statement.
    pub ast: Result<Statement, String>,
}

/// A parse failure located in the script.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseErrorSpan {
    pub start: usize,
    pub end: usize,
    pub message: String,
}

/// The whole script after tokenization + per-statement parse.
#[derive(Debug, Clone)]
pub struct ParseScript {
    pub statements: Vec<ParsedStatement>,
    pub errors: Vec<ParseErrorSpan>,
}

/// Split `sql` into statements and parse each with `dialect`.
pub fn parse_script(sql: &str, dialect: SqlDialect) -> ParseScript {
    let engine = dialect.as_dyn();
    let ranges = match statement_ranges(sql, engine) {
        Ok(ranges) => ranges,
        Err(error) => {
            let message = error.to_string();
            return ParseScript {
                statements: vec![ParsedStatement {
                    start: 0,
                    end: sql.len(),
                    text: sql.to_string(),
                    ast: Err(message.clone()),
                }],
                errors: vec![ParseErrorSpan {
                    start: 0,
                    end: sql.len(),
                    message,
                }],
            };
        }
    };

    let mut statements = Vec::with_capacity(ranges.len());
    let mut errors = Vec::new();
    for (start, end) in ranges {
        let raw = &sql[start..end];
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Re-anchor start/end onto the trimmed slice so the editor highlight
        // does not include leading blank lines the user did not mean to select.
        let trim_lead = raw.len() - raw.trim_start().len();
        let trim_trail = raw.len() - raw.trim_end().len();
        let span_start = start + trim_lead;
        let span_end = end - trim_trail;

        let ast = match Parser::parse_sql(engine, trimmed) {
            Ok(mut stmts) if stmts.len() == 1 => Ok(stmts.remove(0)),
            Ok(stmts) => Err(format!(
                "expected one statement, parser returned {}",
                stmts.len()
            )),
            Err(error) => Err(error.to_string()),
        };
        if let Err(message) = &ast {
            errors.push(ParseErrorSpan {
                start: span_start,
                end: span_end,
                message: message.clone(),
            });
        }
        statements.push(ParsedStatement {
            start: span_start,
            end: span_end,
            text: trimmed.to_string(),
            ast,
        });
    }

    ParseScript {
        statements,
        errors,
    }
}

/// The statement that contains `offset`, or the nearest preceding one when the
/// caret sits on whitespace / a semicolon between statements.
pub fn statement_at<'a>(parsed: &'a ParseScript, offset: usize) -> Option<&'a ParsedStatement> {
    if parsed.statements.is_empty() {
        return None;
    }
    for statement in &parsed.statements {
        if offset >= statement.start && offset <= statement.end {
            return Some(statement);
        }
    }
    parsed
        .statements
        .iter()
        .rev()
        .find(|statement| statement.start <= offset)
        .or_else(|| parsed.statements.last())
}

/// Byte ranges `[start, end)` of each statement, excluding the separating `;`.
fn statement_ranges(
    sql: &str,
    dialect: &dyn Dialect,
) -> Result<Vec<(usize, usize)>, TokenizerError> {
    let tokens = Tokenizer::new(dialect, sql).tokenize_with_location()?;
    let index = LineIndex::new(sql);

    let mut ranges = Vec::new();
    let mut stmt_start: Option<usize> = None;
    let mut last_end = 0usize;

    for token in tokens {
        match token.token {
            Token::EOF => break,
            Token::Whitespace(_) => continue,
            Token::SemiColon => {
                if let Some(start) = stmt_start.take() {
                    // Keep the semicolon inside the span so the editor
                    // highlight matches what the user typed, and history
                    // entries stay identical to a buffer that ended with `;`.
                    let semi_end = index.offset(token.span.end).min(sql.len());
                    let end = last_end.max(semi_end);
                    if end > start {
                        ranges.push((start, end));
                    }
                }
            }
            _ => {
                let start = index.offset(token.span.start);
                let end = index.offset(token.span.end);
                if stmt_start.is_none() {
                    stmt_start = Some(start);
                }
                last_end = end.min(sql.len());
            }
        }
    }
    if let Some(start) = stmt_start {
        if last_end > start {
            ranges.push((start, last_end));
        }
    }
    Ok(ranges)
}

/// Maps sqlparser `(line, column)` locations (1-based, character columns) onto
/// UTF-8 byte offsets.
struct LineIndex {
    starts: Vec<usize>,
    sql: String,
}

impl LineIndex {
    fn new(sql: &str) -> Self {
        let mut starts = vec![0];
        for (index, ch) in sql.char_indices() {
            if ch == '\n' {
                starts.push(index + ch.len_utf8());
            }
        }
        Self {
            starts,
            sql: sql.to_string(),
        }
    }

    fn offset(&self, location: Location) -> usize {
        if location.line == 0 && location.column == 0 {
            return 0;
        }
        let line = (location.line as usize).saturating_sub(1);
        let Some(&line_start) = self.starts.get(line) else {
            return self.sql.len();
        };
        let col = (location.column as usize).saturating_sub(1);
        let rest = &self.sql[line_start..];
        let byte = rest
            .char_indices()
            .nth(col)
            .map(|(i, _)| i)
            .unwrap_or(rest.len());
        (line_start + byte).min(self.sql.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_semicolons_outside_strings() {
        let parsed = parse_script(
            "SELECT * FROM t WHERE note = 'a;b'; SELECT 2",
            SqlDialect::Mysql,
        );
        assert_eq!(parsed.statements.len(), 2);
        assert!(parsed.statements[0].text.contains("'a;b'"));
        assert_eq!(parsed.statements[1].text, "SELECT 2");
        assert!(parsed.errors.is_empty());
    }

    #[test]
    fn postgres_dollar_quotes_do_not_split() {
        let parsed = parse_script("SELECT $$a;b$$; SELECT 2", SqlDialect::Postgres);
        assert_eq!(parsed.statements.len(), 2, "{:?}", parsed.statements);
        assert!(parsed.statements[0].ast.is_ok());
        assert!(parsed.statements[1].ast.is_ok());
    }

    #[test]
    fn statement_at_finds_cursor_statement() {
        let sql = "SELECT 1;\nSELECT 2;\nSELECT 3";
        let parsed = parse_script(sql, SqlDialect::Generic);
        assert_eq!(parsed.statements.len(), 3);
        let second = &parsed.statements[1];
        let hit = statement_at(&parsed, second.start + 1).expect("hit");
        assert_eq!(hit.text, "SELECT 2;");
        // Caret on the semicolon of the second statement → still that statement.
        let around_semi = sql.find("SELECT 2").unwrap() + "SELECT 2".len();
        let hit = statement_at(&parsed, around_semi).expect("semi");
        assert_eq!(hit.text, "SELECT 2;");
    }

    #[test]
    fn show_create_table_parses() {
        let parsed = parse_script("SHOW CREATE TABLE t", SqlDialect::Mysql);
        assert_eq!(parsed.statements.len(), 1);
        assert!(
            parsed.statements[0].ast.is_ok(),
            "{:?}",
            parsed.statements[0].ast
        );
    }
}
