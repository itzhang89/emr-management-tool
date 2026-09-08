//! The read-only gate every DBHub SQL execution passes through (design
//! section 8, layer 3): a statement is classified before it is allowed to
//! leave the process, and the connection itself is opened in read-only
//! transaction mode as the second line of defence.
//!
//! The gate is intentionally conservative: anything not recognised as a
//! read statement is rejected. A statement that only *looks* read-only but
//! embeds a write (e.g. `SELECT ... INTO OUTFILE`) fails classification and
//! is refused — the model or the user can rephrase it, a destroyed table
//! cannot be un-rephrased.

/// The classification verdict for one statement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatementClass {
    /// Pure read: runs.
    Read,
    /// Not recognised as a read: refused with an explanation.
    Blocked { reason: String },
}

/// Classify one statement for the read-only gate. Handles leading comments
/// and whitespace (a statement may open with `/* */` or `--`), multiple
/// statements (any non-read statement rejects the whole batch), and the
/// read-flavoured utility statements (SHOW/DESCRIBE/EXPLAIN/USE/TCC).
pub fn classify(sql: &str) -> StatementClass {
    let mut any_statement = false;
    for statement in split_statements(sql) {
        any_statement = true;
        match classify_single(&statement) {
            StatementClass::Read => {}
            StatementClass::Blocked { .. } => return classify_single(&statement),
        }
    }
    if !any_statement {
        return StatementClass::Blocked {
            reason: "No SQL statement to run.".to_string(),
        };
    }
    StatementClass::Read
}

/// Split on semicolons outside quotes; the pieces keep their comments, which
/// `classify_single` strips.
fn split_statements(sql: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = sql.chars().peekable();
    let mut in_single = false;
    let mut in_double = false;
    let mut in_backtick = false;

    while let Some(char) = chars.next() {
        match char {
            '\'' if !in_double && !in_backtick => {
                in_single = !in_single;
                current.push(char);
            }
            '"' if !in_single && !in_backtick => {
                in_double = !in_double;
                current.push(char);
            }
            '`' if !in_single && !in_double => {
                in_backtick = !in_backtick;
                current.push(char);
            }
            '\\' if in_single || in_double => {
                current.push(char);
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            ';' if !in_single && !in_double && !in_backtick => {
                parts.push(std::mem::take(&mut current));
            }
            _ => current.push(char),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current);
    }
    parts.into_iter().filter(|part| !strip_comments(part).trim().is_empty()).collect()
}

/// Remove leading/trailing whitespace and comment lines so the statement's
/// first real word can be read. Handles `-- line`, `# line` (MySQL) and
/// both block comment shapes.
fn strip_comments(statement: &str) -> String {
    let mut without_block = String::new();
    let chars: Vec<char> = statement.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '/' && index + 1 < chars.len() && chars[index + 1] == '*' {
            // Skip to the closing */, tolerating a missing one (the whole
            // remainder is then comment for our purposes).
            index += 2;
            while index + 1 < chars.len()
                && !(chars[index] == '*' && chars[index + 1] == '/')
            {
                index += 1;
            }
            index = (index + 2).min(chars.len());
        } else {
            without_block.push(chars[index]);
            index += 1;
        }
    }

    let mut cleaned = String::new();
    for line in without_block.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("--") || trimmed.starts_with('#') {
            continue;
        }
        cleaned.push_str(line);
        cleaned.push('\n');
    }
    cleaned
}

fn classify_single(statement: &str) -> StatementClass {
    let cleaned = strip_comments(statement);
    let first_word = cleaned
        .trim()
        .split(|char: char| char.is_whitespace() || char == '(')
        .find(|word| !word.is_empty())
        .unwrap_or("")
        .to_ascii_uppercase();

    match first_word.as_str() {
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "USE" | "WITH" => {
            // WITH opens CTEs that normally feed a SELECT; the body is still
            // audited below so a WITH ... INSERT/UPDATE/DELETE is caught.
            audit_with_statement(&cleaned, &first_word)
        }
        _ => StatementClass::Blocked {
            reason: format!(
                "\"{first_word}\" statements are blocked: this connection is read-only. \
                 Only SELECT and read utilities (SHOW/DESCRIBE/EXPLAIN) may run."
            ),
        },
    }
}

