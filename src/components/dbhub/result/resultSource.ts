/**
 * What a statement reads from, for the label above the result.
 *
 * This is a scan, not a parser, and it is deliberately allowed to give up. A
 * caption that is occasionally blank costs the reader nothing; a caption that
 * is confidently wrong costs them trust in everything else on the pane. So the
 * rule is narrow: find the first `FROM` that is really the clause, and take the
 * name right after it.
 *
 * The qualifier is kept — `public.orders` rather than `orders` — because the
 * qualifier is exactly what tells two same-named tables apart, and the label is
 * truncated from the left, so the qualifier is the part that stays readable on
 * a narrow pane.
 *
 * Nothing comes back for a statement with no `FROM` (`SELECT 1`) or one whose
 * `FROM` is a subquery: there is no object to name in either case.
 */

/** Comments and string literals, so a `FROM` inside one is not read as the clause. */
const NOISE = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g;

/** One name, bare or quoted: `orders`, `"orders"`, `` `orders` ``, `[orders]`. */
const NAME = "[`\"\\[]?[\\w$]+[`\"\\]]?";

/** `orders`, `public.orders`, `"public"."orders"`, with spaces around the dot. */
const DOTTED = new RegExp(`^\\s*(${NAME}(?:\\s*\\.\\s*${NAME})*)`);

export function sourceName(sql: string): string | undefined {
  const bare = sql.replace(NOISE, " ");
  const from = /\bfrom\b/i.exec(bare);
  if (!from) return undefined;

  const rest = bare.slice(from.index + from[0].length);
  if (/^\s*\(/.test(rest)) return undefined;

  const name = DOTTED.exec(rest)?.[1]
    ?.replace(/[`"[\]]/g, "")
    // `public . orders` is one name; the spaces are the writer's, not the
    // object's, and they would show up in the label if they were left in.
    .replace(/\s*\.\s*/g, ".")
    .trim();
  return name || undefined;
}
