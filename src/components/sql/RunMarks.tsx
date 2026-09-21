import { cn } from "@/lib/utils";

/**
 * The two marks the DBHub toolbars are built from, drawn rather than pulled
 * from Lucide.
 *
 * Lucide is a single stroke language — one weight, one colour, no fills — and
 * these are the opposite: a solid orange play and a solid blue plus, the pair
 * a database client's toolbar has used for twenty years. Substituting a Lucide
 * `Play` would lose the only thing the mark is for, which is being recognised
 * without being read. Both keep `currentColor`, so the tone still comes from
 * the button that holds them.
 */

/** DBeaver's orange, tuned per theme so it stays legible on both grounds. */
const ORANGE = "text-[#e08a1e] dark:text-[#f0a94a]";
/** Its blue, same treatment. */
const BLUE = "text-[#2b7cc0] dark:text-[#5aa9e6]";

/**
 * Run — the plain statement, into the result tab already on screen.
 *
 * `aria-hidden` throughout: every one of these sits in a button that names
 * itself, and the mark is the decoration on that name.
 */
export function ExecuteMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-3.5", ORANGE, className)}
      fill="currentColor"
      aria-hidden
    >
      <path d="M4.5 2.6 13 8l-8.5 5.4z" />
    </svg>
  );
}

/**
 * Run in new tab — the same statement, into a result tab of its own.
 *
 * The plus is a second colour on purpose: it is the whole difference between
 * this button and the one beside it, and at 14px a shape change alone does not
 * carry.
 */
export function ExecuteNewTabMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-3.5", className)} aria-hidden>
      <path d="M2.6 2.2 10 6.9l-7.4 4.7z" fill="currentColor" className={ORANGE} />
      {/* Drawn as two bars, not a glyph — a text "+" sits on the baseline and
          would ride differently at every size the icon is used at. */}
      <path
        d="M11.9 9.2v4.6M9.6 11.5h4.6"
        stroke="currentColor"
        className={BLUE}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The AI mark. DBeaver spells this one in letters rather than a glyph, and so
 * does this — an icon for "ask a model" would be a guess at a convention that
 * has not settled yet, while two letters have.
 */
export function AiMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-[11px] font-extrabold leading-none tracking-tight",
        BLUE,
        className
      )}
      aria-hidden
    >
      AI
    </span>
  );
}
