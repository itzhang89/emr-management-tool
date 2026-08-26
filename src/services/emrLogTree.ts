import type { JobLogObject, JobLogStream, JobLogTreeSection, JobLogType } from "@/types/domain";

const sectionOrder: JobLogType[] = ["controller", "driver", "executor"];
const sectionLabels: Record<JobLogType, string> = {
  controller: "Controller",
  driver: "Driver",
  executor: "Executors"
};

export function parseCloudWatchLogStream(streamName: string, jobId: string): JobLogStream | undefined {
  const parsed = parseEmrLogPath(streamName, jobId);
  if (!parsed) return undefined;

  return {
    source: "cloudwatch",
    id: streamName,
    label: `${parsed.pod} ${parsed.stream}`,
    type: parsed.type,
    container: parsed.container,
    pod: parsed.pod,
    stream: parsed.stream,
    cloudWatchStreamName: streamName
  };
}

export function parseS3LogObjectKey(key: string, jobId: string, size = 0, lastModified?: string): JobLogObject | undefined {
  const normalizedKey = key.endsWith(".gz") ? key.slice(0, -3) : key;
  const parsed = parseEmrLogPath(normalizedKey, jobId);
  if (!parsed) return undefined;

  return {
    source: "s3",
    id: key,
    label: `${parsed.pod} ${parsed.stream}`,
    type: parsed.type,
    container: parsed.container,
    pod: parsed.pod,
    stream: parsed.stream,
    s3Key: key,
    size,
    lastModified
  };
}

export function pickDefaultLogItem<T extends JobLogStream | JobLogObject>(items: readonly T[]): T | undefined {
  if (!items.length) return undefined;
  return (
    items.find((item) => item.type === "driver" && item.stream === "stderr") ??
    items.find((item) => item.type === "driver") ??
    items.find((item) => item.stream === "stderr") ??
    items[0]
  );
}

export function buildEmrLogTree(items: Array<JobLogStream | JobLogObject>): JobLogTreeSection[] {
  const grouped = new Map<JobLogType, Map<string, Array<JobLogStream | JobLogObject>>>();

  for (const item of items) {
    const typeGroups = grouped.get(item.type) ?? new Map<string, Array<JobLogStream | JobLogObject>>();
    const groupItems = typeGroups.get(item.pod) ?? [];
    groupItems.push(item);
    typeGroups.set(item.pod, groupItems);
    grouped.set(item.type, typeGroups);
  }

  return sectionOrder
    .filter((type) => grouped.has(type))
    .map((type) => ({
      type,
      label: sectionLabels[type],
      groups: [...grouped.get(type)!.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, groupItems]) => ({
          label,
          items: groupItems.sort(compareLogItems)
        }))
    }));
}

/**
 * EMR on EKS writes a job's logs under `.../jobs/<jobId>/` in two subtrees:
 *
 *   containers/<container>/<pod>/<stream>   driver + executor pods
 *   control-logs/<pod>/<stream>             the job-runner / control pod
 *
 * Both are parsed into the same identity so they share one navigation tree.
 */
const CONTAINERS_SEGMENT = "containers";
const CONTROL_LOGS_SEGMENT = "control-logs";

function parseEmrLogPath(path: string, jobId: string) {
  const parts = path.split("/").filter(Boolean);
  const jobIdIndex = parts.findIndex((part, index) => part === jobId && parts[index - 1] === "jobs");
  if (jobIdIndex === -1) return undefined;

  const rest = parts.slice(jobIdIndex + 1);
  const [section, ...afterSection] = rest;

  if (section === CONTAINERS_SEGMENT) {
    if (afterSection.length < 2) return undefined;
    const stream = afterSection.at(-1)!;
    const pod = afterSection.at(-2)!;
    const container = afterSection.length > 2 ? afterSection.slice(0, -2).join("/") : pod;
    return { type: classifyPod(pod, jobId), container, pod, stream };
  }

  if (section === CONTROL_LOGS_SEGMENT) {
    // control-logs/<pod>/<stream> — always the control pod, never a Spark pod,
    // so classifyPod (which keys off driver/exec naming) does not apply.
    if (afterSection.length < 2) return undefined;
    return {
      type: "controller" as JobLogType,
      container: CONTROL_LOGS_SEGMENT,
      pod: afterSection.at(-2)!,
      stream: afterSection.at(-1)!
    };
  }

  return undefined;
}

function classifyPod(pod: string, jobId: string): JobLogType {
  const lower = pod.toLowerCase();
  const normalizedJobId = jobId.toLowerCase();
  if (lower.includes("driver")) return "driver";
  if (lower.includes("exec")) return "executor";
  if (lower.includes(`spark-${normalizedJobId}`)) return "driver";
  return "controller";
}

function compareLogItems(left: JobLogStream | JobLogObject, right: JobLogStream | JobLogObject) {
  if (left.stream === right.stream) return left.label.localeCompare(right.label);
  if (left.stream === "stderr") return -1;
  if (right.stream === "stderr") return 1;
  if (left.stream === "stdout") return -1;
  if (right.stream === "stdout") return 1;
  return left.stream.localeCompare(right.stream);
}
