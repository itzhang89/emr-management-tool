import { z } from "zod";
import type { AuditStore } from "../audit/types.js";

export const GetAuditEntryArgs = z.object({
  entryId: z.string().min(1, "entryId is required"),
  includeRawText: z.boolean().optional().default(false),
});

export type GetAuditEntryArgs = z.infer<typeof GetAuditEntryArgs>;

export function buildGetAuditEntryTool(auditStore: AuditStore) {
  return async (args: GetAuditEntryArgs) => {
    const entry = await auditStore.get(args.entryId);

    if (!entry) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: `Audit entry not found: ${args.entryId}` }),
          },
        ],
      };
    }

    if (!args.includeRawText) {
      // Don't expose raw text by default
      const { rawText, ...safe } = entry;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(safe, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(entry, null, 2),
        },
      ],
    };
  };
}