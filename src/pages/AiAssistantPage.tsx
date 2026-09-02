import { useCallback, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { ChatPanel } from "@/components/ai/chat/ChatPanel";
import { LlmSettingsPanel } from "@/components/ai/settings/LlmSettingsPanel";
import { McpServerPanel } from "@/components/ai/server/McpServerPanel";
import { McpAuditPanel } from "@/components/ai/server/McpAuditPanel";

/**
 * All of the app's AI capabilities in one place. Chat is the daily entry point;
 * LLM Setting configures providers; MCP Server and Audit are the operations
 * views for the in-process tool server external agents connect to.
 */
export function AiAssistantPage() {
  // Controlled so Chat's empty state can send an unconfigured user straight to
  // LLM Setting instead of telling them to find the tab themselves. A providerId
  // carries over which provider an errored reply belongs to, so the settings
  // tab can open on that provider's row.
  const [tab, setTab] = useState("chat");
  const [settingsProviderId, setSettingsProviderId] = useState<string | null>(null);

  // The panel clears the request once applied, so asking for the same provider
  // again still preselects it.
  const clearSettingsProvider = useCallback(() => setSettingsProviderId(null), []);

  return (
    // Pinned to the viewport the same way Logs and S3 Browser are (3rem is the
    // main element's padding): Chat and Audit scroll inside themselves, so the
    // page must not be free to grow and hand its overflow to the window.
    <div className="flex h-[calc(100vh-3rem)] min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
      <PageHeader pageId="ai" />

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="settings">LLM Setting</TabsTrigger>
          <TabsTrigger value="server">MCP Server</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ChatPanel
            onConfigureModels={(providerId) => {
              setSettingsProviderId(providerId ?? null);
              setTab("settings");
            }}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <LlmSettingsPanel
            preselectProviderId={settingsProviderId}
            onPreselectHandled={clearSettingsProvider}
          />
        </TabsContent>

        <TabsContent value="server" className="mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto">
          <McpServerPanel />
        </TabsContent>

        <TabsContent value="audit" className="mt-0 min-h-0 min-w-0 flex-1 overflow-y-auto">
          <McpAuditPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
