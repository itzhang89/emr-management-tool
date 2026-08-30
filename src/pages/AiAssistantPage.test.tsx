import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { AiAssistantPage } from "./AiAssistantPage";
import { TooltipProvider } from "@/components/ui/tooltip";

// The two ported panels own their own data fetching; this suite is about the
// tab shell, so they are stubbed to keep it free of Tauri mocking.
vi.mock("@/components/ai/server/McpServerPanel", () => ({
  McpServerPanel: () => <div data-testid="mcp-server-panel">Server</div>
}));

vi.mock("@/components/ai/server/McpAuditPanel", () => ({
  McpAuditPanel: () => <div data-testid="mcp-audit-panel">Audit</div>
}));

vi.mock("@/components/ai/settings/LlmSettingsPanel", () => ({
  LlmSettingsPanel: () => <div data-testid="llm-settings-panel">Settings</div>
}));

vi.mock("@/components/ai/chat/ChatPanel", () => ({
  ChatPanel: ({ onConfigureModels }: { onConfigureModels: () => void }) => (
    <div data-testid="chat-panel">
      <button type="button" onClick={onConfigureModels}>
        Configure a provider
      </button>
    </div>
  )
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AiAssistantPage />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("AiAssistantPage", () => {
  it("shows the four AI tabs with Chat selected first", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "AI Assistant" })).toBeInTheDocument();
    for (const name of ["Chat", "LLM Setting", "MCP Server", "Audit"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("tab", { name: "Chat", selected: true })).toBeInTheDocument();
  });

  it("keeps the ported MCP server and audit panels reachable", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("tab", { name: "MCP Server" }));
    expect(screen.getByTestId("mcp-server-panel")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Audit" }));
    expect(screen.getByTestId("mcp-audit-panel")).toBeInTheDocument();
  });

  it("opens the LLM settings panel from its tab", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("tab", { name: "LLM Setting" }));
    expect(screen.getByTestId("llm-settings-panel")).toBeInTheDocument();
  });

  it("sends an unconfigured user from Chat to LLM Setting", async () => {
    const user = userEvent.setup();
    renderPage();

    // Chat's empty state links straight to the tab that fixes the problem,
    // rather than telling the user to go find it.
    await user.click(screen.getByRole("button", { name: "Configure a provider" }));

    expect(screen.getByRole("tab", { name: "LLM Setting", selected: true })).toBeInTheDocument();
    expect(screen.getByTestId("llm-settings-panel")).toBeInTheDocument();
  });
});
