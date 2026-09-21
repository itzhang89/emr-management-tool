import type { CellFilter, FilterOperator } from "@/services/dbWorkspaceCache";

/**
 * Reading the filter box as SQL.
 *
 * The box is where conditions live, so what it holds has to become the list the
 * grid filters by. That reading is here, apart from the component, because it
 * has to answer two questions that are not about drawing anything: what does
 * this text mean, and what is the person in the middle of typing.
 *
 * *A small language, on purpose.* `col = 'x' AND col2 > 3`, comparisons joined
 * by AND, with `LIKE` for patterns and `IS [NOT] NULL` for missing values. What
 * it deliberately does *not* take — OR, parentheses, IN, BETWEEN, `>=` — is
 * refused with a message rather than approximated, and the filter that was
 * already applied stays applied. Quietly reading `a OR b` as `a AND b` would
 * narrow the grid to a set of rows the user never asked for, and the rows they
 * did ask for would simply be missing from a table that looks fine.
 *
 * *A refusal is not a state.* Parsing returns either conditions or one
 * sentence saying what is wrong; the caller keeps the last conditions that
 * parsed. So a half-typed expression narrows nothing rather than narrowing to
 * something arbitrary.
 *
 * *What the words mean.* A bare name is matched against the result's columns
 * without regard to case — engines fold identifiers, and the header shows what
 * the engine decided to call the column, not what was typed in the query. A
 * quoted one (double quotes, backticks, square brackets) is taken as written,
 * because that is what quoting is for. A value has to be quoted unless it is a
 * number: `name = alice` is a typo far more often than it is a column, and
 * guessing which would make the box's meaning depend on the data.
 */

/** The text as its pieces, or the first thing about it that cannot be read. */
type Scan = { tokens: Token[] } | { error: string };

type Token =
  | { kind: "name"; text: string; quoted: boolean }
  | { kind: "string"; text: string }
  | { kind: "number"; text: string }
  | { kind: "symbol"; text: string };

export type ParseResult = { terms: CellFilter[] } | { error: string };

/** Said of every token that would widen the question rather than narrow it. */
const AND_ONLY = "conditions are joined with AND, and nothing else";

/**
 * Break the text into the pieces a condition is made of.
 *
 * `lenient` is for the half-finished text in the box: an unclosed string is
 * taken as the string so far rather than refused, because what is being asked
 * of it is only what the caret is in the middle of, and there is no user
 * waiting on a message about a quote they are about to close.
 */
function scan(text: string, lenient: boolean): Scan {
  const tokens: Token[] = [];
  let at = 0;

  /**
   * Reads a run of characters, doubling for the ones that quote themselves —
   * `''` inside a string, `""` inside a name — and says whether it found the
   * closing character before the text ran out.
   */
  const quoted = (close: string) => {
    let value = "";
    at += 1;
    while (at < text.length) {
      const character = text[at]!;
      if (character === close) {
        if (text[at + 1] === close) {
          value += close;
          at += 2;
          continue;
        }
        at += 1;
        return { value, closed: true };
      }
      value += character;
      at += 1;
    }
    return { value, closed: false };
  };

  while (at < text.length) {
    const character = text[at]!;

    if (/\s/.test(character)) {
      at += 1;
      continue;
    }

    if (character === "'") {
      const read = quoted("'");
      if (!read.closed && !lenient) return { error: "The expression has an unclosed string." };
      tokens.push({ kind: "string", text: read.value });
      continue;
    }

    if (character === '"' || character === "`" || character === "[") {
      const close = character === "[" ? "]" : character;
      const read = quoted(close);
      if (!read.closed && !lenient) {
        return { error: `The name opened with ${character} is never closed.` };
      }
      tokens.push({ kind: "name", text: read.value, quoted: true });
      continue;
    }

    if (/[0-9]/.test(character) || (character === "-" && /[0-9]/.test(text[at + 1] ?? ""))) {
      let value = character;
      at += 1;
      while (at < text.length && /[0-9.]/.test(text[at]!)) {
        value += text[at];
        at += 1;
      }
      tokens.push({ kind: "number", text: value });
      continue;
    }

    if (character === "=") {
      tokens.push({ kind: "symbol", text: "=" });
      at += 1;
      continue;
    }

    if (character === ">") {
      const next = text[at + 1] === "=";
      tokens.push({ kind: "symbol", text: next ? ">=" : ">" });
      at += next ? 2 : 1;
      continue;
    }

    if (character === "<") {
      const next = text[at + 1];
      tokens.push({ kind: "symbol", text: next === ">" ? "<>" : next === "=" ? "<=" : "<" });
      at += next === ">" || next === "=" ? 2 : 1;
      continue;
    }

    if (character === "!") {
      if (text[at + 1] !== "=") return { error: 'Unexpected "!" — a not-equal is written <> or !=.' };
      tokens.push({ kind: "symbol", text: "!=" });
      at += 2;
      continue;
    }

    if ("(),;".includes(character)) {
      tokens.push({ kind: "symbol", text: character });
      at += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(character)) {
      let value = "";
      while (at < text.length && /[A-Za-z0-9_$]/.test(text[at]!)) {
        value += text[at];
        at += 1;
      }
      tokens.push({ kind: "name", text: value, quoted: false });
      continue;
    }

    return { error: `Unexpected character "${character}".` };
  }

  return { tokens };
}

