import { type ReactNode } from "react";
import { Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FavoritesMenu, HistoryMenu, SqlTemplatesButton } from "@/components/glue/SqlQueryMenus";
import { useT } from "@/i18n";
import type { SqlFavoriteEntry, SqlHistoryEntry } from "@/types/domain";
import { ExecuteMark, ExecuteNewTabMark } from "./RunMarks";

/**
 * The row above the editor, shared by the two workspaces that have one.
 *
 * It was written twice before this — once per workspace — and the two copies
 * had already drifted: the same three buttons at the same size, but two
 * different icon sets and two different tooltips. The buttons are the point of
 * the row, so they are drawn from one place.
 *
 * What is *not* shared is the copy. Each workspace's Run means something
 * slightly different to the person pressing it, so the tail after the "·" is
 * passed in: DBHub names the read-only gate, Glue names the key.
 *
 * The two marks are drawn rather than borrowed from the icon set — see
 * `RunMarks` — because a triangle that means "run" and a triangle with a plus
 * that means "run, and keep this one as well" are the identity of the button,
 * not decoration on it.
 */
export function SqlQueryToolbar({
  leading,
  templates,
  history,
  favoriteSqlSet,
  favorites,
  onSelectSql,
  onFavorite,
  onRemoveFavorite,
  running,
  runPending,
  onStop,
  onRunNewTab,
  onRun,
  runHint,
  runNewTabHint,
  stopHint
}: {
  /** Sits left of the SQL menus — the connection's AI button, a settings gear. */
  leading?: ReactNode;
  /** Defaults to Glue's Hive DDL list; a JDBC workspace brings its own. */
  templates?: ReadonlyArray<{ label: string; sql: string }>;
  history: SqlHistoryEntry[];
  favoriteSqlSet: Set<string>;
  favorites: SqlFavoriteEntry[];
  /** Where a template, a history entry or a favourite lands: the editor. */
  onSelectSql: (sql: string) => void;
  /** The history entry a name is being asked for — each workspace asks its own way. */
  onFavorite: (entry: SqlHistoryEntry) => void;
  onRemoveFavorite: (favoriteId: string) => void;
  /** A query is in flight: the stop is live and the runs are not. */
  running: boolean;
  /** The run is being accepted but has not started — also blocks the runs. */
  runPending?: boolean;
  onStop: () => void;
  onRunNewTab: () => void;
  onRun: () => void;
  /** Translated tails for the three tooltips, after the "·". */
  runHint?: string;
  runNewTabHint?: string;
  stopHint?: string;
}) {
  const t = useT();
  const busy = running || Boolean(runPending);

  return (
    <div className="flex shrink-0 items-center gap-1">
      {leading}
      <SqlTemplatesButton templates={templates} onSelect={onSelectSql} />
      <HistoryMenu
        history={history}
        favoriteSqlSet={favoriteSqlSet}
        onSelect={(entry) => onSelectSql(entry.sql)}
        onFavorite={onFavorite}
      />
      <FavoritesMenu
        favorites={favorites}
        onSelect={(entry) => onSelectSql(entry.sql)}
        onRemove={onRemoveFavorite}
      />

      <div className="ml-auto flex items-center gap-1">
        {/* Stays in the toolbar as well as the result strip: a first run has no
            result tab yet, so the strip's Stop is not on screen when a query is
            slow enough to want stopping. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-7"
              disabled={!running}
              aria-label={t("Stop query")}
              onClick={onStop}
            >
              <Square className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("Stop query")}
            {stopHint ? ` · ${stopHint}` : ""}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-7"
              disabled={busy}
              aria-label={t("Run in new tab")}
              onClick={onRunNewTab}
            >
              <ExecuteNewTabMark />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("Run in new tab")}
            {runNewTabHint ? ` · ${runNewTabHint}` : ""}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              className="size-7"
              disabled={busy}
              aria-label={t("Run query")}
              onClick={onRun}
            >
              {running ? <Loader2 className="size-3.5 animate-spin" /> : <ExecuteMark />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("Run query")}
            {runHint ? ` · ${runHint}` : ""}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
