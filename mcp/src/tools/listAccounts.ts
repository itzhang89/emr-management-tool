import type { BridgeClient } from "../bridge/client.js";

export function buildListAccountsTool(client: BridgeClient) {
  return async () => {
    const accounts = await client.listAccounts();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            accounts.map((a) => ({
              id: a.id,
              name: a.name,
              username: a.username,
              region: a.region,
              isActive: a.isActive,
            })),
            null,
            2,
          ),
        },
      ],
    };
  };
}