/** The column a name refers to, or null when the result has no such column. */
function resolveColumn(columns: string[], token: Token): string | null {
  if (token.kind !== "name") return null;
  if (token.quoted) return columns.includes(token.text) ? token.text : null;
  const lower = token.text.toLowerCase();
  return columns.find((column) => column.toLowerCase() === lower) ?? null;
}

/** One comparison as the condition it means. */
function condition(
  column: string,
  operator: FilterOperator,
  token: Token
): CellFilter | { error: string } {
  if (token.kind === "name" && token.text.toUpperCase() === "NULL") {
    if (operator === "gt" || operator === "lt") {
      return {
        error: `Nothing is greater or less than NULL — write "${column} IS NULL" or "${column} IS NOT NULL".`
      };
    }
    return { column, operator, value: "", isNull: true };
  }
  if (token.kind === "string" || token.kind === "number") {
    return { column, operator, value: token.text, isNull: false };
  }
  return {
    error: `"${column}" was compared with ${token.text} — text values are quoted, as in '${token.text}'.`
  };
}

export function parseFilter(text: string, columns: string[]): ParseResult {
  const scanned = scan(text, false);
  if ("error" in scanned) return scanned;
  const tokens = scanned.tokens;
  const terms: CellFilter[] = [];
  let at = 0;

  /**
   * The loop below is written around this: one call reads exactly one
   * condition, so what is left when it returns is either AND, the end, or
   * something that is neither and therefore has to be named in a message.
   */
  const readCondition = (): { error: string } | null => {
    const name = tokens[at];
    if (!name) return { error: "The expression ends where a column name was expected." };
    if (name.kind === "symbol" && (name.text === "(" || name.text === ")")) {
      return { error: `Parentheses are not supported — ${AND_ONLY}.` };
    }
    if (name.kind !== "name") {
      return { error: `A column name was expected where "${name.text}" is.` };
    }
    if (name.text.toUpperCase() === "OR") {
      return { error: `OR is not supported — ${AND_ONLY}.` };
    }

    const column = resolveColumn(columns, name);
    if (column === null) return { error: `This result has no column named "${name.text}".` };
    at += 1;

    const operator = tokens[at];
    if (!operator) {
      return { error: `"${column}" is not compared with anything.` };
    }

    if (operator.kind === "name") {
      const word = operator.text.toUpperCase();
      if (word === "IS") {
        at += 1;
        const not = tokens[at]?.kind === "name" && tokens[at]!.text.toUpperCase() === "NOT";
        if (not) at += 1;
        const missing = tokens[at];
        if (!(missing?.kind === "name" && missing.text.toUpperCase() === "NULL")) {
          return { error: `Expected NULL after "${column} IS${not ? " NOT" : ""}".` };
        }
        at += 1;
        terms.push({ column, operator: not ? "ne" : "eq", value: "", isNull: true });
        return null;
      }
      if (word === "LIKE") {
        at += 1;
        const pattern = tokens[at];
        if (pattern?.kind !== "string") {
          return { error: `LIKE needs a quoted pattern, as in ${column} LIKE '%value%'.` };
        }
        at += 1;
        terms.push({ column, operator: "like", value: pattern.text, isNull: false });
        return null;
      }
      if (word === "IN" || word === "BETWEEN") {
        return { error: `${word} is not supported — ${AND_ONLY}.` };
      }
      return {
        error: `Expected =, <>, >, <, LIKE or IS NULL after "${column}", found "${operator.text}".`
      };
    }

    if (operator.kind !== "symbol") {
      return { error: `Expected a comparison after "${column}".` };
    }

    const comparison =
      operator.text === "="
        ? "eq"
        : operator.text === "<>" || operator.text === "!="
          ? "ne"
          : operator.text === ">"
            ? "gt"
            : operator.text === "<"
              ? "lt"
              : null;
    if (comparison === null) {
      return {
        error: `"${operator.text}" is not supported — the comparison is =, <>, >, < or LIKE.`
      };
    }

    at += 1;
    const value = tokens[at];
    if (!value) return { error: `"${column} ${operator.text}" has nothing to compare with.` };

    const built = condition(column, comparison, value);
    if ("error" in built) return built;
    at += 1;
    terms.push(built);
    return null;
  };

  while (at < tokens.length) {
    const failure = readCondition();
    if (failure) return failure;
    if (at >= tokens.length) break;

    const separator = tokens[at]!;
    if (separator.kind === "name" && separator.text.toUpperCase() === "AND") {
      at += 1;
      if (at >= tokens.length) return { error: "The expression ends with AND." };
      continue;
    }
    if (separator.kind === "name" && separator.text.toUpperCase() === "OR") {
      return { error: `OR is not supported — ${AND_ONLY}.` };
    }
    return { error: `Conditions are joined with AND — "${separator.text}" is not one.` };
  }

  return { terms };
}

