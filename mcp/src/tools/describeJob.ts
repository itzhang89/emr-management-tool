import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";

export const DescribeJobArgs = z.object({
  jobId: z.string().min(1, "jobId is required"),
  virtualClusterId: z.string().optional(),
  accountId: z.string().optional(),
});

export type DescribeJobArgs = z.infer<typeof DescribeJobArgs>;

export function buildDescribeJobTool(client: BridgeClient) {
  return async (args: DescribeJobArgs) => {
    const job = await client.describeJob({
      accountId: args.accountId,
      jobId: args.jobId,
      virtualClusterId: args.virtualClusterId,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(job, null, 2),
        },
      ],
    };
  };
}