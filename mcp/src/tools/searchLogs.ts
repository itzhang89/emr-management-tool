import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { sanitizeLogText } from "../sanitize/index.js";

export const SearchLogsArgs = z.object({
  jobId: z.string().min(1, "jobId is required"),
  virtualClusterId: z.string().optional(),
  accountId: z.string().optional(),
  query: z.string().min(1, "query is required"),
  logType: z.enum(["driver", "executor", "controller"]).optional(),
  limit: z.number().int().positive().optional().default(100),
});

export type SearchLogsArgs = z.infer<typeof SearchLogsArgs>;

export function buildSearchLogsTool(client: BridgeClient) {
  return async (args: SearchLogsArgs) => {
    const { jobId, query, limit } = args;

    // Resolve the virtual cluster id if the caller didn't supply one.
    let virtualClusterId = args.virtualClusterId || "";
    if (!virtualClusterId) {
      try {
        const summary = await client.describeJob({ accountId: args.accountId, jobId });
        virtualClusterId = summary.virtualClusterId || "";
      } catch {
        /* leave empty; CloudWatch prefix will still target the job's log group */
      }
    }

    const logGroupName = `/aws/emr-containers/jobs/${jobId}`;
    const streamNamePrefix = `${virtualClusterId}/jobs/${jobId}/containers`;

    let result = await client.getLogs({
      accountId: args.accountId,
      jobId,
      logGroupName,
      streamNamePrefix,
      filterPattern: query,
      limit: limit || 100,
    });

    let entries = result.entries;
    if (entries.length === 0) {
      const allResult = await client.getLogs({
        accountId: args.accountId,
        jobId,
        logGroupName,
        streamNamePrefix,
        limit: 5000,
      });
      const queryLower = query.toLowerCase();
      entries = allResult.entries.filter((e) =>
        e.message.toLowerCase().includes(queryLower),
      );
    }

    if (args.logType) {
      entries = entries.filter((e) => {
        if (args.logType === "driver") return e.streamName.toLowerCase().includes("driver");
        if (args.logType === "executor") return e.streamName.toLowerCase().includes("exec");
        return true;
      });
    }

    entries = entries.slice(0, limit);

    const sanitizedEntries: Array<{ timestamp: string; level: string; stream: string; message: string }> = entries.map((e) => ({
      timestamp: e.timestamp,
      level: e.level,
      stream: e.streamName,
      message: sanitizeLogText(e.message),
    }));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              jobId,
              query,
              totalMatches: sanitizedEntries.length,
              entries: sanitizedEntries.map((e) => ({
                timestamp: e.timestamp,
                level: e.level,
                stream: e.stream,
                message: e.message.slice(0, 500),
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  };
}