/// Second-pass audit: reject write keywords appearing after CTEs or inside
/// otherwise-read-looking statements (SELECT ... FOR UPDATE stays allowed —
/// it reads; SELECT ... INTO writes and is caught by the INTO token).
fn audit_with_statement(cleaned: &str, first_word: &str) -> StatementClass {
    let upper = cleaned.to_ascii_uppercase();
    for keyword in [
        " INSERT ", " UPDATE ", " DELETE ", " MERGE ", " REPLACE ", " INTO ", " CALL ",
        " GRANT ", " REVOKE ", " ALTER ", " DROP ", " CREATE ", " TRUNCATE ", " SET ",
        " LOCK ", " KILL ", " LOAD ", " HANDLER ",
    ] {
        if upper.contains(keyword) {
            return StatementClass::Blocked {
                reason: format!(
                    "This statement contains {0} and is blocked: the connection is read-only.",
                    keyword.trim()
                ),
            };
        }
    }
    let _ = first_word;
    StatementClass::Read
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_read(sql: &str) {
        assert_eq!(classify(sql), StatementClass::Read, "expected read: {sql}");
    }

    fn assert_blocked(sql: &str, needle: &str) {
        match classify(sql) {
            StatementClass::Blocked { reason } => {
                assert!(
                    reason.to_lowercase().contains(&needle.to_lowercase()),
                    "reason \"{reason}\" should mention {needle}"
                );
            }
            StatementClass::Read => panic!("expected blocked: {sql}"),
        }
    }

    #[test]
    fn plain_reads_pass() {
        assert_read("SELECT 1");
        assert_read("  select * from sales.orders where id = 3;");
        assert_read("SHOW TABLES;");
        assert_read("DESCRIBE sales.orders");
        assert_read("DESC orders");
        assert_read("EXPLAIN SELECT * FROM orders");
        assert_read("USE sales; SELECT COUNT(*) FROM orders;");
    }

    #[test]
    fn cte_reads_pass() {
        assert_read(
            "WITH recent AS (SELECT * FROM orders WHERE created_at > '2026-01-01') \
             SELECT COUNT(*) FROM recent",
        );
    }

    #[test]
    fn leading_comments_are_ignored() {
        assert_read("-- grab the count\nSELECT COUNT(*) FROM orders");
        assert_read("/* profiler: run 7 */ select 1");
        assert_read("# mysql hint comment\nSHOW TABLES");
    }

    #[test]
    fn writes_are_blocked() {
        assert_blocked("INSERT INTO orders VALUES (1)", "INSERT");
        assert_blocked("UPDATE orders SET total = 0", "UPDATE");
        assert_blocked("DELETE FROM orders", "DELETE");
        assert_blocked("DROP TABLE orders", "DROP");
        assert_blocked("ALTER TABLE orders ADD COLUMN x INT", "ALTER");
        assert_blocked("CREATE TABLE t (id INT)", "CREATE");
        assert_blocked("TRUNCATE orders", "TRUNCATE");
        assert_blocked("GRANT SELECT ON * TO 'u'", "GRANT");
        assert_blocked("CALL do_stuff()", "CALL");
        assert_blocked("SET GLOBAL innodb_foo = 1", "SET");
    }

    #[test]
    fn writes_hidden_after_leading_comment_are_blocked() {
        assert_blocked("-- just checking\nDROP TABLE orders", "DROP");
        assert_blocked("/* x */ delete from orders", "DELETE");
    }

    #[test]
    fn mixed_batches_reject_on_the_first_write() {
        assert_blocked("SELECT 1; DROP TABLE orders", "DROP");
        assert_blocked("DROP TABLE orders; SELECT 1", "DROP");
    }

    #[test]
    fn writes_inside_cte_are_blocked() {
        assert_blocked(
            "WITH t AS (SELECT 1) INSERT INTO log VALUES (1)",
            "INSERT",
        );
    }

    #[test]
    fn select_into_is_blocked() {
        assert_blocked("SELECT * INTO orders_backup FROM orders", "INTO");
        // MySQL's SELECT ... INTO OUTFILE is also a write-shaped read.
        assert_blocked("SELECT * FROM orders INTO OUTFILE '/tmp/x'", "INTO");
    }

    #[test]
    fn semicolons_inside_strings_do_not_split() {
        assert_read("SELECT * FROM orders WHERE note = 'a;b' ");
        assert_blocked(
            "SELECT * FROM t WHERE note = 'x'; DROP TABLE t",
            "DROP",
        );
    }

    #[test]
    fn empty_statement_is_blocked() {
        assert_blocked(";", "no sql");
        assert_blocked("   ", "no sql");
        assert_blocked("-- only a comment", "no sql");
    }
}
