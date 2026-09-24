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

// The tier and the override map are persisted connection settings, so they live
// in `models` — a leaf module this one already depends on, and one that must not
// depend on this. Re-exported because they are the gate's own vocabulary: a
// caller reasoning about a ruling should not have to know where the vocabulary
// is stored.
pub use crate::models::{GateActor, GateOverrides, StatementTier};

/// A statement's tier, and the token that decided it — so a refusal can name
/// what it objected to rather than only that it objected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Classification {
    pub tier: StatementTier,
    /// The write verb, or the statement's first word when the classifier does
    /// not recognise it. Empty for a free read, and for an empty batch.
    pub matched: String,
    /// The verb the statement opens with, uppercased. What a verb-keyed
    /// override matches on — kept apart from `matched`, which names whatever
    /// decided the tier and may be a verb found later in the body.
    pub verb: String,
    /// The routine a `CALL`/`EXECUTE`/`DO` names, when it names one. What a
    /// name-keyed override matches on, and only ever set for a routine — a
    /// `DROP TABLE sp_x` has no routine, so no name override can re-tier it.
    pub routine: Option<String>,
}

impl Classification {
    /// A classification of nothing at all, which is where the batch walk and
    /// the empty-statement path both start.
    fn none() -> Self {
        Self {
            tier: StatementTier::Free,
            matched: String::new(),
            verb: String::new(),
            routine: None,
        }
    }

    /// The same classification with another tier, keeping what named it — an
    /// override changes the tier, not the statement being talked about.
    fn retiered(mut self, tier: StatementTier) -> Self {
        self.tier = tier;
        self
    }

    /// The same classification with another deciding token, for the one case
    /// where the statement's shape names what was wrong with it.
    fn with_matched(mut self, matched: impl Into<String>) -> Self {
        self.matched = matched.into();
        self
    }

    /// A statement with a known verb and a named deciding token.
    fn of(tier: StatementTier, matched: impl Into<String>, verb: impl Into<String>) -> Self {
        Self {
            tier,
            matched: matched.into(),
            verb: verb.into(),
            routine: None,
        }
    }
}

/// What the gate decided to do with one statement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GateAction {
    Allow,
    /// Runnable once a person has said so.
    ///
    /// Carries what to tell them: a prompt with no explanation is a prompt
    /// nobody can answer well, and the reason differs by tier — a row change and
    /// a dropped table are not the same question.
    Confirm {
        reason: String,
    },
    Refuse {
        reason: String,
    },
}

/// How far an actor may go when the ladder says a statement changes data.
///
/// Kept apart from *who* is asking, because the two compose: a person and an AI
/// arrive at `ReadOnly` by different roads and the action that follows is the
/// same one. It is the policy's job to say which road, and this is the answer
/// both roads end at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reach {
    /// Reads run; anything that changes data is refused.
    ReadOnly,
    /// Reads run; a change is put to a person before it runs.
    Confirm,
    /// Reads and row changes run; a structural change is put to a person first.
    ///
    /// The person who turned writes on meant it, and asking about every row
    /// change would make the switch useless. Structure is the tier where being
    /// asked is worth the interruption — it is the one that cannot be undone.
    Writable,
    /// Reads and row changes run; a structural change is refused.
    ///
    /// The AI's `free` mode. It differs from `Writable` by exactly the tier that
    /// leaves the AI's hands: a person may talk themselves through dropping a
    /// table, and the model may not — that statement is handed to a person
    /// instead, which is the design's first iron rule.
    Unattended,
}

/// Who is running, and how far this connection lets them go.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatePolicy {
    pub actor: GateActor,
    pub reach: Reach,
    /// This connection's own changes to the ladder, if it has any.
    pub overrides: GateOverrides,
    /// The account's changes, which apply to every connection in it.
    ///
    /// A separate layer rather than merged into `overrides`, because merging
    /// cannot express what the layers mean: two globs from different layers can
    /// both match one name, and "whichever survived the merge" is not an answer
    /// anyone can predict. Kept apart, the rule is the one a reader expects —
    /// the connection's own setting beats the account's.
    pub global_overrides: GateOverrides,
}

impl GatePolicy {
    /// A read-only connection's policy, for callers with no per-connection
    /// setting to read — Glue/Athena, read-only by nature rather than by
    /// configuration.
    pub fn read_only(actor: GateActor) -> Self {
        Self {
            actor,
            reach: Reach::ReadOnly,
            overrides: GateOverrides::new(),
            global_overrides: GateOverrides::new(),
        }
    }

    /// A connection's own workspace: the person typing there, on the terms the
    /// connection was saved with.
    pub fn for_connection(writable: bool) -> Self {
        Self {
            actor: GateActor::Human,
            reach: if writable {
                Reach::Writable
            } else {
                Reach::ReadOnly
            },
            overrides: GateOverrides::new(),
            global_overrides: GateOverrides::new(),
        }
    }

    /// The policy an AI runs under on a connection in `mode`.
    ///
    /// `Free` reaches `Unattended`, which is what the mode is for: the model may
    /// change data on a connection its owner has explicitly put in that mode.
    /// It is not `Writable` — the structural tier stays out of the model's hands
    /// in every mode, which is the design's first iron rule and the one thing
    /// the modes do not vary.
    pub fn for_ai(mode: crate::models::DbReadOnlyPolicy) -> Self {
        use crate::models::DbReadOnlyPolicy;
        let reach = match mode {
            DbReadOnlyPolicy::Observer => Reach::ReadOnly,
            DbReadOnlyPolicy::Confirm => Reach::Confirm,
            DbReadOnlyPolicy::Free => Reach::Unattended,
        };
        Self {
            actor: GateActor::Ai,
            reach,
            overrides: GateOverrides::new(),
            global_overrides: GateOverrides::new(),
        }
    }

    /// The same policy, with this connection's own changes to the ladder.
    pub fn with_overrides(mut self, overrides: GateOverrides) -> Self {
        self.overrides = overrides;
        self
    }

    /// The same policy, with the account's changes underneath them.
    pub fn with_global_overrides(mut self, overrides: GateOverrides) -> Self {
        self.global_overrides = overrides;
        self
    }

