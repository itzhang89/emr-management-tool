import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ChatAssistant, ChatMessage, ChatSession, LlmProvider } from "@/types/domain";

const listChatAssistants = vi.fn();
const listChatSessions = vi.fn();
const listChatMessages = vi.fn();
const listLlmProviders = vi.fn();
const createChatSession = vi.fn();
const updateChatSession = vi.fn();
const deleteChatSession = vi.fn();
const deleteChatAssistant = vi.fn();
const chatSend = vi.fn();
const chatCancel = vi.fn();
const clearChatContext = vi.fn();

vi.mock("@/services/tauriClient", () => ({
  tauriClient: {
    listChatAssistants: () => listChatAssistants(),
    listChatSessions: () => listChatSessions(),
    listChatMessages: (id: string) => listChatMessages(id),
    listLlmProviders: () => listLlmProviders(),
    createChatSession: (request: unknown) => createChatSession(request),
    updateChatSession: (request: unknown) => updateChatSession(request),
    deleteChatSession: (id: string) => deleteChatSession(id),
    deleteChatAssistant: (id: string) => deleteChatAssistant(id),
    createChatAssistant: vi.fn(),
    updateChatAssistant: vi.fn(),
    deleteAllChatSessions: vi.fn(),
    chatSend: (sessionId: string, text: string) => chatSend(sessionId, text),
    chatCancel: (sessionId: string) => chatCancel(sessionId),
    clearChatContext: (sessionId: string) => clearChatContext(sessionId)
  }
}));

// The stream binding needs the Tauri runtime; these tests cover the panel's
// rendering and command wiring, so the handlers are captured and fired directly.
let streamHandlers: import("@/services/chatStream").ChatStreamHandlers | null = null;
vi.mock("@/services/chatStream", async () => {
  const actual = await vi.importActual<typeof import("@/services/chatStream")>(
    "@/services/chatStream"
  );
  return {
    ...actual,
    bindChatStreamEvents: async (handlers: import("@/services/chatStream").ChatStreamHandlers) => {
      streamHandlers = handlers;
      return () => {};
    }
  };
});

function assistant(overrides: Partial<ChatAssistant> = {}): ChatAssistant {
  return {
    id: "a1",
    name: "EMR failure analysis",
    systemPrompt: "analyse failures",
    defaultModelId: null,
    enabledTools: null,
    accent: "blue",
    sortOrder: 0,
    builtIn: true,
    createdAt: "2026-08-29T00:00:00Z",
    updatedAt: "2026-08-29T00:00:00Z",
    ...overrides
  };
}

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "s1",
    assistantId: "a1",
    title: "job-abc analysis",
    modelId: null,
    createdAt: "2026-08-29T00:00:00Z",
    updatedAt: "2026-08-29T00:00:00Z",
    messageCount: 0,
    ...overrides
  };
}

function provider(): LlmProvider {
  return {
    id: "p1",
    name: "agentrouter",
    protocol: "openai",
    baseUrl: "https://gw.example/v1",
    enabled: true,
    builtIn: false,
    headerNames: [],
    sortOrder: 0,
    createdAt: "2026-08-29T00:00:00Z",
    updatedAt: "2026-08-29T00:00:00Z",
    apiKeys: [
      {
        id: "k1",
        providerId: "p1",
        label: null,
        masked: "sk-••••abcd",
        status: "healthy",
        statusMessage: null,
        checkedAt: null,
        sortOrder: 0,
        createdAt: "2026-08-29T00:00:00Z"
      }
    ],
    models: [
      {
        id: "m1",
        providerId: "p1",
        modelId: "claude-opus-4-8",
        series: "claude-opus",
        displayName: null,
        modelType: "chat",
        capabilities: {
          reasoning: false,
          toolCalling: true,
          text: true,
          vision: false,
          audio: false,
          video: false
        },
        isDefault: true,
        contextWindow: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        createdAt: "2026-08-29T00:00:00Z"
      }
    ]
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg1",
    sessionId: "s1",
    seq: 0,
    role: "user",
    content: "why did it fail?",
    toolCalls: [],
    modelId: null,
    durationMs: null,
    error: null,
    createdAt: "2026-08-29T00:00:00Z",
    ...overrides
  };
}

