import type { InterpolationVars } from "@/i18n/types";

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Unknown placeholders are left intact rather than blanked, so a forgotten
 * variable shows up as `{count}` in the interface instead of silently dropping
 * the number.
 */
export function interpolate(template: string, vars?: InterpolationVars) {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}
