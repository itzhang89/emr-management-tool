export type LogSegmentKind =
  | "timestamp"
  | "level-error"
  | "level-warn"
  | "level-info"
  | "level-other"
  | "logger-etl"
  | "step-id"
  | "step-config"
  | "plain"
  | "newline";

export type LogSegment = {
  start: number;
  end: number;
  kind: LogSegmentKind;
};

const SPARK_LINE_RE =
  /^(\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) (INFO|WARN|ERROR|DEBUG|TRACE) ([^:]+): (.*)$/;

/** Mirrors JobParser / Constants.Pattern for ETL job step scripts. */
const STEP_ID_RE = /^-- stepId=(\d+)\s*$/;
const STEP_SECTION_RE = /^-- (sourceConfig|targetConfig|conf)\s*$/;
const STEP_FIELD_RE = /^-- ([a-zA-Z0-9_]+)=(.+)$/;
const STEP_NESTED_FIELD_RE = /^-- {2,}([a-zA-Z0-9_.]+)=(.*)$/;
const STEP_OPTIONS_RE = /^-- {2}(options)\s*$/;
const STEP_COMMENT_RE = /^-- \\.*/;

export function segmentLogText(text: string): LogSegment[] {
  if (!text) return [];

  const segments: LogSegment[] = [];
  const lines = text.split("\n");
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    segments.push(...segmentLogLine(line, offset));
    offset += line.length;
    if (index < lines.length - 1) {
      segments.push({ start: offset, end: offset + 1, kind: "newline" });
      offset += 1;
    }
  }

  return segments;
}

export function segmentLogLine(line: string, absoluteStart = 0): LogSegment[] {
  if (!line) return [];

  if (STEP_ID_RE.test(line)) {
    return segmentStepIdLine(line, absoluteStart);
  }

  if (isStepConfigLine(line)) {
    return [{ start: absoluteStart, end: absoluteStart + line.length, kind: "step-config" }];
  }

  if (SPARK_LINE_RE.test(line)) {
    return segmentSparkLine(line, absoluteStart);
  }

  return [{ start: absoluteStart, end: absoluteStart + line.length, kind: "plain" }];
}

function segmentSparkLine(line: string, absoluteStart: number): LogSegment[] {
  const match = SPARK_LINE_RE.exec(line);
  if (!match) {
    return [{ start: absoluteStart, end: absoluteStart + line.length, kind: "plain" }];
  }

  const [, timestamp, level, logger, message = ""] = match;
  const isEtl = (logger ?? "") === "ETLLogger" || /^ETLLogger$/i.test(logger ?? "");

  let cursor = absoluteStart;
  const segments: LogSegment[] = [];

  const push = (value: string, kind: LogSegmentKind) => {
    const start = cursor;
    const end = start + value.length;
    segments.push({ start, end, kind });
    cursor = end;
  };

  // Timestamp stays muted (de-emphasized), not a "highlight keyword".
  push(timestamp!, "timestamp");
  push(" ", "plain");
  push(level!, levelKindFor(level ?? "INFO"));
  push(" ", "plain");
  // Only the ETLLogger token is highlighted; other loggers match body color.
  push(logger!, isEtl ? "logger-etl" : "plain");
  push(": ", "plain");
  // Message / SQL body: never specially colored.
  push(message, "plain");

  return segments;
}

function segmentStepIdLine(line: string, absoluteStart: number): LogSegment[] {
  const match = STEP_ID_RE.exec(line);
  if (!match) {
    return [{ start: absoluteStart, end: absoluteStart + line.length, kind: "step-id" }];
  }
  const id = match[1]!;
  const prefix = `-- stepId=`;
  return [
    { start: absoluteStart, end: absoluteStart + prefix.length, kind: "step-config" },
    {
      start: absoluteStart + prefix.length,
      end: absoluteStart + prefix.length + id.length,
      kind: "step-id"
    }
  ];
}

function isStepConfigLine(line: string) {
  return (
    STEP_SECTION_RE.test(line) ||
    STEP_OPTIONS_RE.test(line) ||
    STEP_COMMENT_RE.test(line) ||
    STEP_NESTED_FIELD_RE.test(line) ||
    STEP_FIELD_RE.test(line)
  );
}

function levelKindFor(level: string): LogSegmentKind {
  if (level === "ERROR") return "level-error";
  if (level === "WARN") return "level-warn";
  if (level === "INFO") return "level-info";
  return "level-other";
}

/** Tailwind classes for semantic log tokens on the dark log canvas. */
export function classNameForLogSegmentKind(kind: LogSegmentKind): string {
  switch (kind) {
    case "timestamp":
      return "text-slate-500";
    case "level-error":
      return "font-semibold text-red-400";
    case "level-warn":
      return "font-semibold text-amber-400";
    case "level-info":
      return "text-slate-500";
    case "level-other":
      return "text-slate-500";
    case "logger-etl":
      return "font-medium text-emerald-400";
    case "step-id":
      return "font-semibold text-violet-300";
    case "step-config":
      return "text-teal-400/90";
    case "newline":
      return "";
    case "plain":
    default:
      return "text-slate-200";
  }
}
