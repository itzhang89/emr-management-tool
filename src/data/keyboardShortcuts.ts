import { formatModShortcut, formatShortcutsHelpLabel } from "@/lib/keyboardShortcut";
import { navigationItems, type PageId } from "@/pages/pageMeta";

export const SHORTCUT_IDS = {
  OPEN_SHORTCUTS_HELP: "open-shortcuts-help",
  SIDEBAR_TOGGLE: "sidebar-toggle",
  ACCOUNT_SWITCH: "account-switch",
  NAV_PREV_PAGE: "nav-prev-page",
  NAV_NEXT_PAGE: "nav-next-page",
  GLUE_CATALOG_TOGGLE: "glue-catalog-toggle",
  GLUE_RUN_QUERY: "glue-run-query",
  GLUE_RUN_NEW_TAB: "glue-run-new-tab",
  GLUE_CYCLE_RESULT_TAB_PREV: "glue-cycle-result-tab-prev",
  GLUE_CYCLE_RESULT_TAB_NEXT: "glue-cycle-result-tab-next",
  S3_LIST_MOVE: "s3-list-move",
  S3_LIST_ENTER: "s3-list-enter",
  S3_FOCUS_EDITOR: "s3-focus-editor",
  S3_FOCUS_LIST: "s3-focus-list",
  S3_GO_UP: "s3-go-up",
  SUBMIT_JOB: "submit-job",
  SUBMIT_PREVIEW_JSON: "submit-preview-json"
} as const;

export type NavigationShortcutId = `nav-${PageId}`;

export type ShortcutId = (typeof SHORTCUT_IDS)[keyof typeof SHORTCUT_IDS] | NavigationShortcutId;

export type ShortcutCategoryId = "global" | "navigation" | "account" | "glue" | "s3" | "submit";

export interface ShortcutCategory {
  id: ShortcutCategoryId;
  label: string;
  description?: string;
}

export interface KeyboardShortcutEntry {
  id: ShortcutId;
  category: ShortcutCategoryId;
  label: string;
  description: string;
  keys: string[];
}

export const shortcutCategories: ShortcutCategory[] = [
  { id: "global", label: "Global", description: "Available from any page" },
  { id: "navigation", label: "Navigation", description: "Jump between primary pages" },
  { id: "account", label: "Account", description: "AWS account switching" },
  { id: "glue", label: "Data Catalog", description: "Glue tables and Athena SQL" },
  { id: "s3", label: "S3 Browser", description: "When the object list or editor has focus" },
  { id: "submit", label: "Submit Job", description: "Template-driven job submission" }
];

const navigationShortcuts: KeyboardShortcutEntry[] = navigationItems.map((item, index) => ({
  id: `nav-${item.id}`,
  category: "navigation",
  label: `Go to ${item.label}`,
  description: item.description,
  keys: [formatModShortcut(String(index + 1))]
}));

export const keyboardShortcuts: KeyboardShortcutEntry[] = [
  {
    id: SHORTCUT_IDS.OPEN_SHORTCUTS_HELP,
    category: "global",
    label: "Open shortcuts",
    description: "Show keyboard shortcuts for the app (Help menu)",
    keys: [formatShortcutsHelpLabel()]
  },
  {
    id: SHORTCUT_IDS.SIDEBAR_TOGGLE,
    category: "global",
    label: "Toggle navigation",
    description: "Collapse or expand the primary navigation sidebar",
    keys: [formatModShortcut("/")]
  },
  {
    id: SHORTCUT_IDS.ACCOUNT_SWITCH,
    category: "account",
    label: "Switch AWS account",
    description: "Open the account switcher dialog",
    keys: [formatModShortcut("E")]
  },
  ...navigationShortcuts,
  {
    id: SHORTCUT_IDS.NAV_PREV_PAGE,
    category: "navigation",
    label: "Previous page",
    description: "Go to the previous page in the sidebar order",
    keys: [formatModShortcut("[")]
  },
  {
    id: SHORTCUT_IDS.NAV_NEXT_PAGE,
    category: "navigation",
    label: "Next page",
    description: "Go to the next page in the sidebar order",
    keys: [formatModShortcut("]")]
  },
  {
    id: SHORTCUT_IDS.GLUE_CATALOG_TOGGLE,
    category: "glue",
    label: "Toggle catalog panel",
    description: "Show or hide the Glue catalog sidebar",
    keys: [formatModShortcut("\\")]
  },
  {
    id: SHORTCUT_IDS.GLUE_RUN_QUERY,
    category: "glue",
    label: "Run query",
    description: "Execute the current SQL in the active result tab",
    keys: [formatModShortcut("Enter")]
  },
  {
    id: SHORTCUT_IDS.GLUE_RUN_NEW_TAB,
    category: "glue",
    label: "Run in new tab",
    description: "Execute the current SQL in a new result tab",
    keys: [formatModShortcut("Enter", { shift: true })]
  },
  {
    id: SHORTCUT_IDS.GLUE_CYCLE_RESULT_TAB_PREV,
    category: "glue",
    label: "Previous result tab",
    description: "Switch to the previous query result tab",
    keys: [formatModShortcut("←", { alt: true })]
  },
  {
    id: SHORTCUT_IDS.GLUE_CYCLE_RESULT_TAB_NEXT,
    category: "glue",
    label: "Next result tab",
    description: "Switch to the next query result tab",
    keys: [formatModShortcut("→", { alt: true })]
  },
  {
    id: SHORTCUT_IDS.S3_LIST_MOVE,
    category: "s3",
    label: "Move selection",
    description: "Move up or down in the object list",
    keys: ["↑", "↓"]
  },
  {
    id: SHORTCUT_IDS.S3_LIST_ENTER,
    category: "s3",
    label: "Open folder",
    description: "Enter the selected folder or keep the file selected",
    keys: ["Enter"]
  },
  {
    id: SHORTCUT_IDS.S3_FOCUS_EDITOR,
    category: "s3",
    label: "Focus editor",
    description: "Move focus from the object list to the file editor",
    keys: ["→"]
  },
  {
    id: SHORTCUT_IDS.S3_FOCUS_LIST,
    category: "s3",
    label: "Focus object list",
    description: "Move focus from the editor back to the object list",
    keys: ["←"]
  },
  {
    id: SHORTCUT_IDS.S3_GO_UP,
    category: "s3",
    label: "Go up",
    description: "Navigate to the parent prefix in the current bucket",
    keys: ["Esc"]
  },
  {
    id: SHORTCUT_IDS.SUBMIT_JOB,
    category: "submit",
    label: "Submit job",
    description: "Submit the current job configuration to EMR",
    keys: [formatModShortcut("Enter")]
  },
  {
    id: SHORTCUT_IDS.SUBMIT_PREVIEW_JSON,
    category: "submit",
    label: "Preview JSON",
    description: "Open the resolved submit payload preview",
    keys: [formatModShortcut("P", { shift: true })]
  }
];

export function getShortcutKeys(id: ShortcutId) {
  const entry = keyboardShortcuts.find((shortcut) => shortcut.id === id);
  if (!entry) {
    throw new Error(`Unknown shortcut id: ${id}`);
  }
  return entry.keys;
}

export function getShortcutPrimaryKey(id: ShortcutId) {
  return getShortcutKeys(id)[0] ?? "";
}

export function groupKeyboardShortcutsByCategory() {
  return shortcutCategories
    .map((category) => ({
      category,
      shortcuts: keyboardShortcuts.filter((shortcut) => shortcut.category === category.id)
    }))
    .filter((group) => group.shortcuts.length > 0);
}
