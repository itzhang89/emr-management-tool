import { format as formatDate } from "date-fns";

export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
export const DEFAULT_DATETIME_FORMAT = "YYYY-MM-DD HH:mm:ss";

export function defaultFormatForVariableType(type: "date" | "dateTime") {
  return type === "dateTime" ? DEFAULT_DATETIME_FORMAT : DEFAULT_DATE_FORMAT;
}

export function formatWithPattern(date: Date, pattern: string) {
  const tokenMap: Record<string, string> = {
    YYYY: formatDate(date, "yyyy"),
    MM: formatDate(date, "MM"),
    DD: formatDate(date, "dd"),
    HH: formatDate(date, "HH"),
    mm: formatDate(date, "mm"),
    ss: formatDate(date, "ss")
  };

  return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => tokenMap[token] ?? token);
}

export function parseDateValue(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const defaultDateTimeMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (defaultDateTimeMatch) {
    const [, year, month, day, hour, minute, second = "0"] = defaultDateTimeMatch;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  }

  const defaultDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (defaultDateMatch) {
    const [, year, month, day] = defaultDateMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
