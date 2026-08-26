import { describe, expect, it } from "vitest";
import { buildEmrLogTree, parseCloudWatchLogStream, parseS3LogObjectKey, pickDefaultLogItem } from "./emrLogTree";
import type { JobLogObject, JobLogStream } from "@/types/domain";

const VIRTUAL_CLUSTER_ID = "virtual-cluster-1";
const JOB_ID = "000000037lsld3h8l1d";

describe("emrLogTree", () => {
  it("parses CloudWatch stream names into EMR log identities", () => {
    const driverStream = `20260612/${VIRTUAL_CLUSTER_ID}/jobs/${JOB_ID}/containers/spark-${JOB_ID}/spark-${JOB_ID}-driver/stderr`;
    expect(parseCloudWatchLogStream(driverStream, JOB_ID)).toEqual({
      source: "cloudwatch",
      id: driverStream,
      label: `spark-${JOB_ID}-driver stderr`,
      type: "driver",
      container: `spark-${JOB_ID}`,
      pod: `spark-${JOB_ID}-driver`,
      stream: "stderr",
      cloudWatchStreamName: driverStream
    });

    expect(
      parseCloudWatchLogStream(
        `20260612/${VIRTUAL_CLUSTER_ID}/jobs/${JOB_ID}/containers/${JOB_ID}-xz7ms/stdout`,
        JOB_ID
      )
    ).toMatchObject({
      type: "controller",
      pod: `${JOB_ID}-xz7ms`,
      stream: "stdout"
    });
  });

  it("parses CloudWatch control-logs streams as controller logs", () => {
    // The same control-logs subtree exists on the CloudWatch side (behind a
    // date prefix), so it must resolve there too — not only for S3 archives.
    expect(
      parseCloudWatchLogStream(
        `20260612/${VIRTUAL_CLUSTER_ID}/jobs/${JOB_ID}/control-logs/${JOB_ID}-qs8tm/stderr`,
        JOB_ID
      )
    ).toMatchObject({
      source: "cloudwatch",
      type: "controller",
      container: "control-logs",
      pod: `${JOB_ID}-qs8tm`,
      stream: "stderr"
    });
  });

  it("parses S3 archive object keys into the same EMR log identities", () => {
    const key = `logs/${VIRTUAL_CLUSTER_ID}/jobs/${JOB_ID}/containers/spark-${JOB_ID}/spark-${JOB_ID}-77fab59ebcabdbc6-exec-1/stderr.gz`;
    expect(parseS3LogObjectKey(key, JOB_ID)).toMatchObject({
      source: "s3",
      type: "executor",
      container: `spark-${JOB_ID}`,
      pod: `spark-${JOB_ID}-77fab59ebcabdbc6-exec-1`,
      stream: "stderr",
      s3Key: key
    });
  });

  it("parses control-logs entries as controller logs", () => {
    // EMR on EKS writes the control pod's logs to control-logs/<pod>/<stream>,
    // a sibling of containers/ rather than a pod inside it.
    const key = `logs/${VIRTUAL_CLUSTER_ID}/jobs/${JOB_ID}/control-logs/${JOB_ID}-qs8tm/stderr.gz`;
    expect(parseS3LogObjectKey(key, JOB_ID)).toMatchObject({
      source: "s3",
      type: "controller",
      container: "control-logs",
      pod: `${JOB_ID}-qs8tm`,
      stream: "stderr",
      s3Key: key
    });
  });

  it("accepts any control pod name — the suffix is randomly generated per run", () => {
    const base = `logs/${VIRTUAL_CLUSTER_ID}/jobs/${JOB_ID}`;
    // The pod directory is read positionally, so no suffix shape is assumed:
    // a fresh random suffix, a longer one, and a name unrelated to the job id
    // must all parse to the same identity.
    for (const pod of [`${JOB_ID}-qs8tm`, `${JOB_ID}-9xz2b`, `${JOB_ID}-a1b2c3d4e5`, "runner-77f2b"]) {
      expect(parseS3LogObjectKey(`${base}/control-logs/${pod}/stderr.gz`, JOB_ID)).toMatchObject({
        type: "controller",
        container: "control-logs",
        pod,
        stream: "stderr"
      });
    }
  });

  it("ignores job-level files and unknown subtrees", () => {
    const base = `logs/${VIRTUAL_CLUSTER_ID}/jobs/${JOB_ID}`;
    // Sits directly under the job prefix, not a pod log.
    expect(parseS3LogObjectKey(`${base}/job-metadata.log`, JOB_ID)).toBeUndefined();
    // control-logs entry without a stream segment is incomplete.
    expect(parseS3LogObjectKey(`${base}/control-logs/pod`, JOB_ID)).toBeUndefined();
    // Unrecognized subtree names are not guessed at.
    expect(parseS3LogObjectKey(`${base}/other-logs/pod/stderr.gz`, JOB_ID)).toBeUndefined();
  });

  it("prefers driver stderr as the default log selection", () => {
    const items: Array<JobLogStream | JobLogObject> = [
      cloudWatch(`containers/spark-${JOB_ID}/spark-${JOB_ID}-77fab59ebcabdbc6-exec-1/stderr`),
      cloudWatch(`containers/spark-${JOB_ID}/spark-${JOB_ID}-driver/stdout`),
      cloudWatch(`containers/spark-${JOB_ID}/spark-${JOB_ID}-driver/stderr`)
    ];

    expect(pickDefaultLogItem(items)).toMatchObject({
      type: "driver",
      stream: "stderr",
      pod: `spark-${JOB_ID}-driver`
    });
  });

  it("builds grouped tree sections for controller, driver, and executors", () => {
    const items: Array<JobLogStream | JobLogObject> = [
      cloudWatch(`containers/${JOB_ID}-xz7ms/stdout`),
      cloudWatch(`containers/${JOB_ID}-xz7ms/stderr`),
      cloudWatch(`containers/spark-${JOB_ID}/spark-${JOB_ID}-driver/stdout`),
      cloudWatch(`containers/spark-${JOB_ID}/spark-${JOB_ID}-driver/stderr`),
      cloudWatch(`containers/spark-${JOB_ID}/spark-${JOB_ID}-77fab59ebcabdbc6-exec-1/stderr`)
    ];

    expect(buildEmrLogTree(items)).toMatchObject([
      {
        type: "controller",
        label: "Controller",
        groups: [{ label: `${JOB_ID}-xz7ms`, items: [{ stream: "stderr" }, { stream: "stdout" }] }]
      },
      {
        type: "driver",
        label: "Driver",
        groups: [{ label: `spark-${JOB_ID}-driver`, items: [{ stream: "stderr" }, { stream: "stdout" }] }]
      },
      {
        type: "executor",
        label: "Executors",
        groups: [{ label: `spark-${JOB_ID}-77fab59ebcabdbc6-exec-1`, items: [{ stream: "stderr" }] }]
      }
    ]);
  });

  it("groups control-logs pods alongside container logs in the Controller section", () => {
    const base = `logs/${VIRTUAL_CLUSTER_ID}/jobs/${JOB_ID}`;
    const items = [
      parseS3LogObjectKey(`${base}/control-logs/${JOB_ID}-qs8tm/stderr.gz`, JOB_ID)!,
      parseS3LogObjectKey(`${base}/containers/spark-${JOB_ID}/spark-${JOB_ID}-driver/stderr.gz`, JOB_ID)!,
      parseS3LogObjectKey(
        `${base}/containers/spark-${JOB_ID}/spark-${JOB_ID}-890693a03d3a548b-exec-1/stdout.gz`,
        JOB_ID
      )!
    ];

    expect(buildEmrLogTree(items)).toMatchObject([
      {
        type: "controller",
        label: "Controller",
        groups: [{ label: `${JOB_ID}-qs8tm`, items: [{ stream: "stderr" }] }]
      },
      {
        type: "driver",
        label: "Driver",
        groups: [{ label: `spark-${JOB_ID}-driver`, items: [{ stream: "stderr" }] }]
      },
      {
        type: "executor",
        label: "Executors",
        groups: [{ label: `spark-${JOB_ID}-890693a03d3a548b-exec-1`, items: [{ stream: "stdout" }] }]
      }
    ]);
  });
});

function cloudWatch(suffix: string): JobLogStream {
  const streamName = `20260612/${VIRTUAL_CLUSTER_ID}/jobs/${JOB_ID}/${suffix}`;
  return parseCloudWatchLogStream(streamName, JOB_ID)!;
}