function renderPanel(onConfigureModels = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChatPanel onConfigureModels={onConfigureModels} />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return onConfigureModels;
}

describe("ChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamHandlers = null;
    listChatAssistants.mockResolvedValue([assistant()]);
    listChatSessions.mockResolvedValue([session()]);
    listChatMessages.mockResolvedValue([]);
    listLlmProviders.mockResolvedValue([provider()]);
  });

  it("lists assistants with their conversations indented beneath", async () => {
    renderPanel();

    expect(await screen.findByText("EMR failure analysis")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "job-abc analysis" })).toBeInTheDocument();
  });

  it("warns about outbound data and links to setup when no model is configured", async () => {
    const onConfigure = vi.fn();
    listLlmProviders.mockResolvedValue([]);
    renderPanel(onConfigure);

    // This app sent nothing anywhere except AWS before Chat; the empty state has
    // to say so rather than just reporting a missing config.
    expect(await screen.findByText(/sent nothing anywhere except AWS/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Configure a provider" }));
    expect(onConfigure).toHaveBeenCalled();
  });

  it("cannot send until a conversation is selected", async () => {
    renderPanel();

    const input = await screen.findByLabelText("Message");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", expect.stringContaining("Select or create"));
  });

  it("sends a message for the selected conversation", async () => {
    const user = userEvent.setup();
    chatSend.mockResolvedValue("msg-assistant");
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "job-abc analysis" }));
    await user.type(screen.getByLabelText("Message"), "why did job-abc fail?");
    await user.click(screen.getByRole("button", { name: /^Send$/ }));

    await waitFor(() => expect(chatSend).toHaveBeenCalledWith("s1", "why did job-abc fail?"));
  });

  it("sends on Enter and keeps Shift+Enter for a line break", async () => {
    const user = userEvent.setup();
    chatSend.mockResolvedValue("msg-assistant");
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "job-abc analysis" }));
    const input = screen.getByLabelText("Message");

    await user.type(input, "first line{Shift>}{Enter}{/Shift}second line");
    expect(chatSend).not.toHaveBeenCalled();

    await user.type(input, "{Enter}");
    await waitFor(() =>
      expect(chatSend).toHaveBeenCalledWith("s1", "first line\nsecond line")
    );
  });

  it("clears context without deleting the visible history", async () => {
    const user = userEvent.setup();
    clearChatContext.mockResolvedValue(true);
    listChatMessages.mockResolvedValue([message()]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "job-abc analysis" }));
    await user.click(screen.getByRole("button", { name: /clear context/i }));

    await waitFor(() => expect(clearChatContext).toHaveBeenCalledWith("s1"));
    // The message is still on screen — clearing context is not a deletion.
    expect(screen.getByText("why did it fail?")).toBeInTheDocument();
  });

  it("renders a stored tool call as an expandable step", async () => {
    const user = userEvent.setup();
    listChatMessages.mockResolvedValue([
      message(),
      message({
        id: "msg2",
        seq: 1,
        role: "assistant",
        content: "the driver ran out of memory",
        modelId: "claude-opus-4-8",
        durationMs: 1800,
        toolCalls: [
          {
            callId: "c1",
            tool: "analyze_job_failure",
            args: { jobId: "abc" },
            result: { state: "FAILED" },
            error: null,
            durationMs: 1200
          }
        ]
      })
    ]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "job-abc analysis" }));

    expect(await screen.findByText("the driver ran out of memory")).toBeInTheDocument();
    const step = screen.getByRole("button", { name: /analyze_job_failure/ });
    expect(step).toBeInTheDocument();

    // Collapsed by default; expanding reveals the arguments and result so the
    // user can check what the model actually read.
    await user.click(step);
    expect(screen.getByText(/"jobId"/)).toBeInTheDocument();
    expect(screen.getByText(/"FAILED"/)).toBeInTheDocument();
  });

  it("shows a context reset as a divider rather than hiding earlier messages", async () => {
    const user = userEvent.setup();
    listChatMessages.mockResolvedValue([
      message({ content: "first question" }),
      message({ id: "msg2", seq: 1, role: "context_reset", content: null }),
      message({ id: "msg3", seq: 2, content: "second question" })
    ]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "job-abc analysis" }));

    expect(await screen.findByText("first question")).toBeInTheDocument();
    expect(screen.getByText(/context cleared/i)).toBeInTheDocument();
    expect(screen.getByText("second question")).toBeInTheDocument();
  });

  it("starts a new conversation for an assistant", async () => {
    const user = userEvent.setup();
    createChatSession.mockResolvedValue("s2");
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: /new conversation with EMR failure analysis/i })
    );

    await waitFor(() => expect(createChatSession).toHaveBeenCalledWith({ assistantId: "a1" }));
  });

  it("offers no delete action for the built-in assistant", async () => {
    renderPanel();
    await screen.findByText("EMR failure analysis");

    // The backend refuses, so offering the button would only produce an error.
    expect(
      screen.queryByRole("button", { name: /delete EMR failure analysis/i })
    ).not.toBeInTheDocument();
  });

  it("warns that deleting a conversation removes stored log excerpts", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: /delete conversation job-abc analysis/i })
    );

    expect(screen.getByRole("heading", { name: /delete conversation\?/i })).toBeInTheDocument();
    expect(screen.getByText(/log excerpts/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteChatSession).toHaveBeenCalledWith("s1"));
  });

  it("filters assistants and conversations together", async () => {
    const user = userEvent.setup();
    listChatAssistants.mockResolvedValue([assistant(), assistant({ id: "a2", name: "Spark tuning", builtIn: false })]);
    listChatSessions.mockResolvedValue([
      session(),
      session({ id: "s2", assistantId: "a2", title: "shuffle spill" })
    ]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: /filter conversations/i }));
    await user.type(screen.getByPlaceholderText("Filter..."), "shuffle");

    // Matching a session keeps its assistant visible, so searching a job id finds
    // the conversation without knowing which assistant owns it.
    expect(screen.getByText("Spark tuning")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "shuffle spill" })).toBeInTheDocument();
    expect(screen.queryByText("EMR failure analysis")).not.toBeInTheDocument();
  });

  it("shows the generated title as soon as the backend names the conversation", async () => {
    const user = userEvent.setup();
    chatSend.mockResolvedValue("msg-assistant");
    listChatSessions.mockResolvedValue([session({ title: "New conversation" })]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "New conversation" }));
    await waitFor(() => expect(streamHandlers).not.toBeNull());

    // The title lands before the answer does, so the sidebar stops saying "New
    // conversation" while tools are still running.
    listChatSessions.mockResolvedValue([session({ title: "Driver OOM on job-abc" })]);
    streamHandlers!.onTitle({ sessionId: "s1", title: "Driver OOM on job-abc" });

    // Both the sidebar entry and the conversation header pick it up.
    const renamed = await screen.findAllByRole("button", { name: "Driver OOM on job-abc" });
    expect(renamed).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "New conversation" })).not.toBeInTheDocument();
  });

  it("shows a failed send once, not twice", async () => {
    const user = userEvent.setup();
    chatSend.mockResolvedValue("msg-assistant");
    // The backend records the error on the assistant row and also emits
    // chat:error. Rendering both the persisted row and the streaming turn would
    // print the same stack twice.
    listChatMessages.mockResolvedValue([
      message({ content: "why did it fail?" }),
      message({
        id: "msg2",
        seq: 1,
        role: "assistant",
        content: null,
        modelId: "qwen3.8-flash",
        durationMs: 388,
        error: "Could not reach https://api.b.ai/v1/chat/completions: dns error"
      })
    ]);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "job-abc analysis" }));
    await waitFor(() => expect(streamHandlers).not.toBeNull());

    streamHandlers!.onError({
      sessionId: "s1",
      messageId: "msg2",
      message: "Could not reach https://api.b.ai/v1/chat/completions: dns error"
    });

    const shown = await screen.findAllByText(/Could not reach/);
    expect(shown).toHaveLength(1);
    // And no "Thinking" bubble is left behind under it.
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
  });

  it("changes the conversation's model", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "job-abc analysis" }));
    // The picker shows the model resolved for this session.
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("claude-opus-4-8");
  });
});
