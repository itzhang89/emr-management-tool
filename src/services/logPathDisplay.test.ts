import { describe, expect, it } from "vitest";
import { buildEmrLogTree } from "@/services/emrLogTree";
import {
  buildPodLabelIndex,
  formatDestinationItems,
  formatLogBreadcrumb,
  formatLogPodLabel,
  getLogFullPath
} from "@/services/logPathDisplay";
import type { JobLogStream } from "@/types/domain";

describe("logPathDisplay", () => {
  it("formats pod labels by type", () => {
    expect(formatLogPodLabel("spark-driver", "driver", 0)).toBe("driver");
    expect(formatLogPodLabel("custom-pod", "driver", 0)).toBe("custom-pod");
    expect(formatLogPodLabel("controller", "controller", 0)).toBe("controller");
    expect(formatLogPodLabel("000000037lsld3h8l1d-xz7ms", "executor", 2)).toBe("exec-2");
  });

  it("builds breadcrumb sections from a log item", () => {
    const item: JobLogStream = {
      source: "cloudwatch",
      id: "cw-1",
      label: "driver stderr",
      type: "driver",
      container: "spark-app",
      pod: "driver",
      stream: "stderr",
      cloudWatchStreamName: "20260612/vc/jobs/job/containers/spark-app/driver/stderr"
    };

    expect(formatLogBreadcrumb(item, 0)).toEqual({
      sections: ["Driver", "driver", "stderr"],
      fullPath: item.cloudWatchStreamName
    });
  });

  it("indexes executor pods within the tree", () => {
    const tree = buildEmrLogTree([
      cloudWatch("containers/spark-app/spark-driver/stderr"),
      cloudWatch("containers/000000037lsld3h8l1d-xz7ms/stdout"),
      cloudWatch("containers/spark-app/spark-exec-1/stderr")
    ]);
    const index = buildPodLabelIndex(tree);
    const executorGroup = tree.find((section) => section.type === "executor")?.groups[0];
    expect(executorGroup).toBeDefined();
    expect(index.get(`executor:${executorGroup!.label}`)).toBe(0);
  });

  it("formats destination metadata for popover", () => {
    expect(
      formatDestinationItems("s3", { bucket: "logs-bucket", prefix: "logs/vc/jobs/job/" })
    ).toEqual([["S3 archive prefix", "s3://logs-bucket/logs/vc/jobs/job/"]]);

    expect(
      formatDestinationItems("cloudwatch", {
        logGroupName: "/emr/jobs",
        streamNamePrefix: "prefix/"
      })
    ).toEqual([
      ["Log group", "/emr/jobs"],
      ["Stream prefix", "prefix/"]
    ]);
  });

  it("builds full S3 path for download copy", () => {
    expect(
      getLogFullPath(
        {
          source: "s3",
          id: "s3-1",
          label: "driver stdout",
          type: "driver",
          container: "spark-app",
          pod: "driver",
          stream: "stdout",
          s3Key: "logs/job/stdout.gz",
          size: 100
        },
        { bucket: "logs-bucket", prefix: "logs/" },
        "s3"
      )
    ).toBe("s3://logs-bucket/logs/job/stdout.gz");
  });
});

function cloudWatch(suffix: string): JobLogStream {
  const streamName = `20260612/vc/jobs/000000037lsld3h8l1d/${suffix}`;
  return {
    source: "cloudwatch",
    id: streamName,
    label: suffix,
    type: suffix.includes("exec") ? "executor" : suffix.includes("driver") ? "driver" : "controller",
    container: "spark-app",
    pod: suffix.split("/").at(-2) ?? suffix,
    stream: suffix.split("/").at(-1) ?? "stdout",
    cloudWatchStreamName: streamName
  };
}