    /// Decide what to do with one statement.
    ///
    /// | reach | free | confirm | refuse |
    /// |---|---|---|---|
    /// | read-only | allow | refuse | refuse |
    /// | confirm | allow | confirm | refuse |
    /// | writable | allow | allow | allow |
    ///
    /// A `Writable` reach allows even the refusals, which is what the old code
    /// did by skipping the gate outright: the person who turned writes on is the
    /// final authority, and refusing a `DROP` they asked for is a decision this
    /// policy does not make. The design does want them *told* — a confirmation
    /// for a change and a heavier one for a `DROP` — and that arrives with the
    /// dialog, because turning those into prompts today would refuse every write
    /// a writable connection makes.
    pub fn decide(&self, classification: Classification) -> GateDecision {
        let (classification, overridden_by) = self.apply_overrides(classification);
        let action = match classification.tier {
            // A read is a read wherever it runs: nothing here refuses one.
            StatementTier::Free => GateAction::Allow,
            StatementTier::Confirm => match self.reach {
                Reach::ReadOnly => GateAction::Refuse {
                    reason: refusal_reason(self.actor, &classification, overridden_by.as_deref()),
                },
                Reach::Confirm => GateAction::Confirm {
                    reason: confirm_reason(classification.tier, &classification.matched),
                },
                // A person who turned writes on, and an AI whose connection was
                // put in free mode, both mean it: a row change runs.
                Reach::Writable | Reach::Unattended => GateAction::Allow,
            },
            StatementTier::Refuse => match self.reach {
                Reach::ReadOnly | Reach::Confirm | Reach::Unattended => GateAction::Refuse {
                    reason: refusal_reason(self.actor, &classification, overridden_by.as_deref()),
                },
                // The one tier a person may talk themselves through, because it
                // is the one that cannot be undone. The AI is refused it above
                // and the statement is handed over instead.
                Reach::Writable => GateAction::Confirm {
                    reason: confirm_reason(classification.tier, &classification.matched),
                },
            },
        };
        GateDecision {
            action,
            tier: classification.tier,
            matched: classification.matched,
            session_writable: matches!(self.reach, Reach::Writable | Reach::Unattended),
            actor: self.actor,
            overridden_by,
        }
    }

    /// Move the statement to the tier this connection gives its verb or
    /// routine, and say which key did it.
    ///
    /// An override is the only place anything can *loosen* the ladder, so the
    /// matching is narrow on purpose:
    ///
    /// * A **name** key applies only to a routine, and only to the routine the
    ///   statement calls. `sp_rebuild_index: free` makes `CALL sp_rebuild_index()`
    ///   free and leaves `DROP TABLE sp_rebuild_index` a `DROP` — the difference
    ///   between "this procedure is safe to call" and "this name is safe to
    ///   write anywhere".
    /// * A **verb** key applies only when that verb is what decided the tier.
    ///   `TRUNCATE: confirm` re-tiers `TRUNCATE t` and nothing else — a `DELETE`
    ///   whose column happens to be named truncate is untouched, because the key
    ///   is compared to the verb, not searched for in the text.
    ///
    /// Two orderings decide which rule wins when more than one could apply, and
    /// both are chosen to be the answer a person would give:
    ///
    /// 1. **Layer before namespace.** The connection's own rules are consulted
    ///    first and entirely; the account's only speak where the connection is
    ///    silent. "My rule for this database wins" is a sentence, and "the merge
    ///    kept one of them" is not.
    /// 2. **Name before verb, then specificity.** Within a layer, a routine's own
    ///    name is a narrower statement than its verb, and among keys of one
    ///    namespace an exact key beats a glob and a longer glob beats a shorter —
    ///    the intuition that makes `etl_load` feel more specific than `etl_*`.
    fn apply_overrides(&self, classification: Classification) -> (Classification, Option<String>) {
        for layer in [&self.overrides, &self.global_overrides] {
            if layer.is_empty() {
                continue;
            }
            if let Some(routine) = classification.routine.as_deref() {
                if let Some((key, tier)) = best_match(layer, routine) {
                    return (classification.retiered(tier), Some(key));
                }
            }
            if let Some((key, tier)) = best_match(layer, &classification.verb) {
                return (classification.retiered(tier), Some(key));
            }
        }
        (classification, None)
    }
}

/// The most specific key in one layer that matches `name`.
///
/// Specificity rather than iteration order, because two globs can both match and
/// "whichever the map happened to yield first" is not something a user can
/// predict from what they typed. An exact key beats any glob; among globs the
/// longer pattern wins. The key itself breaks a remaining tie, so the answer is
/// stable rather than dependent on how the map was built.
fn best_match(layer: &GateOverrides, name: &str) -> Option<(String, StatementTier)> {
    let mut matches: Vec<(&String, StatementTier)> = layer
        .iter()
        // A key of `*` alone is refused where rules are written; obeying one
        // found here would loosen everything at once. Ignored, like every other
        // defensive read in this module.
        .filter(|(key, _)| key.trim() != "*" && glob_matches(key, name))
        .map(|(key, tier)| (key, *tier))
        .collect();

    matches.sort_by(|(a, _), (b, _)| {
        specificity(b).cmp(&specificity(a)).then_with(|| a.cmp(b))
    });
    matches
        .first()
        .map(|(key, tier)| ((*key).clone(), *tier))
}

/// How narrow a key is. An exact key is narrower than any glob, and a longer
/// pattern narrower than a shorter one — which is as much of an ordering as a
/// glob language has.
fn specificity(pattern: &str) -> (bool, usize) {
    let is_exact = !pattern.contains('*') && !pattern.contains('?');
    (is_exact, pattern.trim().len())
}

/// Whether a pattern matches a name: `*` for any run of characters, `?` for one.
///
/// Anchored at both ends — the whole name has to match. Unanchored matching
/// would make `o*` hit everything containing an `o`, which is not a behaviour
/// anyone can reason about, and this pattern decides what may run.
///
/// Case-insensitive, because a routine named `ETL_Rebuild` is the same routine
/// as `etl_rebuild` and the caller should not have to care which they typed.
fn glob_matches(pattern: &str, name: &str) -> bool {
    let pattern: Vec<char> = pattern.trim().to_ascii_uppercase().chars().collect();
    let name: Vec<char> = name.to_ascii_uppercase().chars().collect();

    let (mut p, mut n) = (0usize, 0usize);
    // Where the last `*` was, and how much of the name it had consumed when we
    // passed it: the backtracking pair that makes this linear rather than
    // exponential.
    let (mut star, mut star_name) = (None, 0usize);

    while n < name.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
            p += 1;
            n += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some(p);
            star_name = n;
            p += 1;
        } else if let Some(star_at) = star {
            // The `*` was allowed to match one more character than we assumed.
            p = star_at + 1;
            star_name += 1;
            n = star_name;
        } else {
            return false;
        }
    }

    // Trailing `*`s match the empty remainder; anything else means the name ran
    // out first.
    while p < pattern.len() && pattern[p] == '*' {
        p += 1;
    }
    p == pattern.len()
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
    /// The connection's own rule that set this tier, when one did. Named so a
    /// refusal can say the connection decided it rather than the ladder.
    pub overridden_by: Option<String>,
}

