import mysqlIcon from "@/assets/db-icons/mysql.png";
import postgresIcon from "@/assets/db-icons/postgres.png";
import yellowbrickIcon from "@/assets/db-icons/yellowbrick.png";
import { cn } from "@/lib/utils";
import type { DbConnectionKind } from "@/types/domain";

/**
 * A connection's engine, at a glance.
 *
 * The glyphs are the engines' own brand marks, so a connection is recognised
 * here the way it is recognised anywhere else — MySQL's dolphin, Postgres's
 * elephant, Yellowbrick's interlocking circles. Being full-colour images, they
 * are never recoloured: the mark belongs to the engine, and a theme-tinted
 * version of it would be a different mark. The four places this appears — the
 * connection card, the sub-nav, the page tab and the workspace header — all
 * read from this one table, so the same connection looks the same everywhere.
 *
 * Sources are the 2x assets so the marks stay crisp on retina displays; each is
 * rendered at 12–16px and keeps its own transparent background.
 */
const BY_KIND: Record<DbConnectionKind, { icon: string; label: string }> = {
  mysql: { icon: mysqlIcon, label: "MySQL" },
  postgres: { icon: postgresIcon, label: "PostgreSQL" },
  yellowbrick: { icon: yellowbrickIcon, label: "Yellowbrick" }
};

/** What this engine is called, for the places that only need the word. */
export function dbKindLabel(kind: DbConnectionKind): string {
  return BY_KIND[kind].label;
}

export function DbKindIcon({
  kind,
  className
}: {
  kind: DbConnectionKind;
  className?: string;
}) {
  const { icon } = BY_KIND[kind];
  // `alt=""` on purpose: every place this glyph appears, the engine is also
  // said in words beside it, so a second announcement would only be noise.
  return (
    <img
      src={icon}
      alt=""
      aria-hidden
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
