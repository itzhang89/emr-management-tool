/** Tailwind classes per assistant accent, so avatars are distinguishable. */
const ACCENTS: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
};

export function accentClasses(accent?: string | null): string {
  return ACCENTS[accent ?? ""] ?? "bg-muted text-muted-foreground";
}

export const ACCENT_NAMES = Object.keys(ACCENTS);