impl GateDecision {
    /// The same decision once a person has said yes.
    ///
    /// Only a caller that actually asked may call this, and only the command
    /// knows whether one did — the answer arrives from the WebView after a
    /// dialog. `execute` keeps refusing a bare `Confirm`, so a policy that
    /// raises one on a path with no way to ask still fails closed rather than
    /// quietly running what it was unsure about.
    pub fn confirmed(mut self) -> Self {
        if matches!(self.action, GateAction::Confirm { .. }) {
            self.action = GateAction::Allow;
        }
        self
    }
}

/// What the gate tells a person it is asking about.
///
/// The confirming tier admits what the classifier cannot know, which the design
/// promised it would: this reads a statement's shape, and a shape has no row
/// count in it. Saying so is better than a dialog that looks like it checked.
fn confirm_reason(tier: StatementTier, matched: &str) -> String {
    match tier {
        StatementTier::Refuse => format!(
            "\"{matched}\" changes structure or removes data. This cannot be undone."
        ),
        // Not reached for a free statement: nothing asks about a read.
        StatementTier::Free | StatementTier::Confirm => format!(
            "\"{matched}\" changes data. This tool cannot tell how many rows it would affect."
        ),
    }
}

/// Why a statement was refused, in the words of the policy that refused it.
fn refusal_reason(
    actor: GateActor,
    classification: &Classification,
    overridden_by: Option<&str>,
) -> String {
    // Only an empty batch has nothing to name. A free read carries no `matched`
    // of its own — nothing in its body made it more than a read — but it still
    // has a verb, and an override that re-tiers it has to be able to say so
    // rather than report that there was no statement.
    if classification.verb.is_empty() && classification.matched.is_empty() {
        return "No SQL statement to run.".to_string();
    }
    let named = if classification.matched.is_empty() {
        &classification.verb
    } else {
        &classification.matched
    };
    let matched = named;
    // A connection that has ruled on a verb or a routine has said something
    // about *this* statement, and the message should quote that rather than
    // recite the default ladder's reasoning back at them.
    if let Some(key) = overridden_by {
        return format!(
            "\"{matched}\" is refused by this connection's rule for \"{key}\", which needs a \
             person to run it."
        );
    }
    // What the statement does, said plainly. It is the same for a read and a
    // write up to the point where one of them cannot be undone.
    let what = match classification.tier {
        StatementTier::Refuse => "changes structure or removes data",
        _ => "changes data",
    };

    match actor {
        // A person reading this is looking at their own connection, so the
        // message is the one thing they can act on. It is *not* "a confirmation
        // is unavailable": they are the person a confirmation would be put to,
        // and the switch below is what is actually in the way.
        GateActor::Human => format!(
            "\"{matched}\" {what}. This connection is read-only — turn writes on for it to run."
        ),
        GateActor::Ai => match classification.tier {
            StatementTier::Refuse => format!(
                "\"{matched}\" {what}, which is left for a person to run on this connection."
            ),
            // The model can act on this one, and it is told what to say: the
            // reach is a setting its reader can change, so the answer is a next
            // step rather than a wall.
            _ => format!(
                "\"{matched}\" {what}, and this connection's AI is set to read only. Tell the \
                 user to run it in the connection's query tab, or to put the connection in \
                 confirm mode."
            ),
        },
    }
}

/// Classify one statement for the gate. Handles leading comments and whitespace
/// (a statement may open with `/* */` or `--`), multiple statements (the batch
/// takes the strictest of them), and the read-flavoured utility statements
/// (SHOW/DESCRIBE/EXPLAIN/USE).
pub fn classify(sql: &str) -> Classification {
    let mut worst: Option<Classification> = None;
    for statement in split_statements(sql) {
        let classification = classify_single(&statement);
        worst = Some(match worst {
            // The first statement seeds the batch, so its verb is what a
            // verb-keyed override sees even when the whole batch is free.
            None => classification,
            // A run is refused as a whole, so it is as strict as its strictest
            // statement. Ties keep the earlier one, so the first statement at a
            // given severity is the one a refusal names.
            Some(current) if classification.tier > current.tier => classification,
            Some(current) => current,
        });
    }
    worst.unwrap_or_else(|| Classification::none().retiered(StatementTier::Refuse))
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

/// Every verb the ladder places, with the tier it opens at.
///
/// One table rather than a `match`, because a second reader exists: the rules
/// editor shows a connection's defaults grouped by tier, and it has to be the
/// *same* list the classifier uses or the two drift and the editor starts
/// describing a gate that no longer exists.
///
/// The tier here is the one a statement *opens* at. `UPDATE` and `DELETE` are
/// refined afterwards — one with no top-level `WHERE` is a whole-table change
/// and is refused rather than confirmed — so this table alone is not the whole
/// verdict for those two.
const VERB_TIERS: &[(&str, StatementTier)] = &[
    // Reads, safe until the body says otherwise: the body is audited next for
    // `WITH ... INSERT` and `SELECT ... INTO`.
    ("SELECT", StatementTier::Free),
    ("SHOW", StatementTier::Free),
    ("DESCRIBE", StatementTier::Free),
    ("DESC", StatementTier::Free),
    ("EXPLAIN", StatementTier::Free),
    ("USE", StatementTier::Free),
    ("WITH", StatementTier::Free),
    // Row changes: a person confirms them, unless they turn out to be
    // whole-table changes.
    ("INSERT", StatementTier::Confirm),
    ("UPDATE", StatementTier::Confirm),
    ("DELETE", StatementTier::Confirm),
    ("MERGE", StatementTier::Confirm),
    ("REPLACE", StatementTier::Confirm),
    // A routine's body is invisible to a text classifier, so calling one is a
    // confirmation rather than a free pass — and never a refusal, because a
    // routine that only reads is worth being able to call.
    ("CALL", StatementTier::Confirm),
    ("EXECUTE", StatementTier::Confirm),
    ("DO", StatementTier::Confirm),
    // Structure, permissions, session, and `INTO` — which is what turns a
    // SELECT into a write. All refused: none has a bounded form worth
    // distinguishing, and several cannot be undone at all.
    ("DROP", StatementTier::Refuse),
    ("TRUNCATE", StatementTier::Refuse),
    ("ALTER", StatementTier::Refuse),
    ("RENAME", StatementTier::Refuse),
    ("COMMENT", StatementTier::Refuse),
    ("CREATE", StatementTier::Refuse),
    ("GRANT", StatementTier::Refuse),
    ("REVOKE", StatementTier::Refuse),
    ("SET", StatementTier::Refuse),
    ("KILL", StatementTier::Refuse),
    ("LOCK", StatementTier::Refuse),
    ("LOAD", StatementTier::Refuse),
    ("HANDLER", StatementTier::Refuse),
    ("INTO", StatementTier::Refuse),
];

/// The ladder as a reader sees it: every verb and the tier it opens at, for the
/// rules editor to group.
pub fn default_ladder() -> &'static [(&'static str, StatementTier)] {
    VERB_TIERS
}

