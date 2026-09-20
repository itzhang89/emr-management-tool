import {
  Cloud,
  Database,
  FileCode2,
  History,
  KeyRound,
  LayoutDashboard,
  Layers3,
  Send,
  Settings,
  Sparkles,
  Table2
} from "lucide-react";

export type PageId =
  | "dashboard"
  | "submit"
  | "history"
  | "templates"
  | "clusters"
  | "s3"
  | "glue"
  | "ai"
  | "secrets"
  | "settings";

/**
 * Every page, in the order the sidebar lists them — the source of truth for the
 * ⌘1…⌘n shortcuts and for ⌘[ / ⌘] cycling, so read it top to bottom. The order
 * is a product decision, not a dependency or alphabetical one: moving an entry
 * moves what its number key opens.
 *
 * There is no Logs page: the log viewer lives in a tab of Job History, which is
 * why Job History carries no "open logs" navigation of its own.
 *
 * Settings is last because the sidebar pins it to its foot instead of letting
 * it scroll with the rest (see `isBottomNavItem`).
 */
export const navigationItems = [
  { id: "submit", label: "Submit Job", description: "Template-driven submission", icon: Send },
  { id: "history", label: "Job History", description: "Track and clone jobs", icon: History },
  { id: "s3", label: "S3 Browser", description: "Text file editing", icon: FileCode2 },
  { id: "glue", label: "DBHub", description: "Databases, connections & queries", icon: Table2 },
  { id: "ai", label: "AI Assistant", description: "Chat, models, and MCP tools", icon: Sparkles },
  { id: "secrets", label: "Secrets", description: "Account secrets and DB credentials", icon: KeyRound },
  { id: "dashboard", label: "Dashboard", description: "Cluster job statistics", icon: LayoutDashboard },
  { id: "templates", label: "Templates", description: "Application and resource templates", icon: Layers3 },
  { id: "clusters", label: "Virtual Clusters", description: "EMR on EKS clusters", icon: Database },
  { id: "settings", label: "Settings", description: "AWS credentials", icon: Settings }
] as const satisfies Array<{
  id: PageId;
  label: string;
  description: string;
  icon: typeof Cloud;
}>;

/**
 * Pages anchored to the sidebar's foot instead of scrolling inside its nav
 * list. Settings is a destination you go to on purpose, not one you scan past
 * on the way to something else — and pinning it keeps it in place however tall
 * the list above grows (the DBHub second level is what makes it move).
 */
const BOTTOM_NAV_IDS: readonly PageId[] = ["settings"];

/** Whether `id` belongs at the sidebar's foot rather than in its scrolling list. */
export function isBottomNavItem(id: PageId) {
  return BOTTOM_NAV_IDS.includes(id);
}

export function getPageMeta(id: PageId) {
  const item = navigationItems.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Unknown page id: ${id}`);
  }
  return item;
}
