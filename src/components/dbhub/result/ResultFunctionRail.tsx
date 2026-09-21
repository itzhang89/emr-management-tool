import type { ReactNode } from "react";

/**
 * The rail down the right edge: what acts *on* a result rather than being part
 * of it.
 *
 * The AI action used to sit in a strip above the grid. A strip costs the table
 * a row of height at every scroll position and says nothing about the columns
 * underneath it, while the right edge was empty for the whole height of the
 * pane — so it moved here, and the grid got the top of the pane back.
 *
 * It is the mirror of the format rail on the other side: the same width, the
 * same gutter inside it, the same band across the top. Two rails of different
 * widths read as two different kinds of thing, and the eye takes the wider one
 * for the more important — which is exactly backwards for a rail whose whole
 * content is one button that acts on the result rather than being part of it.
 * The button sits at the right edge because that edge is the one it belongs to:
 * the results and their own controls run up against the left rail, and the far
 * corner is where a control that reaches outside the pane should be.
 */
export function ResultFunctionRail({ analyzeButton }: { analyzeButton?: ReactNode }) {
  if (!analyzeButton) return null;

  return (
    <aside className="flex w-6 shrink-0 flex-col items-stretch border-l bg-muted/20">
      {/* The height of the header row beside it, and the same rule under it, so
          the two read as one band across the top of the table rather than as
          two things that happen to start at the same place. */}
      <div className="flex h-6 shrink-0 items-center justify-end border-b pr-0.5">
        {analyzeButton}
      </div>
    </aside>
  );
}