/// The tier a verb opens at, or `None` for a verb the classifier does not place
/// at all — the `Unknown` default, which lands at the strictest tier because the
/// alternative is asking a person to judge a statement the tool could not read.
fn tier_for_verb(verb: &str) -> Option<StatementTier> {
    VERB_TIERS
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(verb))
        .map(|(_, tier)| *tier)
}

/// The routine a statement calls: the identifier right after its opening verb.
///
/// Quoted or bare, because both name the same routine —
/// ``CALL `sp x`(...)`` and `CALL sp_x(...)` are the same call with different
/// punctuation. Only ever asked of a statement whose verb is a routine verb, so
/// the verb is known to be the first word.
fn routine_after_verb(cleaned: &str) -> Option<String> {
    let chars: Vec<char> = cleaned.chars().collect();
    let mut index = 0;

    // The verb.
    while index < chars.len() && is_word_char(chars[index]) {
        index += 1;
    }
    // Whatever separates it from the name.
    while index < chars.len() && !is_word_char(chars[index]) && chars[index] != '`' {
        if matches!(chars[index], '\'' | '"') {
            return None;
        }
        index += 1;
    }
    if index >= chars.len() {
        return None;
    }

    if chars[index] == '`' {
        let end = skip_quoted(&chars, index, '`');
        // `skip_quoted` lands past the closing backtick, so the name is what it
        // wrapped; an unterminated quote yielded the rest of the statement,
        // which is as much of a name as there is.
        let inner: String = chars[index + 1..end.saturating_sub(1).max(index + 1)]
            .iter()
            .collect();
        return (!inner.is_empty()).then_some(inner);
    }

    let start = index;
    while index < chars.len() && is_word_char(chars[index]) {
        index += 1;
    }
    (start < index).then(|| chars[start..index].iter().collect())
}

