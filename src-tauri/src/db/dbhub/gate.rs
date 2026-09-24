//! The gate every DBHub SQL execution passes through (design section 8, layer
//! 3): a statement is classified before it is allowed to leave the process, and
//! the connection itself is opened in read-only transaction mode as the second
//! line of defence.
//!
//! Classification and policy are two questions, and this module keeps them
//! apart. `classify` answers only the first — what kind of statement is this —
//! and says nothing about who may run it; that is `GatePolicy`'s business. They
//! used to be one function with the refusal wording ("this connection is
//! read-only") welded into it, which is why a single verdict could not serve a
//! read-only connection, a trusted one, and an AI with a ceiling of its own.
//!
//! The gate is intentionally conservative: a statement the classifier cannot
//! place is refused. Something that only *looks* read-only but embeds a write
//! (`SELECT ... INTO OUTFILE`) is refused too — a caller can rephrase it, a
//! destroyed table cannot be un-rephrased.

/// What a statement *is*, independent of who may run it.
///
/// Ordered by severity, because a run of statements is only as free as its
/// strictest one: a batch holding a `DROP` is a `DROP`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum StatementTier {
    /// A read: safe to run unattended.
    Free,
    /// Changes some data: runnable once a human has confirmed it.
    Confirm,
    /// Structural or whole-table change, or a statement the classifier cannot
    /// place at all. Refused.
    Refuse,
}

/// A statement's tier, and the token that decided it — so a refusal can name
/// what it objected to rather than only that it objected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Classification {
    pub tier: StatementTier,
    /// The write verb, or the statement's first word when the classifier does
    /// not recognise it. Empty for a free read, and for an empty batch.
    pub matched: String,
}

/// Who is asking to run the statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateActor {
    /// The person at the keyboard: the final authority on their own database.
    Human,
    /// The model, through Chat or an external MCP client.
    Ai,
}

/// What the gate decided to do with one statement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GateAction {
    Allow,
    /// Runnable once a human has confirmed it.
    ///
    /// No caller can service this yet — the confirmation surface arrives with
    /// the AI's confirm mode — so nothing produces it in this step. The variant
    /// is here so the policies can be written once, in their final shape,
    /// rather than rewritten when that surface lands.
    Confirm,
    Refuse {
        reason: String,
    },
}

/// Who is running, and how far this connection lets them go.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GatePolicy {
    pub actor: GateActor,
    /// Whether this connection may be written to at all. Off is the default
    /// everywhere, and the AI's paths never turn it on.
    pub writable: bool,
}

impl GatePolicy {
    /// A read-only connection's policy, for callers with no per-connection
    /// setting to read — Glue/Athena, read-only by nature rather than by
    /// configuration.
    pub fn read_only(actor: GateActor) -> Self {
        Self {
            actor,
            writable: false,
        }
    }

    /// A connection's own workspace: the person typing there, on the terms the
    /// connection was saved with.
    pub fn for_connection(writable: bool) -> Self {
        Self {
            actor: GateActor::Human,
            writable,
        }
    }

    /// Decide what to do with one statement.
    ///
    /// A writable connection allows everything, which is what the old code did
    /// by skipping the gate outright: the person who turned writes on is the
    /// final authority, and the tier ladder is what keeps them *informed*
    /// rather than what stops them. Refusing a `DROP` they asked for is a
    /// decision this policy does not make.
    pub fn decide(&self, classification: Classification) -> GateDecision {
        let action = if self.writable {
            GateAction::Allow
        } else {
            match classification.tier {
                StatementTier::Free => GateAction::Allow,
                StatementTier::Confirm | StatementTier::Refuse => GateAction::Refuse {
                    reason: refusal_reason(self.actor, &classification),
                },
            }
        };
        GateDecision {
            action,
            tier: classification.tier,
            matched: classification.matched,
            session_writable: self.writable,
            actor: self.actor,
        }
    }
}

