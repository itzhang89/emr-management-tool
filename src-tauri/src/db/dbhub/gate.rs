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
    parts
        .into_iter()
        .filter(|part| !strip_comments(part).trim().is_empty())
        .collect()
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
            while index + 1 < chars.len() && !(chars[index] == '*' && chars[index + 1] == '/') {
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

/// The statement's first real word, uppercased.
fn first_word(cleaned: &str) -> String {
    cleaned
        .trim()
        .split(|char: char| char.is_whitespace() || char == '(')
        .find(|word| !word.is_empty())
        .unwrap_or("")
        .to_ascii_uppercase()
}

/// The one statement's text when it is a single SELECT-shaped statement that
/// can be wrapped in a derived table, else `None`.
///
/// Reading a later page means re-running the statement with an offset, which
/// means wrapping it: `select * from (<sql>) as page limit n offset m`. That
/// is only valid for a statement that produces a result set — `SHOW TABLES`
/// and `DESCRIBE` are not subqueries — and only when there is exactly one of
/// them, since the wrapper holds a single statement.
pub fn pageable_statement(sql: &str) -> Option<String> {
    let statements = split_statements(sql);
    if statements.len() != 1 {
        return None;
    }
    let cleaned = strip_comments(&statements[0]);
    match first_word(&cleaned).as_str() {
        "SELECT" | "WITH" => Some(cleaned.trim().trim_end_matches(';').trim().to_string()),
        _ => None,
    }
}

/// Whether a statement may have changed what the catalogue lists.
///
/// Only the DDL verbs: `insert` and `update` move rows, not tables, and the
/// tree shows tables. Checked across the whole batch, so a run that creates
/// and then fills a table still counts.
pub fn changes_schema(sql: &str) -> bool {
    split_statements(sql).iter().any(|statement| {
        let cleaned = strip_comments(statement);
        matches!(
            first_word(&cleaned).as_str(),
            "CREATE" | "ALTER" | "DROP" | "TRUNCATE" | "RENAME" | "COMMENT"
        )
    })
}

fn classify_single(statement: &str) -> StatementClass {
    let cleaned = strip_comments(statement);
    let first_word = first_word(&cleaned);

    match first_word.as_str() {
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "USE" | "WITH" => {
            // WITH opens CTEs that normally feed a SELECT; the body is still
            // audited below so a WITH ... INSERT/UPDATE/DELETE is caught.
            audit_with_statement(&cleaned)
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
/// otherwise-read-looking statements.
///
/// The scan reads the statement's *code* — the words outside string literals,
/// quoted identifiers and comments — and it matches whole words. Matching the
/// raw text had a bug in each direction:
///
/// * A value was read as code. `where note = 'please DROP this row'` contains
///   ` DROP `, so a query against a table storing SQL text — a templates table
///   is the ordinary case — was refused as a write.
/// * A keyword beside punctuation was missed. The check wanted a space on both
///   sides, so a newline where that space was expected carried `INTO` straight
///   past it: `SELECT * INTO\nOUTFILE '/tmp/x'` was allowed through.
///
/// `SELECT ... FOR UPDATE` is refused now; it used to slip past on the trailing
/// newline `strip_comments` appends. That is the honest verdict rather than a
/// regression: the statement takes row locks, and a read-only session refuses
/// it at the wire anyway, so it never ran on the connections this gate guards.
fn audit_with_statement(cleaned: &str) -> StatementClass {
    match first_write_token(cleaned) {
        Some(token) => StatementClass::Blocked {
            reason: format!(
                "This statement contains {token} and is blocked: the connection is read-only."
            ),
        },
        None => StatementClass::Read,
    }
}

/// The first write keyword in the statement's code, if any.
fn first_write_token(cleaned: &str) -> Option<String> {
    code_tokens(cleaned)
        .into_iter()
        .find(|token| is_write_keyword(token))
}

/// The statement's words, skipping everything that is data rather than code:
/// string literals, quoted identifiers and comments.
///
/// A word is a run of identifier characters, so `INTO(` yields `INTO` while
/// `into_backup` does not — a keyword is matched as a word, never as a fragment
/// of a longer name.
fn code_tokens(statement: &str) -> Vec<String> {
    let chars: Vec<char> = statement.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;

    while index < chars.len() {
        match chars[index] {
            // A value, or a name in quotes. Neither is code.
            '\'' | '"' | '`' => index = skip_quoted(&chars, index, chars[index]),
            // `--` and MySQL's `#` run to the end of the line.
            '-' if chars.get(index + 1) == Some(&'-') => index = skip_to_line_end(&chars, index),
            '#' => index = skip_to_line_end(&chars, index),
            '/' if chars.get(index + 1) == Some(&'*') => index = skip_block_comment(&chars, index),
            current if is_word_char(current) => {
                let start = index;
                while index < chars.len() && is_word_char(chars[index]) {
                    index += 1;
                }
                tokens.push(
                    chars[start..index]
                        .iter()
                        .collect::<String>()
                        .to_ascii_uppercase(),
                );
            }
            _ => index += 1,
        }
    }

    tokens
}

/// Identifier characters, so a keyword is never found inside a longer name.
fn is_word_char(current: char) -> bool {
    current.is_alphanumeric() || current == '_' || current == '$'
}

/// Step past a quoted run, starting on its opening quote.
///
/// A doubled quote escapes a quote and so does not end the literal. A backslash
/// deliberately does *not* escape: MySQL reads `\'` as a quote inside the value,
/// but honouring that would let a backslash swallow the remainder of the
/// statement — any write keyword with it — so the scan treats a backslash as an
/// ordinary character and errs toward seeing code. The cost is a false positive
/// on a value that both contains `\'` and names a write verb: rare, and it
/// fails closed.
///
/// An unterminated literal runs to the end, which is also where the statement
/// stops being readable as one.
fn skip_quoted(chars: &[char], start: usize, quote: char) -> usize {
    let mut index = start + 1;
    while index < chars.len() {
        if chars[index] == quote {
            if chars.get(index + 1) == Some(&quote) {
                index += 2;
                continue;
            }
            return index + 1;
        }
        index += 1;
    }
    chars.len()
}

fn skip_to_line_end(chars: &[char], start: usize) -> usize {
    let mut index = start;
    while index < chars.len() && chars[index] != '\n' {
        index += 1;
    }
    index
}

fn skip_block_comment(chars: &[char], start: usize) -> usize {
    let mut index = start + 2;
    while index + 1 < chars.len() {
        if chars[index] == '*' && chars[index + 1] == '/' {
            return index + 2;
        }
        index += 1;
    }
    chars.len()
}

/// The verbs that make a statement more than a read. `INTO` is here because it
/// is what turns a `SELECT` into a write (`SELECT ... INTO OUTFILE`).
fn is_write_keyword(token: &str) -> bool {
    matches!(
        token,
        "INSERT"
            | "UPDATE"
            | "DELETE"
            | "MERGE"
            | "REPLACE"
            | "INTO"
            | "CALL"
            | "GRANT"
            | "REVOKE"
            | "ALTER"
            | "DROP"
            | "CREATE"
            | "TRUNCATE"
            | "SET"
            | "LOCK"
            | "KILL"
            | "LOAD"
            | "HANDLER"
    )
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
        assert_blocked("WITH t AS (SELECT 1) INSERT INTO log VALUES (1)", "INSERT");
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
        assert_blocked("SELECT * FROM t WHERE note = 'x'; DROP TABLE t", "DROP");
    }

    #[test]
    fn only_a_lone_select_can_be_paged() {
        // Wrappable: one statement producing a result set.
        assert_eq!(
            pageable_statement("SELECT * FROM orders").as_deref(),
            Some("SELECT * FROM orders")
        );
        assert!(pageable_statement("WITH t AS (SELECT 1) SELECT * FROM t").is_some());
        // The trailing semicolon must not ride into the wrapper.
        assert_eq!(
            pageable_statement("SELECT 1; ").as_deref(),
            Some("SELECT 1")
        );

        // No result set to wrap: these are not subqueries.
        assert!(pageable_statement("SHOW TABLES").is_none());
        assert!(pageable_statement("DESCRIBE orders").is_none());
        assert!(pageable_statement("EXPLAIN SELECT 1").is_none());

        // The wrapper holds exactly one statement.
        assert!(pageable_statement("SELECT 1; SELECT 2").is_none());
        assert!(pageable_statement("-- nothing\n").is_none());
    }

    #[test]
    fn only_ddl_counts_as_a_schema_change() {
        assert!(changes_schema("CREATE TABLE t (id INT)"));
        assert!(changes_schema("drop table orders"));
        assert!(changes_schema("ALTER TABLE t ADD COLUMN x INT"));
        assert!(changes_schema("TRUNCATE orders"));
        // Rows are not structure.
        assert!(!changes_schema("INSERT INTO orders VALUES (1)"));
        assert!(!changes_schema("UPDATE orders SET total = 0"));
        assert!(!changes_schema("DELETE FROM orders"));
        assert!(!changes_schema("SELECT * FROM orders"));
        // One DDL anywhere in the batch is enough.
        assert!(changes_schema("SELECT 1; DROP TABLE orders"));
    }

    #[test]
    fn empty_statement_is_blocked() {
        assert_blocked(";", "no sql");
        assert_blocked("   ", "no sql");
        assert_blocked("-- only a comment", "no sql");
    }

    #[test]
    fn write_keywords_inside_values_are_not_writes() {
        // A value is data, not SQL. A table holding SQL text — a templates
        // table is the ordinary case — has to stay queryable.
        assert_read("SELECT * FROM t WHERE note = 'please DROP this row'");
        assert_read("SELECT 'a INTO b' AS x");
        assert_read("SELECT * FROM templates WHERE body = 'INSERT INTO audit VALUES (1)'");
        assert_read("SELECT * FROM t WHERE msg = 'we will CALL you'");
        // A doubled quote escapes a quote, so the literal stays open across it
        // and the verb after it is still inside the value.
        assert_read("SELECT 'it''s fine to DELETE this' AS x");
    }

    #[test]
    fn write_keywords_inside_comments_are_not_writes() {
        assert_read("-- DROP TABLE orders\nSELECT 1");
        assert_read("# DELETE FROM orders\nSELECT 1");
        assert_read("/* UPDATE orders SET x = 1 */ SELECT 1");
        // A trailing comment, which `strip_comments` leaves in place — the
        // token scan is what keeps it from being read as a verb.
        assert_read("SELECT 1 -- DROP TABLE orders");
    }

    #[test]
    fn quoted_identifiers_are_not_keywords() {
        assert_read("SELECT \"delete\" FROM t");
        assert_read("SELECT `insert` FROM t");
        assert_read("SELECT * FROM t AS `update`");
    }

    #[test]
    fn a_keyword_inside_a_longer_name_is_not_a_keyword() {
        assert_read("SELECT into_backup, insert_log FROM t");
        assert_read("SELECT * FROM settings");
        assert_read("SELECT updated_at, created_at FROM t");
    }

    #[test]
    fn a_keyword_beside_punctuation_is_still_caught() {
        // What the old space-delimited check missed: anything putting a newline
        // or a bracket where it wanted a space.
        assert_blocked("SELECT * INTO\nOUTFILE '/tmp/x' FROM orders", "INTO");
        assert_blocked("SELECT * FROM orders INTO(OUTFILE)", "INTO");
        assert_blocked("WITH t AS (SELECT 1)\nINSERT INTO log VALUES (1)", "INSERT");
    }

    #[test]
    fn a_backslash_does_not_hide_code_from_the_scan() {
        // MySQL would read `\'` as an escaped quote and keep the literal open,
        // which would swallow the DROP below. The scan deliberately reads a
        // backslash as an ordinary character so it cannot be used that way;
        // the cost is a false positive on values that both contain `\'` and
        // name a write verb.
        assert_blocked("SELECT 'it\\'s DROP TABLE t' AS x", "DROP");
    }

    #[test]
    fn select_for_update_is_refused() {
        // It takes row locks, and a read-only session refuses it at the wire
        // anyway — so the gate says so first rather than relying on the stray
        // trailing newline that used to let it through.
        assert_blocked("SELECT * FROM t FOR UPDATE", "UPDATE");
    }
}