/** What the box is waiting for at the caret. */
export type FilterExpectation = "column" | "operator" | "value" | "null" | "and";

export interface FilterCompletion {
  /** Where the word under the caret starts, so a suggestion replaces all of it. */
  start: number;
  /** How much of that word has been typed. */
  prefix: string;
  expects: FilterExpectation;
}

/** The words that can follow a column name, offered when one is expected. */
const OPERATORS = ["=", "<>", ">", "<", "LIKE", "IS NULL", "IS NOT NULL"];

/**
 * What is being typed at the caret, and what could come next.
 *
 * The word under the caret is found by letters alone, without regard for
 * strings: somebody typing inside `'ab` is offered nothing, because the prefix
 * matches no column and no keyword. Reading the text before it *is* done as the
 * language it is, so `id > ` knows it wants a value while `id ` knows it wants
 * a comparison — the difference between offering columns and offering nothing.
 */
export function completionAt(text: string, caret: number): FilterCompletion {
  const before = text.slice(0, caret);
  const prefix = /[A-Za-z0-9_$]*$/.exec(before)?.[0] ?? "";
  const start = caret - prefix.length;

  const head = scan(text.slice(0, start), true);
  const tokens = "error" in head ? [] : head.tokens;
  return { start, prefix, expects: expectationOf(tokens) };
}

function expectationOf(tokens: Token[]): FilterExpectation {
  const last = tokens[tokens.length - 1];
  if (!last) return "column";
  if (last.kind === "string" || last.kind === "number") return "and";
  if (last.kind === "symbol") {
    return last.text === "(" || last.text === ")" || last.text === "," ? "column" : "value";
  }
  const word = last.text.toUpperCase();
  if (word === "AND") return "column";
  if (word === "IS" || word === "NOT") return "null";
  if (word === "LIKE") return "value";
  if (word === "NULL") return "and";
  // Anything else is a name, which a comparison follows. Whether it names a
  // column or is a value somebody left unquoted is not something this can tell
  // — it has no columns — and does not need to: `suggestionsFor` offers the
  // column names it is given and the keywords after them.
  return "operator";
}

/**
 * What to offer at the caret, most useful first.
 *
 * Columns win over keywords whenever the typed letters could be either. The
 * names come from the result in hand, so a match is always a column that
 * exists; `IS` and `IN` are common enough as the beginnings of real column
 * names that putting the keyword first would fight the user rather than help.
 */
export function suggestionsFor(completion: FilterCompletion, columns: string[]): string[] {
  const { prefix, expects } = completion;
  const starts = (candidate: string) => candidate.toLowerCase().startsWith(prefix.toLowerCase());

  if (expects === "null") return ["NULL", "NOT NULL"].filter(starts);
  if (expects === "and") return ["AND"].filter(starts);
  if (expects === "value") return [];
  if (expects === "column") return columns.filter(starts);

  // An operator is due — but only when nothing is being typed, or what is being
  // typed matches no column: `LI` is `LIKE`, and `le` is `level`.
  const names = prefix === "" ? [] : columns.filter(starts);
  return names.length > 0 ? names : OPERATORS.filter(starts);
}
