import { describe, expect, it } from "vitest";
import { classNameForLogSegmentKind, segmentLogLine, segmentLogText } from "./logSemanticHighlight";

describe("segmentLogLine", () => {
  it("highlights only LEVEL and ETLLogger keywords on Spark lines", () => {
    const error = segmentLogLine("26/07/31 11:30:42 ERROR TaskSetManager: Lost task 0.0");
    expect(error.map((segment) => segment.kind)).toEqual([
      "timestamp",
      "plain",
      "level-error",
      "plain",
      "plain",
      "plain",
      "plain"
    ]);

    const warn = segmentLogLine("26/07/31 11:30:42 WARN MicroBatchExecution: ignored limit");
    expect(warn.some((segment) => segment.kind === "level-warn")).toBe(true);
    expect(warn.every((segment) => segment.kind !== "logger-etl")).toBe(true);

    const etl = segmentLogLine(
      "26/07/31 11:30:43 INFO ETLLogger: Deleting data by DELETE FROM cdp.table"
    );
    expect(etl.some((segment) => segment.kind === "level-info")).toBe(true);
    expect(etl.some((segment) => segment.kind === "logger-etl")).toBe(true);
    // SQL in the message stays plain (no SQL highlighting).
    const message = etl[etl.length - 1]!;
    expect(message.kind).toBe("plain");
    expect("26/07/31 11:30:43 INFO ETLLogger: Deleting data by DELETE FROM cdp.table".slice(message.start, message.end)).toContain(
      "DELETE FROM"
    );
  });

  it("classifies JobParser step config lines only", () => {
    expect(segmentLogLine("-- stepId=1").some((s) => s.kind === "step-id")).toBe(true);
    expect(segmentLogLine("-- sourceConfig")[0]?.kind).toBe("step-config");
    expect(segmentLogLine("--  dataSourceType=temp")[0]?.kind).toBe("step-config");
    expect(segmentLogLine("-- incrementalType=incremental_kafka_offset")[0]?.kind).toBe("step-config");
    expect(segmentLogLine("select 1")[0]?.kind).toBe("plain");
    expect(segmentLogLine("WHERE id = 1")[0]?.kind).toBe("plain");
    expect(segmentLogLine("+- *(1) Scan")[0]?.kind).toBe("plain");
    expect(segmentLogLine("Files s3://bucket/a.jar from /tmp/a.jar to /home/hadoop/a.jar")[0]?.kind).toBe(
      "plain"
    );
  });

  it("reconstructs the original Spark line from segments", () => {
    const line =
      "26/07/31 11:30:43 INFO ETLLogger: Executing job dct__t_message_opened_snapshot";
    const segments = segmentLogLine(line);
    expect(segments.map((segment) => line.slice(segment.start, segment.end)).join("")).toBe(line);
  });
});

describe("segmentLogText", () => {
  it("tracks absolute offsets across newlines", () => {
    const text = ["26/07/31 11:30:42 INFO ETLLogger: hello", "-- stepId=1"].join("\n");
    const segments = segmentLogText(text);
    expect(segments.some((segment) => segment.kind === "newline")).toBe(true);
    const stepId = segments.find((segment) => segment.kind === "step-id");
    expect(text.slice(stepId!.start, stepId!.end)).toBe("1");
  });

  it("does not treat multi-line SQL as special after step or ETLLogger", () => {
    const text = [
      "-- stepId=1",
      "-- sourceConfig",
      "--  dataSourceType=temp",
      "select 1 as x,",
      "       2 as y",
      '26/07/31 11:31:43 INFO ETLLogger: Deleting data by DELETE FROM cdp."t"',
      "WHERE (\"id\") IN",
      "      (SELECT 1)"
    ].join("\n");

    const kindsByLine = text.split("\n").map((line, index, lines) => {
      const start = lines.slice(0, index).reduce((sum, current) => sum + current.length + 1, 0);
      const end = start + line.length;
      return segmentLogText(text)
        .filter((segment) => segment.kind !== "newline" && segment.start < end && segment.end > start)
        .map((segment) => segment.kind);
    });

    expect(kindsByLine[0]).toContain("step-id");
    expect(kindsByLine[1]).toEqual(["step-config"]);
    expect(kindsByLine[2]).toEqual(["step-config"]);
    expect(kindsByLine[3]).toEqual(["plain"]);
    expect(kindsByLine[4]).toEqual(["plain"]);
    expect(kindsByLine[5]).toContain("logger-etl");
    expect(kindsByLine[5].at(-1)).toBe("plain");
    expect(kindsByLine[6]).toEqual(["plain"]);
    expect(kindsByLine[7]).toEqual(["plain"]);
  });
});

describe("classNameForLogSegmentKind", () => {
  it("returns distinct classes for level, etl logger, and step tokens", () => {
    expect(classNameForLogSegmentKind("level-error")).toContain("red");
    expect(classNameForLogSegmentKind("logger-etl")).toContain("emerald");
    expect(classNameForLogSegmentKind("step-id")).toContain("violet");
    expect(classNameForLogSegmentKind("step-config")).toContain("teal");
  });
});