/// The gate's ruling on one statement: what to do, and what it was looking at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GateDecision {
    pub action: GateAction,
    pub tier: StatementTier,
    /// The token that decided the tier, for the refusal message and the audit.
    pub matched: String,
    /// Whether the statement runs on a session opened for writing.
    ///
    /// Deliberately *not* the same question as "allowed": a free read on a
    /// writable connection is allowed either way, and it is the connection's
    /// own setting that decides the session — not the statement's tier. Carried
    /// on the decision so the execution path reads it from one place instead of
    /// re-deriving it and risking a disagreement with the gate.
    pub session_writable: bool,
    pub actor: GateActor,
}

/// Why a statement was refused, in the words of the policy that refused it.
fn refusal_reason(actor: GateActor, classification: &Classification) -> String {
    if classification.matched.is_empty() {
        return "No SQL statement to run.".to_string();
    }
    let matched = &classification.matched;
    match classification.tier {
        // Not reached: a free statement is never refused. Spelled out so this
        // stays honest if a tier is ever added and this match is overlooked.
        StatementTier::Free => "The statement was not run.".to_string(),
        StatementTier::Confirm => format!(
            "\"{matched}\" changes data and needs a person to confirm it, which is not \
             available on this path yet."
        ),
        StatementTier::Refuse => match actor {
            GateActor::Human => format!(
                "\"{matched}\" is refused: this connection is read-only. Turn writes on for \
                 this connection to run it."
            ),
            GateActor::Ai => format!(
                "\"{matched}\" is refused: this connection is read-only for the AI, and \
                 changes like this are left for a person to run."
            ),
        },
    }
}

