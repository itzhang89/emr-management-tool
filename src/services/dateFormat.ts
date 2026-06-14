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
