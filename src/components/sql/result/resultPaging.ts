/**
 * Where a page starts, for the engine that pages by offset.
 *
 * These are separated from the pane that draws the rows because they are not
 * about drawing: they are the arithmetic the *workspace* has to agree with, so
 * that the offset a pager button promises is the offset the request actually
 * sends. A pane that computed them for itself could drift from the request by
 * one page and nothing on screen would say so.
 *
 * The page size is passed in rather than imported, so this module — and the
 * whole shared result area around it — knows nothing about which workspace is
 * asking or where that workspace keeps its settings.
 */

/**
 * The size the backend will really page by. It clamps whatever it is handed, so
 * a caller that asked for more gets less; doing the same sum here keeps the two
 * sides in step instead of letting the arithmetic promise a page the request
 * will not produce.
 */
function pageSize(fetchSize: number, maxFetchSize: number): number {
  return Math.min(Math.max(fetchSize, 1), maxFetchSize);
}

/**
 * Where the final page starts, once a count has said how many rows there are.
 * Undefined until then — "last" is not somewhere you can go without knowing how
 * many rows the statement returns.
 */
export function lastPageOffset(
  totalCount: number | undefined,
  fetchSize: number,
  maxFetchSize: number
): number | undefined {
  if (totalCount === undefined) return undefined;
  const size = pageSize(fetchSize, maxFetchSize);
  return Math.floor(Math.max(totalCount - 1, 0) / size) * size;
}

/**
 * Where the page before this one starts.
 *
 * A whole page back, not a page's worth of rows: the page on screen may be the
 * last one, and a last page is short. Stepping back by its own row count would
 * land *inside* the page before it — the rows between would be skipped and the
 * user would never know. Every page except the last was full, so the size is
 * what separates two of them.
 */
export function previousPageOffset(offset: number, fetchSize: number, maxFetchSize: number): number {
  return Math.max(0, offset - pageSize(fetchSize, maxFetchSize));
}