/// Classify one statement: its tier, and the token that decided it.
fn classify_single(statement: &str) -> Classification {
    let cleaned = strip_comments(statement);
    let verb = first_word(&cleaned);

    let Some(base) = tier_for_verb(&verb) else {
        return Classification::of(StatementTier::Refuse, verb.clone(), verb);
    };

    let mut classification = Classification::of(base, verb.clone(), verb.clone());

    // A read-shaped statement is not a read until its body says so. `WITH`
    // opens CTEs that normally feed a SELECT but can feed an INSERT, and
    // `SELECT ... INTO` writes despite opening with the read verb. The verb the
    // audit finds is tiered by the same table, so `WITH ... INSERT` is treated
    // as the insert it is rather than as something stranger.
    if base == StatementTier::Free {
        if let Some(token) = first_write_token(&cleaned) {
            let tier = tier_for_verb(&token).unwrap_or(StatementTier::Refuse);
            return Classification::of(tier, token, verb);
        }
        // Nothing in the body made it more than a read, so nothing names it.
        // `verb` still says what it was, which is what an override that
        // re-tiers the statement will need to name it in turn.
        return classification.with_matched(String::new());
    }

    // What a routine call names, for a name-keyed override to match. Recorded
    // only for routines: a `DROP TABLE sp_x` mentions the same name and must
    // never be re-tiered by it.
    if matches!(verb.as_str(), "CALL" | "EXECUTE" | "DO") {
        classification.routine = routine_after_verb(&cleaned);
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
        let matched = format!("{verb} without WHERE");
        return classification
            .retiered(StatementTier::Refuse)
            .with_matched(matched);
    }

    classification
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

/// A statement with its values masked: a literal becomes `?`, comments are
/// dropped, and runs of whitespace collapse to one space.
///
/// Both kinds of literal are masked — a single-quoted string and a bare number —
/// because a rule keys on neither, and `WHERE id = 3` and `WHERE id = 99` are
/// one statement to a rule. That is what makes the log a count rather than a
/// wall of near-identical rows.
///
/// This is what the refusal log stores, and it is deliberately not the original
/// text the design first called for. A literal is where the customer ids and the
/// email addresses are, and nothing a rule can be built from lives inside one:
/// keys are verbs and routine names, and both are code — `CALL etl_load(?)` names
/// the routine just as well as `CALL etl_load('2026-01-01')` does.
///
/// A quoted *name* is kept, unquoted — Postgres spells identifiers `"like this"`
/// and MySQL spells them `` `like this` ``, and both are the routine name a rule
/// would be keyed on. Masking those would erase the one thing this log exists to
/// provide. It costs nothing the query history does not already store.
pub fn masked_statement(sql: &str) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let mut out = String::with_capacity(sql.len());
    let mut index = 0;
    let mut space_pending = false;

    while index < chars.len() {
        let piece = match chars[index] {
            // A value in every dialect, and the only thing masked.
            '\'' => {
                index = skip_quoted(&chars, index, '\'');
                "?".to_string()
            }
            quote @ ('"' | '`') => {
                let end = skip_quoted(&chars, index, quote);
                // `skip_quoted` lands past a closing quote, or at the end of an
                // unterminated one — which has no closing quote to drop.
                let closed = end > index + 1 && chars.get(end - 1) == Some(&quote);
                let last = if closed { end - 1 } else { end };
                let name: String = chars[index + 1..last].iter().collect();
                index = end;
                name
            }
            '-' if chars.get(index + 1) == Some(&'-') => {
                index = skip_to_line_end(&chars, index);
                " ".to_string()
            }
            '#' => {
                index = skip_to_line_end(&chars, index);
                " ".to_string()
            }
            '/' if chars.get(index + 1) == Some(&'*') => {
                index = skip_block_comment(&chars, index);
                " ".to_string()
            }
            // A bare number is a value as much as a quoted string is: `id = 3`
            // and `id = 99` are one statement to a rule, and the count is the
            // point of this log. Only when it stands alone — the digits in `t1`
            // or `col2` are part of a name, and masking those would erase code.
            digit if digit.is_ascii_digit() => {
                let inside_name = !space_pending && out.chars().last().is_some_and(is_word_char);
                let start = index;
                while index < chars.len() && (chars[index].is_ascii_digit() || chars[index] == '.')
                {
                    index += 1;
                }
                let runs_on = chars.get(index).is_some_and(|next| is_word_char(*next));
                if inside_name || runs_on {
                    chars[start..index].iter().collect()
                } else {
                    "?".to_string()
                }
            }
            current => {
                index += 1;
                current.to_string()
            }
        };
        for character in piece.chars() {
            if character.is_whitespace() {
                // Collapsed rather than dropped, so `select  *  from` and
                // `select * from` are the same key.
                space_pending = !out.is_empty();
            } else {
                if space_pending {
                    out.push(' ');
                    space_pending = false;
                }
                out.push(character);
            }
        }
    }

    out
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
    fn a_writable_connection_runs_changes_and_is_asked_about_structure() {
        // Turning writes on is a decision, and asking about every row change
        // would make the switch useless. Structure is where the interruption
        // earns itself: it is the tier that cannot be undone.
        let policy = GatePolicy::for_connection(true);

        for sql in [
            "SELECT 1",
            "DELETE FROM t WHERE id = 1",
            "UPDATE t SET x = 1 WHERE id = 1",
        ] {
            assert_eq!(
                policy.decide(classify(sql)).action,
                GateAction::Allow,
                "a writable connection runs {sql}"
            );
        }

        for sql in [
            "DROP TABLE t",
            "ALTER TABLE t ADD COLUMN x INT",
            // A delete that names no rows is a whole-table delete, so it is the
            // structural tier however it is spelled.
            "DELETE FROM t",
            // A verb the classifier cannot place is treated as the strictest
            // tier, so the person is told the tool does not recognise it rather
            // than it being waved through as harmless.
            "wibble wobble",
        ] {
            assert!(
                matches!(
                    policy.decide(classify(sql)).action,
                    GateAction::Confirm { .. }
                ),
                "a writable connection should ask about {sql}"
            );
        }
    }

    #[test]
    fn the_warning_says_which_kind_of_change_it_is() {
        // A dropped table and a row change are not the same question, and the
        // confirming tier admits what the classifier cannot know — the design
        // promised it would rather than let a dialog look like it checked.
        let policy = GatePolicy::for_connection(true);

        let dropping = policy.decide(classify("DROP TABLE t")).action;
        let GateAction::Confirm { reason } = dropping else {
            panic!("a DROP is asked about");
        };
        assert!(reason.contains("cannot be undone"), "{reason}");

        // A change is not asked about at this reach, so nothing says how many
        // rows — the row-count wording belongs to the reach that does ask.
        assert_eq!(
            policy.decide(classify("DELETE FROM t WHERE id = 1")).action,
            GateAction::Allow
        );
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
        // And it says the structural tier cannot be undone, which is why it is
        // the tier no mode reaches.
        assert!(reason.contains("removes data"), "{reason}");

        let human = ruling("DROP TABLE t");
        let GateAction::Refuse { reason } = human.action else {
            panic!("DDL is refused by default");
        };
        assert!(reason.contains("turn writes on"), "{reason}");
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

    /// A read-only connection that has ruled on some of its own commands, which
    /// is how an overridden connection arrives here.
    fn ruling_with(overrides: &[(&str, StatementTier)], sql: &str) -> GateDecision {
        let map = overrides
            .iter()
            .map(|(key, tier)| ((*key).to_string(), *tier))
            .collect();
        GatePolicy::read_only(GateActor::Human)
            .with_overrides(map)
            .decide(classify(sql))
    }

    #[test]
    fn a_verb_override_retiers_only_that_verb() {
        // This staging database clears its tables as a matter of routine, so
        // TRUNCATE is a confirmation here rather than a refusal.
        let decision = ruling_with(&[("TRUNCATE", StatementTier::Confirm)], "TRUNCATE staging");
        assert_eq!(decision.tier, StatementTier::Confirm);
        assert_eq!(decision.overridden_by.as_deref(), Some("TRUNCATE"));
        // The override moved the tier; the policy still decides the action, and
        // a read-only connection refuses a confirmation either way.
        assert!(matches!(decision.action, GateAction::Refuse { .. }));

        // A DROP is untouched even though the word appears in the statement,
        // because the key is compared to the verb rather than searched for.
        let drop = ruling_with(
            &[("TRUNCATE", StatementTier::Confirm)],
            "DROP TABLE truncate_log",
        );
        assert_eq!(drop.tier, StatementTier::Refuse);
        assert!(drop.overridden_by.is_none());
    }

    #[test]
    fn a_verb_override_can_loosen_a_statement_to_free() {
        // The direction that carries the risk: this database says calling its
        // procedures is safe, so a read-only connection runs one.
        let decision = ruling_with(&[("CALL", StatementTier::Free)], "CALL rebuild_index()");
        assert_eq!(decision.tier, StatementTier::Free);
        assert_eq!(decision.action, GateAction::Allow);
    }

    #[test]
    fn a_routine_name_override_applies_to_its_call_and_nothing_else() {
        let overrides = [("sp_rebuild_index", StatementTier::Free)];

        let call = ruling_with(&overrides, "CALL sp_rebuild_index()");
        assert_eq!(call.tier, StatementTier::Free);
        assert_eq!(call.action, GateAction::Allow);
        assert_eq!(call.overridden_by.as_deref(), Some("sp_rebuild_index"));

        // The property the whole narrow-matching rule exists for: the same name
        // in a DROP is still a DROP. A name override says "calling this is
        // fine", never "this name is safe to write anywhere".
        let drop = ruling_with(&overrides, "DROP TABLE sp_rebuild_index");
        assert_eq!(drop.tier, StatementTier::Refuse);
        assert!(drop.overridden_by.is_none());

        // Nor does it reach a bounded write that merely mentions the name.
        let delete = ruling_with(&overrides, "DELETE FROM sp_rebuild_index WHERE id = 1");
        assert_eq!(delete.tier, StatementTier::Confirm);
        assert!(delete.overridden_by.is_none());
    }

    #[test]
    fn a_quoted_routine_name_matches_the_bare_one() {
        // Both spellings name the same routine, so an override has to see both
        // — otherwise the rule would depend on how the caller punctuated it.
        let overrides = [("sp_rebuild_index", StatementTier::Free)];
        for sql in [
            "CALL sp_rebuild_index()",
            "CALL `sp_rebuild_index`()",
            "call SP_REBUILD_INDEX()",
        ] {
            assert_eq!(
                ruling_with(&overrides, sql).tier,
                StatementTier::Free,
                "{sql}"
            );
        }
    }

    #[test]
    fn an_override_that_tightens_names_what_it_refused() {
        // A free statement carries no `matched` of its own, so the message has
        // to fall back to the verb. Without that it would tell a reader who
        // refused SELECT that there was no statement to run.
        let decision = ruling_with(&[("SELECT", StatementTier::Refuse)], "SELECT 1");
        let GateAction::Refuse { reason } = decision.action else {
            panic!("the override refused it");
        };
        assert!(reason.contains("SELECT"), "{reason}");
        assert!(!reason.contains("No SQL statement"), "{reason}");
        assert!(reason.contains("this connection's rule"), "{reason}");
    }

    #[test]
    fn a_connection_with_no_overrides_is_the_plain_ladder() {
        // The empty map is the default everywhere, so this is the path every
        // existing connection takes.
        let plain = GatePolicy::read_only(GateActor::Human);
        assert!(plain.overrides.is_empty());
        for sql in ["SELECT 1", "DELETE FROM t", "DROP TABLE t", "CALL f()"] {
            let with = plain.decide(classify(sql));
            assert_eq!(with.tier, classify(sql).tier, "{sql}");
            assert!(with.overridden_by.is_none(), "{sql}");
        }
    }

    #[test]
    fn an_empty_batch_has_nothing_for_an_override_to_match() {
        // No verb, so no key applies however permissive the map is — and the
        // statement is still refused for being empty.
        let decision = ruling_with(&[("SELECT", StatementTier::Free)], "   ");
        assert_eq!(decision.tier, StatementTier::Refuse);
        assert!(matches!(decision.action, GateAction::Refuse { .. }));
    }

    #[test]
    fn a_routine_call_that_names_nothing_still_confirms() {
        // `CALL` with no name has no routine to match, so a name override
        // cannot reach it and the ladder's answer stands.
        let decision = ruling_with(&[("sp_x", StatementTier::Free)], "CALL");
        assert_eq!(decision.tier, StatementTier::Confirm);
        assert!(decision.overridden_by.is_none());
    }

    #[test]
    fn a_glob_covers_a_family_of_routines() {
        // Why globs are here at all: a database with forty `etl_*` procedures
        // should not need forty rules.
        let overrides = [("etl_*", StatementTier::Free)];
        for sql in ["CALL etl_rebuild_idx()", "CALL ETL_load_daily()"] {
            assert_eq!(
                ruling_with(&overrides, sql).tier,
                StatementTier::Free,
                "{sql}"
            );
        }
    }

    #[test]
    fn a_glob_is_anchored_at_both_ends() {
        // A name that merely *contains* the prefix is not a match. Unanchored
        // matching would make `o*` reach everything holding an `o`, which is not
        // a behaviour anyone can reason about — and this pattern decides what
        // may run.
        let overrides = [("etl_*", StatementTier::Free)];
        let other = ruling_with(&overrides, "CALL my_etl_job()");
        assert_eq!(other.tier, StatementTier::Confirm);
        assert!(
            other.overridden_by.is_none(),
            "the glob must not have matched"
        );
    }

    #[test]
    fn a_question_mark_matches_exactly_one_character() {
        let overrides = [("sp_?", StatementTier::Free)];
        assert_eq!(
            ruling_with(&overrides, "CALL sp_x()").tier,
            StatementTier::Free
        );
        assert_eq!(
            ruling_with(&overrides, "CALL sp_xy()").tier,
            StatementTier::Confirm
        );
    }

    #[test]
    fn a_glob_does_not_turn_a_verb_key_into_a_text_search() {
        // The key is still compared to the verb, not hunted for in the text.
        let overrides = [("TRUNC*", StatementTier::Confirm)];
        assert_eq!(
            ruling_with(&overrides, "TRUNCATE t").tier,
            StatementTier::Confirm
        );
        assert!(ruling_with(&overrides, "DROP TABLE truncate_log")
            .overridden_by
            .is_none());
    }

    #[test]
    fn a_bare_star_is_ignored_however_it_got_there() {
        // Writing a rule of `*` is refused at the point of writing it. If a row
        // holds one anyway — hand-edited, or from another version — obeying it
        // would loosen every statement at once, which is the one thing an
        // override must never do by accident. Ignored, like every other
        // defensive read here.
        let overrides = [("*", StatementTier::Free)];
        for sql in ["SELECT 1", "DROP TABLE t", "CALL etl_x()"] {
            assert!(
                ruling_with(&overrides, sql).overridden_by.is_none(),
                "{sql} must not be re-tiered by a bare star"
            );
        }
        assert!(matches!(
            ruling_with(&overrides, "DROP TABLE t").action,
            GateAction::Refuse { .. }
        ));
    }

    #[test]
    fn the_default_ladder_is_the_classifiers_own_table() {
        // The rules editor groups a connection's rules by tier by reading this,
        // so it has to agree with what the classifier actually does. One table,
        // two readers — this is the test that keeps them one.
        for (verb, tier) in default_ladder() {
            let sql = match *verb {
                // `INTO` is never a first word: it is the token that turns a
                // SELECT into a write, and the audit is what finds it.
                "INTO" => "SELECT * INTO backup FROM t",
                // The two the table only *opens* for. Without a WHERE they fall
                // to Refuse, a refinement a flat table cannot express.
                "UPDATE" => "UPDATE t SET x = 1 WHERE id = 1",
                "DELETE" => "DELETE FROM t WHERE id = 1",
                other => other,
            };
            assert_eq!(
                classify(sql).tier,
                *tier,
                "the ladder says {verb} opens at {tier:?}"
            );
        }
    }

    #[test]
    fn masking_keeps_the_shape_and_drops_the_values() {
        assert_eq!(
            masked_statement("SELECT * FROM t WHERE id = 'abc'"),
            "SELECT * FROM t WHERE id = ?"
        );
        // Whitespace collapses, so two spellings of one statement share a key.
        assert_eq!(masked_statement("select  *\n  from   t"), "select * from t");
        // Comments are not part of the statement, and a comment is a fine place
        // to leave something private.
        assert_eq!(masked_statement("SELECT 1 -- call me on 555\n"), "SELECT ?");
        assert_eq!(
            masked_statement("/* drop the temp table */ SELECT 1"),
            "SELECT ?"
        );
        // Digits that are part of a name stay: `t1` is code, and masking it
        // would erase which table was named.
        assert_eq!(
            masked_statement("SELECT * FROM t1 WHERE c2 = 3"),
            "SELECT * FROM t1 WHERE c2 = ?"
        );
        // A doubled quote is an escape and does not end the literal early.
        assert_eq!(masked_statement("SELECT 'it''s'"), "SELECT ?");
    }

    #[test]
    fn masking_a_name_keeps_the_name() {
        // The one thing the log exists to provide is the routine to key a rule
        // on, and a quoted identifier is still that name — masking it as if it
        // were a value would erase exactly what the log is for.
        assert_eq!(
            masked_statement("CALL `etl_rebuild`()"),
            "CALL etl_rebuild()"
        );
        assert_eq!(
            masked_statement("CALL \"etl_rebuild\"()"),
            "CALL etl_rebuild()"
        );
        // An unterminated quote has no closing quote to drop.
        assert_eq!(masked_statement("CALL `etl_rebuild"), "CALL etl_rebuild");
    }

    #[test]
    fn two_runs_of_a_statement_differing_only_in_values_share_a_key() {
        // This is what makes the log a count rather than a wall of repeats, and
        // it is the masking that does it.
        let a = masked_statement("DELETE FROM orders WHERE id = 3").to_ascii_uppercase();
        let b = masked_statement("delete from orders where id = 99").to_ascii_uppercase();
        assert_eq!(a, b);
        assert_eq!(a, "DELETE FROM ORDERS WHERE ID = ?");
    }

    /// A read-only policy with a connection layer and an account layer.
    fn layered(
        connection: &[(&str, StatementTier)],
        global: &[(&str, StatementTier)],
        sql: &str,
    ) -> GateDecision {
        let map = |entries: &[(&str, StatementTier)]| -> GateOverrides {
            entries
                .iter()
                .map(|(key, tier)| ((*key).to_string(), *tier))
                .collect()
        };
        GatePolicy::read_only(GateActor::Human)
            .with_overrides(map(connection))
            .with_global_overrides(map(global))
            .decide(classify(sql))
    }

    #[test]
    fn the_connections_own_rules_beat_the_accounts() {
        // Both layers have an opinion and they disagree. The narrower setting is
        // the more deliberate one, and "my rule for this database wins" is a
        // sentence a user can hold in their head.
        let decision = layered(
            &[("TRUNCATE", StatementTier::Refuse)],
            &[("TRUNCATE", StatementTier::Free)],
            "TRUNCATE t",
        );
        assert_eq!(decision.tier, StatementTier::Refuse);
        assert_eq!(decision.overridden_by.as_deref(), Some("TRUNCATE"));
    }

    #[test]
    fn the_accounts_rules_speak_where_the_connection_is_silent() {
        let decision = layered(&[], &[("TRUNCATE", StatementTier::Confirm)], "TRUNCATE t");
        assert_eq!(decision.tier, StatementTier::Confirm);
        assert_eq!(decision.overridden_by.as_deref(), Some("TRUNCATE"));

        // And a connection rule about something else does not silence them.
        let decision = layered(
            &[("DROP", StatementTier::Confirm)],
            &[("TRUNCATE", StatementTier::Confirm)],
            "TRUNCATE t",
        );
        assert_eq!(decision.tier, StatementTier::Confirm);
    }

    #[test]
    fn a_routines_own_name_beats_its_verb() {
        // Within one layer, naming a routine is a narrower statement than naming
        // the verb it is called with: `etl_load` says something about one
        // procedure, `CALL` says something about all of them.
        let decision = layered(
            &[("CALL", StatementTier::Refuse), ("etl_load", StatementTier::Free)],
            &[],
            "CALL etl_load()",
        );
        assert_eq!(decision.tier, StatementTier::Free);
        assert_eq!(decision.overridden_by.as_deref(), Some("etl_load"));

        // The verb still speaks for a routine nothing names.
        let other = layered(
            &[("CALL", StatementTier::Refuse), ("etl_load", StatementTier::Free)],
            &[],
            "CALL something_else()",
        );
        assert_eq!(other.tier, StatementTier::Refuse);
    }

    #[test]
    fn the_more_specific_key_wins() {
        // Two keys in one layer can both match, and map order is not something a
        // user can predict from what they typed.
        let exact = layered(
            &[("etl_*", StatementTier::Refuse), ("etl_load", StatementTier::Free)],
            &[],
            "CALL etl_load()",
        );
        assert_eq!(exact.tier, StatementTier::Free, "an exact key beats a glob");
        assert_eq!(exact.overridden_by.as_deref(), Some("etl_load"));

        let longer = layered(
            &[
                ("etl_*", StatementTier::Refuse),
                ("etl_load_*", StatementTier::Free),
            ],
            &[],
            "CALL etl_load_daily()",
        );
        assert_eq!(
            longer.tier,
            StatementTier::Free,
            "a longer glob beats a shorter one"
        );
        assert_eq!(longer.overridden_by.as_deref(), Some("etl_load_*"));
    }

    #[test]
    fn the_ai_free_mode_changes_data_and_is_still_refused_a_drop() {
        use crate::models::DbReadOnlyPolicy;
        let policy = GatePolicy::for_ai(DbReadOnlyPolicy::Free);

        // What the mode is for.
        let change = policy.decide(classify("DELETE FROM t WHERE id = 1"));
        assert_eq!(change.action, GateAction::Allow);
        // And it needs a session that can carry it out: the driver's read-only
        // mode sits behind the gate, and would refuse at the wire what the gate
        // just allowed — reporting a write the user asked for as a database
        // error from the thing meant to be helping.
        assert!(change.session_writable);

        // The one tier no mode reaches, and refused rather than confirmed so the
        // model is told to hand it to a person instead of waiting for an answer
        // this path cannot collect.
        assert!(matches!(
            policy.decide(classify("DROP TABLE t")).action,
            GateAction::Refuse { .. }
        ));
    }

    #[test]
    fn only_a_person_may_talk_themselves_through_structure() {
        // The difference between `Writable` and `Unattended` is exactly this
        // tier, and it is the whole of the design's first iron rule: a person
        // owns the database and may overrule its advice; the model is handed the
        // statement instead.
        let sql = "DROP TABLE t";

        let human = GatePolicy::for_connection(true).decide(classify(sql));
        assert!(matches!(human.action, GateAction::Confirm { .. }));
        assert_eq!(human.actor, GateActor::Human);

        let ai = GatePolicy::for_ai(crate::models::DbReadOnlyPolicy::Free).decide(classify(sql));
        assert!(matches!(ai.action, GateAction::Refuse { .. }));
        assert_eq!(ai.actor, GateActor::Ai);
    }

    #[test]
    fn a_refusal_names_the_step_its_reader_can_take() {
        // The one message that is easy to get wrong, and did get written wrong
        // once: a person on a read-only connection was told a confirmation "is
        // not available on this path", when a confirmation is exactly what their
        // own dialog does. What is in the way is their write switch, so that is
        // what the message names.
        assert_blocked("DELETE FROM t WHERE id = 1", "turn writes on");

        // The model cannot change a setting, so it is told what to say instead.
        let observing =
            GatePolicy::for_ai(crate::models::DbReadOnlyPolicy::Observer).decide(classify("DELETE FROM t WHERE id = 1"));
        let GateAction::Refuse { reason } = observing.action else {
            panic!("an observer is stopped at the changing tier");
        };
        assert!(reason.contains("confirm mode"), "{reason}");
        assert!(reason.contains("query tab"), "{reason}");
    }

    #[test]
    fn the_reach_table_is_the_designs_matrix() {
        // Actor × tier, as one table, because that is the thing the design
        // specifies and the thing a later change is most likely to break.
        let cases = [
            (Reach::ReadOnly, "SELECT 1", "allow"),
            (Reach::ReadOnly, "DELETE FROM t WHERE id = 1", "refuse"),
            (Reach::ReadOnly, "DROP TABLE t", "refuse"),
            (Reach::Confirm, "SELECT 1", "allow"),
            (Reach::Confirm, "DELETE FROM t WHERE id = 1", "confirm"),
            (Reach::Confirm, "DROP TABLE t", "refuse"),
            // A person who turned writes on means it: row changes run, and the
            // tier that cannot be undone is the one worth interrupting them for.
            (Reach::Writable, "SELECT 1", "allow"),
            (Reach::Writable, "DELETE FROM t WHERE id = 1", "allow"),
            (Reach::Writable, "DROP TABLE t", "confirm"),
            // The AI's free mode is the same shape one tier lower: it runs the
            // change and is refused the structure, which is handed to a person.
            (Reach::Unattended, "SELECT 1", "allow"),
            (Reach::Unattended, "DELETE FROM t WHERE id = 1", "allow"),
            (Reach::Unattended, "DROP TABLE t", "refuse"),
        ];
        for (reach, sql, expected) in cases {
            let policy = GatePolicy {
                actor: GateActor::Human,
                reach,
                overrides: GateOverrides::new(),
                global_overrides: GateOverrides::new(),
            };
            let actual = match policy.decide(classify(sql)).action {
                GateAction::Allow => "allow",
                GateAction::Confirm { .. } => "confirm",
                GateAction::Refuse { .. } => "refuse",
            };
            assert_eq!(actual, expected, "{reach:?} running {sql}");
        }
    }

    #[test]
    fn a_writable_reach_opens_a_writable_session_and_the_others_do_not() {
        // The session follows the reach, not the tier: a writable connection
        // dials writable even for a plain read, exactly as it did when the flag
        // was passed straight through.
        for reach in [Reach::ReadOnly, Reach::Confirm] {
            let policy = GatePolicy {
                actor: GateActor::Human,
                reach,
                overrides: GateOverrides::new(),
                global_overrides: GateOverrides::new(),
            };
            assert!(
                !policy.decide(classify("SELECT 1")).session_writable,
                "{reach:?}"
            );
        }
        // `Unattended` dials writable too, and has to: it is allowed to change
        // data, and the driver's read-only session would refuse it at the wire.
        assert!(
            GatePolicy::for_ai(crate::models::DbReadOnlyPolicy::Free)
                .decide(classify("SELECT 1"))
                .session_writable
        );
        assert!(
            GatePolicy::for_connection(true)
                .decide(classify("SELECT 1"))
                .session_writable
        );
    }

    #[test]
    fn the_ai_modes_land_where_the_design_says() {
        use crate::models::DbReadOnlyPolicy;
        assert_eq!(
            GatePolicy::for_ai(DbReadOnlyPolicy::Observer).reach,
            Reach::ReadOnly
        );
        assert_eq!(
            GatePolicy::for_ai(DbReadOnlyPolicy::Confirm).reach,
            Reach::Confirm
        );
        // `free` is what the mode is for: the model may change data on a
        // connection its owner put in that mode. It is deliberately not
        // `Writable` — the structural tier stays out of its hands.
        assert_eq!(
            GatePolicy::for_ai(DbReadOnlyPolicy::Free).reach,
            Reach::Unattended
        );
    }

    #[test]
    fn an_ai_that_may_confirm_is_still_refused_a_drop() {
        use crate::models::DbReadOnlyPolicy;
        let policy = GatePolicy::for_ai(DbReadOnlyPolicy::Confirm);

        // The tier it may put to a person.
        assert!(matches!(
            policy.decide(classify("DELETE FROM t WHERE id = 1")).action,
            GateAction::Confirm { .. }
        ));
        // The tier it may not, in any mode: structural changes stay a person's
        // to run (the design's first iron rule).
        assert!(matches!(
            policy.decide(classify("DROP TABLE t")).action,
            GateAction::Refuse { .. }
        ));
        // And an AI never dials a writable session, whatever it is allowed.
        assert!(
            !policy
                .decide(classify("DELETE FROM t WHERE id = 1"))
                .session_writable
        );
    }

    #[test]
    fn the_ai_still_cannot_reach_the_ladder_through_an_override() {
        // Overrides are not applied on the AI path (they arrive with the policy
        // that declines them), so the composability question stays open rather
        // than being answered by accident.
        let policy = GatePolicy::for_ai(crate::models::DbReadOnlyPolicy::Confirm);
        assert!(policy.overrides.is_empty());
        assert!(matches!(
            policy.decide(classify("DROP TABLE t")).action,
            GateAction::Refuse { .. }
        ));
    }

    #[test]
    fn a_confirmed_statement_runs_only_where_confirmation_exists() {
        // Which is two places, and neither of them a read-only connection or
        // an AI below free mode: the person's own dialog for the structural
        // tier, and the AI's confirm mode for a row change.
        assert_eq!(
            classify("DELETE FROM orders WHERE id = 3").tier,
            StatementTier::Confirm
        );
        assert!(matches!(
            GatePolicy::read_only(GateActor::Human)
                .decide(classify("DELETE FROM orders WHERE id = 3"))
                .action,
            GateAction::Refuse { .. }
        ));
        // A row change at a writable reach runs: the switch is the decision.
        assert_eq!(
            GatePolicy::for_connection(true)
                .decide(classify("DELETE FROM orders WHERE id = 3"))
                .action,
            GateAction::Allow
        );
        // The structural tier is what a person is asked about.
        assert!(matches!(
            GatePolicy::for_connection(true)
                .decide(classify("DROP TABLE orders"))
                .action,
            GateAction::Confirm { .. }
        ));
    }
}
