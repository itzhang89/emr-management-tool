import { describe, expect, it } from "vitest";
import { buildEmrLogTree, parseCloudWatchLogStream, parseS3LogObjectKey, pickDefaultLogItem } from "./emrLogTree";
import type { JobLogObject, JobLogStream } from "@/types/domain";

describe("emrLogTree", () => {
  it("parses CloudWatch stream names into EMR log identities", () => {
    expect(
      parseCloudWatchLogStream(
        "20260612/li36cjq5163l1bh8ms7d6kr04/jobs/000000037lsld3h8l1d/containers/spark-000000037lsld3h8l1d/spark-000000037lsld3h8l1d-driver/stderr",
        "000000037lsld3h8l1d"
      )
    ).toEqual({
      source: "cloudwatch",
      id: "20260612/li36cjq5163l1bh8ms7d6kr04/jobs/000000037lsld3h8l1d/containers/spark-000000037lsld3h8l1d/spark-000000037lsld3h8l1d-driver/stderr",
      label: "spark-000000037lsld3h8l1d-driver stderr",
      type: "driver",
      container: "spark-000000037lsld3h8l1d",
      pod: "spark-000000037lsld3h8l1d-driver",
      stream: "stderr",
      cloudWatchStreamName:
        "20260612/li36cjq5163l1bh8ms7d6kr04/jobs/000000037lsld3h8l1d/containers/spark-000000037lsld3h8l1d/spark-000000037lsld3h8l1d-driver/stderr"
    });

    expect(
      parseCloudWatchLogStream(
        "20260612/li36cjq5163l1bh8ms7d6kr04/jobs/000000037lsld3h8l1d/containers/000000037lsld3h8l1d-xz7ms/stdout",
        "000000037lsld3h8l1d"
      )
    ).toMatchObject({
      type: "controller",
      pod: "000000037lsld3h8l1d-xz7ms",
      stream: "stdout"
    });
  });

  it("parses S3 archive object keys into the same EMR log identities", () => {
    expect(
      parseS3LogObjectKey(
        "logs/li36cjq5163l1bh8ms7d6kr04/jobs/000000037lsld3h8l1d/containers/spark-000000037lsld3h8l1d/spark-000000037lsld3h8l1d-77fab59ebcabdbc6-exec-1/stderr.gz",
        "000000037lsld3h8l1d"
      )
    ).toMatchObject({
      source: "s3",
      type: "executor",
      container: "spark-000000037lsld3h8l1d",
      pod: "spark-000000037lsld3h8l1d-77fab59ebcabdbc6-exec-1",
      stream: "stderr",
      s3Key:
        "logs/li36cjq5163l1bh8ms7d6kr04/jobs/000000037lsld3h8l1d/containers/spark-000000037lsld3h8l1d/spark-000000037lsld3h8l1d-77fab59ebcabdbc6-exec-1/stderr.gz"
    });
  });

  it("prefers driver stderr as the default log selection", () => {
    const items: Array<JobLogStream | JobLogObject> = [
      cloudWatch("containers/spark-000000037lsld3h8l1d/spark-000000037lsld3h8l1d-77fab59ebcabdbc6-exec-1/stderr"),
      cloudWatch("containers/spark-000000037lsld3h8l1d/spark-000000037lsld3h8l1d-driver/stdout"),
      cloudWatch("containers/spark-000000037lsld3h8l1d/spark-000000037lsld3h8l1d-driver/stderr")
    ];

    expect(pickDefaultLogItem(items)).toMatchObject({
      type: "driver",
      stream: "stderr",
      pod: "spark-000000037lsld3h8l1d-driver"
    });
  });

  it("builds grouped tree sections for controller, driver, and executors", () => {
    const items: Array<JobLogStream | JobLogObject> = [
      cloudWatch("containers/000000037lsld3h8l1d-xz7ms/stdout"),
      cloudWatch("containers/000000037lsld3h8l1d-xz7ms/stderr"),
      cloudWatch("containers/spark-000000037lsld3h8l1d/spark-000000037lsld3h8l1d-driver/stdout"),
      cloudWatch("containers/spark-000000037lsld3h8l1d/spark-000000037lsld3h8l1d-driver/stderr"),
      cloudWatch("containers/spark-000000037lsld3h8l1d/spark-000000037lsld3h8l1d-77fab59ebcabdbc6-exec-1/stderr")
    ];

    expect(buildEmrLogTree(items)).toMatchObject([
      {
        type: "controller",
        label: "Controller",
        groups: [{ label: "000000037lsld3h8l1d-xz7ms", items: [{ stream: "stderr" }, { stream: "stdout" }] }]
      },
      {
        type: "driver",
        label: "Driver",
        groups: [{ label: "spark-000000037lsld3h8l1d-driver", items: [{ stream: "stderr" }, { stream: "stdout" }] }]
      },
      {
        type: "executor",
        label: "Executors",
        groups: [{ label: "spark-000000037lsld3h8l1d-77fab59ebcabdbc6-exec-1", items: [{ stream: "stderr" }] }]
      }
    ]);
  });
});

function cloudWatch(suffix: string): JobLogStream {
  const streamName = `20260612/li36cjq5163l1bh8ms7d6kr04/jobs/000000037lsld3h8l1d/${suffix}`;
  return parseCloudWatchLogStream(streamName, "000000037lsld3h8l1d")!;
}
