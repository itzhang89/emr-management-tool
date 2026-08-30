import { useState } from "react";
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
  // LLM Setting instead of telling them to find the tab themselves.
  const [tab, setTab] = useState("chat");

  return (
    // Chat and Audit need the full height to scroll on their own, so the page
    // lets each tab manage its own overflow instead of scrolling as a whole.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
      <PageHeader pageId="ai" />

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="settings">LLM Setting</TabsTrigger>
          <TabsTrigger value="server">MCP Server</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-0 flex min-h-0 flex-1 flex-col">
          <ChatPanel onConfigureModels={() => setTab("settings")} />
        </TabsContent>

        <TabsContent value="settings" className="mt-0 flex min-h-0 flex-1 flex-col">
          <LlmSettingsPanel />
        </TabsContent>

        <TabsContent value="server" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          <McpServerPanel />
        </TabsContent>

        <TabsContent value="audit" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          <McpAuditPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