/// Classify one statement for the gate. Handles leading comments and whitespace
/// (a statement may open with `/* */` or `--`), multiple statements (the batch
/// takes the strictest of them), and the read-flavoured utility statements
/// (SHOW/DESCRIBE/EXPLAIN/USE).
pub fn classify(sql: &str) -> Classification {
    let mut worst = Classification {
        tier: StatementTier::Free,
        matched: String::new(),
    };
    let mut found = false;
    for statement in split_statements(sql) {
        found = true;
        let classification = classify_single(&statement);
        // A run is refused as a whole, so it is as strict as its strictest
        // statement. Ties keep the earlier one, so the first statement at a
        // given severity is the one a refusal names.
        if classification.tier > worst.tier {
            worst = classification;
        }
    }
    if !found {
        return Classification {
            tier: StatementTier::Refuse,
            matched: String::new(),
        };
    }
    worst
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

/// The tier a verb opens at, before the statement's body gets a say.
///
/// `None` is a verb the classifier does not place at all — the `Unknown`
/// default, which lands at the strictest tier because the alternative is asking
/// a person to judge a statement the tool itself could not read.
fn tier_for_verb(verb: &str) -> Option<StatementTier> {
    match verb {
        // Reads, safe until the body says otherwise.
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "USE" | "WITH" => {
            Some(StatementTier::Free)
        }
        // Row changes: a person confirms them, unless they turn out to be
        // whole-table changes, which the caller refuses instead.
        "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "REPLACE" => Some(StatementTier::Confirm),
        // A routine's body is invisible to a text classifier, so calling one is
        // a confirmation rather than a free pass — and never a refusal, because
        // a routine that only reads is a routine worth being able to call.
        "CALL" | "EXECUTE" | "DO" => Some(StatementTier::Confirm),
        // Structure, permissions, session, and `INTO` — which is what turns a
        // SELECT into a write. All refused: none of them has a bounded form
        // worth distinguishing, and several cannot be undone at all.
        "DROP" | "TRUNCATE" | "ALTER" | "RENAME" | "COMMENT" | "CREATE" | "GRANT" | "REVOKE"
        | "SET" | "KILL" | "LOCK" | "LOAD" | "HANDLER" | "INTO" => Some(StatementTier::Refuse),
        _ => None,
    }
}

/// Classify one statement: its tier, and the token that decided it.
fn classify_single(statement: &str) -> Classification {
    let cleaned = strip_comments(statement);
    let verb = first_word(&cleaned);

    let Some(base) = tier_for_verb(&verb) else {
        return Classification {
            tier: StatementTier::Refuse,
            matched: verb,
        };
    };

    // A read-shaped statement is not a read until its body says so. `WITH`
    // opens CTEs that normally feed a SELECT but can feed an INSERT, and
    // `SELECT ... INTO` writes despite opening with the read verb. The verb the
    // audit finds is tiered by the same table, so `WITH ... INSERT` is treated
    // as the insert it is rather than as something stranger.
    if base == StatementTier::Free {
        return match first_write_token(&cleaned) {
            Some(token) => Classification {
                tier: tier_for_verb(&token).unwrap_or(StatementTier::Refuse),
                matched: token,
            },
            None => Classification {
                tier: StatementTier::Free,
                matched: String::new(),
            },
        };
    }

    // The line between "confirm this" and "refuse this" for a row change: does
    // it bound itself at all? `DELETE FROM t` is a whole-table delete wearing a
    // row change's clothes, and the score of rows it would take is not a thing
    // a text classifier can count.
    //
    // It is a heuristic, and the design says so out loud: `DELETE FROM t WHERE
    // 1 = 1` carries a WHERE and reads as bounded while removing everything.
    // The confirm dialog is where that limit is admitted to the reader, because
    // the honest answer to "how many rows?" is that this cannot tell.
    if base == StatementTier::Confirm
        && matches!(verb.as_str(), "UPDATE" | "DELETE")
        && !has_top_level_where(&cleaned)
    {
        return Classification {
            tier: StatementTier::Refuse,
            matched: format!("{verb} without WHERE"),
        };
    }

    Classification {
        tier: base,
        matched: verb,
    }
}

/// The first write keyword in the statement's code, if any.
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
/// `SELECT ... FOR UPDATE` is caught now; it used to slip past on the trailing
/// newline `strip_comments` appends. That is the honest verdict rather than a
/// regression: the statement takes row locks, and a read-only session refuses
/// it at the wire anyway, so it never ran on the connections this gate guards.
fn first_write_token(cleaned: &str) -> Option<String> {
    code_words(cleaned)
        .into_iter()
        .find_map(|(word, _)| is_write_keyword(&word).then_some(word))
}

/// The statement's words, each with the parenthesis depth it sits at, skipping
/// everything that is data rather than code: string literals, quoted
/// identifiers and comments.
///
/// One walk answers both things the gate asks of the code — which words are
/// there, and whether `WHERE` appears at the top level — because telling data
/// from code is the same job either way.
///
/// A word is a run of identifier characters, so `INTO(` yields `INTO` while
/// `into_backup` does not: a keyword is matched as a word, never as a fragment
/// of a longer name.
fn code_words(statement: &str) -> Vec<(String, usize)> {
    let chars: Vec<char> = statement.chars().collect();
    let mut words = Vec::new();
    let mut depth = 0usize;
    let mut index = 0;

    while index < chars.len() {
        match chars[index] {
            // A value, or a name in quotes. Neither is code.
            '\'' | '"' | '`' => index = skip_quoted(&chars, index, chars[index]),
            // `--` and MySQL's `#` run to the end of the line.
            '-' if chars.get(index + 1) == Some(&'-') => index = skip_to_line_end(&chars, index),
            '#' => index = skip_to_line_end(&chars, index),
            '/' if chars.get(index + 1) == Some(&'*') => index = skip_block_comment(&chars, index),
            '(' => {
                depth += 1;
                index += 1;
            }
            ')' => {
                depth = depth.saturating_sub(1);
                index += 1;
            }
            current if is_word_char(current) => {
                let start = index;
                while index < chars.len() && is_word_char(chars[index]) {
                    index += 1;
                }
                words.push((
                    chars[start..index]
                        .iter()
                        .collect::<String>()
                        .to_ascii_uppercase(),
                    depth,
                ));
            }
            _ => index += 1,
        }
    }

    words
}

/// Whether the statement bounds itself with a `WHERE` of its own.
///
/// Top-level on purpose: a `WHERE` inside a subquery does not narrow the
/// statement around it, so `UPDATE t SET x = (SELECT y FROM z WHERE a = 1)` is
/// still a whole-table update and must not read as a bounded one. Depth is
/// counted from the statement's opening, so a `WHERE` after the last `)` — the
/// ordinary shape — is the one that counts.
fn has_top_level_where(statement: &str) -> bool {
    code_words(statement)
        .iter()
        .any(|(word, depth)| *depth == 0 && word == "WHERE")
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

    /// A read-only connection's ruling on `sql` — the configuration these tests
    /// are about. `classify` answers only what the statement is; the reason a
    /// refusal carries is the policy's to write, so a test that wants to read
    /// one has to go through a policy to get it.
    fn ruling(sql: &str) -> GateDecision {
        GatePolicy::read_only(GateActor::Human).decide(classify(sql))
    }

    fn assert_read(sql: &str) {
        assert_eq!(
            classify(sql).tier,
            StatementTier::Free,
            "expected a free read: {sql}"
        );
    }

    fn assert_blocked(sql: &str, needle: &str) {
        match ruling(sql).action {
            GateAction::Refuse { reason } => {
                assert!(
                    reason.to_lowercase().contains(&needle.to_lowercase()),
                    "reason \"{reason}\" should mention {needle}"
                );
            }
            other => panic!("expected a refusal for {sql}, got {other:?}"),
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

    #[test]
    fn a_read_only_connection_allows_reads_and_refuses_the_rest() {
        let policy = GatePolicy::read_only(GateActor::Human);
        assert_eq!(
            policy.decide(classify("SELECT 1")).action,
            GateAction::Allow
        );
        assert!(matches!(
            policy.decide(classify("DELETE FROM t")).action,
            GateAction::Refuse { .. }
        ));
    }

    #[test]
    fn a_writable_connection_allows_everything() {
        // What the old code did by skipping the gate outright. The person who
        // turned writes on is the final authority, so the ladder informs them
        // rather than stopping them — including at the strictest tier.
        let policy = GatePolicy::for_connection(true);
        for sql in [
            "SELECT 1",
            "DELETE FROM t",
            "DROP TABLE t",
            "ALTER TABLE t ADD COLUMN x INT",
            "wibble wobble",
        ] {
            assert_eq!(
                policy.decide(classify(sql)).action,
                GateAction::Allow,
                "a writable connection should allow {sql}"
            );
        }
    }

    #[test]
    fn a_writable_decision_opens_a_writable_session() {
        // The session follows the connection, not the statement's tier: an
        // allowed read on a writable connection still dials writable, exactly
        // as it did when the flag was passed straight through.
        let decision = GatePolicy::for_connection(true).decide(classify("SELECT 1"));
        assert_eq!(decision.action, GateAction::Allow);
        assert_eq!(decision.tier, StatementTier::Free);
        assert!(decision.session_writable);

        // And a read-only connection never does, however free the statement.
        let decision = GatePolicy::read_only(GateActor::Human).decide(classify("SELECT 1"));
        assert!(!decision.session_writable);
    }

    #[test]
    fn the_ai_is_told_to_hand_the_statement_to_a_person() {
        // The two actors get different advice because their next step differs:
        // a person can turn writes on, the model cannot and should say who can.
        let ai = GatePolicy::read_only(GateActor::Ai).decide(classify("DROP TABLE t"));
        let GateAction::Refuse { reason } = ai.action else {
            panic!("the AI's ceiling must refuse DDL");
        };
        assert!(reason.contains("left for a person"), "{reason}");

        let human = ruling("DROP TABLE t");
        let GateAction::Refuse { reason } = human.action else {
            panic!("DDL is refused by default");
        };
        assert!(reason.contains("Turn writes on"), "{reason}");
        assert_eq!(human.actor, GateActor::Human);
    }

    #[test]
    fn a_batch_is_as_strict_as_its_strictest_statement() {
        // The refusal names the statement that earned it, not the first one in
        // the batch — a run is refused as a whole, so what it is refused *for*
        // has to be something actually in it.
        assert_blocked("SELECT 1; DROP TABLE t", "DROP");
        assert_blocked("DROP TABLE t; SELECT 1", "DROP");
        // Reaching it through a read-shaped statement still lands on the verb.
        assert_blocked("SELECT 1; SELECT * INTO x FROM t", "INTO");
    }

    #[test]
    fn a_free_statement_never_carries_a_refusal() {
        // A free read has no token to name and no reason to give. Pinned so a
        // tier added later cannot leave a stray reason on the free path.
        let decision = ruling("SELECT 1");
        assert_eq!(decision.action, GateAction::Allow);
        assert!(decision.matched.is_empty());
        assert_eq!(decision.tier, StatementTier::Free);
    }

    #[test]
    fn a_bounded_row_change_asks_for_confirmation() {
        for sql in [
            "INSERT INTO orders VALUES (1)",
            "UPDATE orders SET total = 0 WHERE id = 3",
            "DELETE FROM orders WHERE id = 3",
            "REPLACE INTO orders VALUES (1)",
            "MERGE INTO orders USING staging ON orders.id = staging.id",
            // A routine's body is invisible to a text classifier, so calling
            // one is a confirmation rather than a free pass.
            "CALL rebuild_indexes()",
            // Leading with WITH does not change what it is.
            "WITH stale AS (SELECT id FROM orders WHERE old) DELETE FROM orders WHERE id IN (SELECT id FROM stale)",
        ] {
            assert_eq!(classify(sql).tier, StatementTier::Confirm, "{sql}");
        }
    }

    #[test]
    fn an_unbounded_row_change_is_refused() {
        // The line the design draws between "confirm this" and "refuse this":
        // a row change that never says which rows is a whole-table change.
        for sql in [
            "DELETE FROM orders",
            "delete from orders",
            "UPDATE orders SET total = 0",
        ] {
            assert_eq!(classify(sql).tier, StatementTier::Refuse, "{sql}");
            assert!(
                classify(sql).matched.contains("without WHERE"),
                "the refusal should say why: {sql}"
            );
        }
        assert_blocked("DELETE FROM orders", "delete without where");
    }

    #[test]
    fn a_subquery_where_does_not_bound_the_statement_around_it() {
        // Top-level only. The WHERE below belongs to the subquery, so the
        // UPDATE is still every row — and reading it as bounded would hand a
        // person a confirmation dialog for a whole-table change.
        assert_eq!(
            classify("UPDATE t SET x = (SELECT y FROM z WHERE a = 1)").tier,
            StatementTier::Refuse
        );
        // The ordinary shape — WHERE after the closing paren — still counts.
        assert_eq!(
            classify("UPDATE t SET x = (SELECT y FROM z) WHERE id = 1").tier,
            StatementTier::Confirm
        );
    }

    #[test]
    fn the_whole_table_rule_reads_code_not_values() {
        // It is the same scan, so a value naming a whole-table delete does not
        // trip it — the bug that started this work.
        assert_read("SELECT * FROM audit WHERE note = 'DELETE FROM orders'");
        assert_read("SELECT * FROM t WHERE body = 'UPDATE t SET x = 1'");
    }

    #[test]
    fn a_batch_takes_the_strictest_tier_it_holds() {
        // Now that two non-free tiers exist, a batch has to climb past Confirm
        // to Refuse rather than stopping at the first non-free statement.
        assert_eq!(
            classify("DELETE FROM t WHERE id = 1").tier,
            StatementTier::Confirm
        );
        assert_eq!(
            classify("DELETE FROM t WHERE id = 1; DROP TABLE t").tier,
            StatementTier::Refuse
        );
        assert_eq!(
            classify("INSERT INTO t VALUES (1); DELETE FROM t WHERE id = 1").tier,
            StatementTier::Confirm
        );
    }

    #[test]
    fn a_confirmed_statement_runs_only_where_confirmation_exists() {
        // Which is nowhere, for every caller in the tree today: a read-only
        // connection refuses the tier, and a writable one allows it outright
        // without asking. The tier is visible before it is actionable.
        let sql = "DELETE FROM orders WHERE id = 3";
        assert_eq!(classify(sql).tier, StatementTier::Confirm);
        assert!(matches!(
            GatePolicy::read_only(GateActor::Human)
                .decide(classify(sql))
                .action,
            GateAction::Refuse { .. }
        ));
        assert_eq!(
            GatePolicy::for_connection(true)
                .decide(classify(sql))
                .action,
            GateAction::Allow
        );
    }
}
