import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";

export const ListJobLogsArgs = z.object({
  jobId: z.string().min(1, "jobId is required"),
  virtualClusterId: z.string().min(1, "virtualClusterId is required"),
  accountId: z.string().optional(),
  logType: z.enum(["driver", "executor", "controller"]).optional(),
  limit: z.number().int().positive().optional(),
  nextToken: z.string().optional(),
});

export type ListJobLogsArgs = z.infer<typeof ListJobLogsArgs>;

export function buildListJobLogsTool(client: BridgeClient) {
  return async (args: ListJobLogsArgs) => {
    const logGroupName = `/aws/emr-containers/jobs/${args.jobId}`;
    const streamNamePrefix = args.jobId;

    const result = await client.listLogStreams({
      accountId: args.accountId,
      jobId: args.jobId,
      logGroupName,
      streamNamePrefix,
      nextToken: args.nextToken,
    });

    let streams = result.streams;
    if (args.logType) {
      streams = streams.filter((s) => {
        const lower = s.cloudWatchStreamName.toLowerCase();
        if (args.logType === "driver") return lower.includes("driver");
        if (args.logType === "executor") return lower.includes("exec");
        return true;
      });
    }
    if (args.limit) {
      streams = streams.slice(0, args.limit);
    }

    const tree = buildSimpleLogTree(
      streams.map((s) => ({ logStreamName: s.cloudWatchStreamName, lastEventTimestamp: s.lastEventTimestamp })),
      args.jobId,
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              jobId: args.jobId,
              logGroupName,
              sections: tree,
              nextToken: result.nextToken,
            },
            null,
            2,
          ),
        },
      ],
    };
  };
}

interface LogTreeSection {
  type: string;
  label: string;
  streams: Array<{
    name: string;
    lastEventTimestamp?: string;
  }>;
}

function buildSimpleLogTree(
  streams: Array<{ logStreamName: string; lastEventTimestamp?: string }>,
  _jobId: string,
): LogTreeSection[] {
  const sections: Record<string, LogTreeSection> = {
    controller: { type: "controller", label: "Controller", streams: [] },
    driver: { type: "driver", label: "Driver", streams: [] },
    executor: { type: "executor", label: "Executors", streams: [] },
  };

  for (const stream of streams) {
    const type = classifyStream(stream.logStreamName);
    if (sections[type]) {
      sections[type].streams.push({
        name: stream.logStreamName,
        lastEventTimestamp: stream.lastEventTimestamp,
      });
    }
  }

  return Object.values(sections).filter((s) => s.streams.length > 0);
}

function classifyStream(streamName: string): string {
  const lower = streamName.toLowerCase();
  if (lower.includes("driver")) return "driver";
  if (lower.includes("exec")) return "executor";
  return "controller";
}