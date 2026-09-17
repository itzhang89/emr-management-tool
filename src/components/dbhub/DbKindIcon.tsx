import { Boxes, Database, Warehouse, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DbConnectionKind } from "@/types/domain";

/**
 * A connection's engine, at a glance.
 *
 * There are no brand marks for these engines to use, so the glyphs are chosen
 * to be told apart at 14px — a cylinder, a stack of boxes, a warehouse — and
 * tinted, because shape alone is hard to scan down a list. The three appear on
 * the connection card, the tab that opens it and the workspace's own header,
 * so the same connection reads the same everywhere.
 */
const BY_KIND: Record<DbConnectionKind, { icon: LucideIcon; tone: string; label: string }> = {
  mysql: { icon: Database, tone: "text-sky-600 dark:text-sky-400", label: "MySQL" },
  postgres: { icon: Boxes, tone: "text-indigo-600 dark:text-indigo-400", label: "PostgreSQL" },
  yellowbrick: {
    icon: Warehouse,
    tone: "text-amber-600 dark:text-amber-400",
    label: "Yellowbrick"
  }
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
  const { icon: Icon, tone } = BY_KIND[kind];
  // `aria-hidden` on purpose: every place this glyph appears, the engine is
  // also said in words beside it, so a second announcement would only be noise.
  return <Icon className={cn("shrink-0", tone, className)} aria-hidden />;
}
