import type { JobLogObject, JobLogStream, JobLogTreeSection, JobLogType } from "@/types/domain";
import type { CloudWatchLogDestination, S3LogDestination } from "@/services/jobLogDestinations";

const sectionLabels: Record<JobLogType, string> = {
  controller: "Controller",
  driver: "Driver",
  executor: "Executors"
};

export function formatLogPodLabel(pod: string, type: JobLogType, indexInSection: number): string {
  if (type === "controller") return "controller";
  if (type === "driver") {
    return pod.toLowerCase().includes("driver") ? "driver" : pod.split("/").pop() ?? pod;
  }
  return `exec-${indexInSection}`;
}

export function buildPodLabelIndex(tree: JobLogTreeSection[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const section of tree) {
    section.groups.forEach((group, groupIndex) => {
      index.set(`${section.type}:${group.label}`, groupIndex);
    });
  }
  return index;
}

export function formatLogBreadcrumb(
  item: JobLogStream | JobLogObject,
  podLabelIndex: number
): { sections: string[]; fullPath: string } {
  return {
    sections: [sectionLabels[item.type], formatLogPodLabel(item.pod, item.type, podLabelIndex), item.stream],
    fullPath: item.source === "s3" ? item.s3Key : item.cloudWatchStreamName
  };
}

export function getLogFullPath(
  item: JobLogStream | JobLogObject,
  destination: S3LogDestination | CloudWatchLogDestination,
  source: "s3" | "cloudwatch"
): string {
  if (source === "s3" && item.source === "s3") {
    const s3Destination = destination as S3LogDestination;
    return `s3://${s3Destination.bucket}/${item.s3Key}`;
  }
  if (item.source === "cloudwatch") {
    return item.cloudWatchStreamName;
  }
  return "";
}

export function formatDestinationItems(
  source: "s3" | "cloudwatch",
  destination: S3LogDestination | CloudWatchLogDestination
): Array<[string, string]> {
  if (source === "s3") {
    const s3 = destination as S3LogDestination;
    return [["S3 archive prefix", `s3://${s3.bucket}/${s3.prefix}`]];
  }
  const cw = destination as CloudWatchLogDestination;
  return [
    ["Log group", cw.logGroupName],
    ["Stream prefix", cw.streamNamePrefix ?? "-"]
  ];
}
