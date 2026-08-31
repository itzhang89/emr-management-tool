import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import { emptyStreamingTurn } from "@/services/chatStream";
import type { ChatMessage } from "@/types/domain";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    sessionId: "s1",
    seq: 0,
    role: "user",
    content: "why did it fail?",
    toolCalls: [],
    modelId: null,
    durationMs: null,
    error: null,
    createdAt: "2026-08-30T00:00:00Z",
    ...overrides
  };
}

const noopCallbacks = {
  onCopy: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onRegenerate: vi.fn(),
  onRegenerateWithModel: vi.fn()
};

type MessageListProps = Partial<{
  sessionId: string | null;
  messages: ChatMessage[];
  streaming: ReturnType<typeof emptyStreamingTurn> | null;
  isLoading: boolean;
  emptyHint: React.ReactNode;
  modelOptions: Parameters<typeof MessageList>[0]["modelOptions"];
  onCopy: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage, t: string) => void;
  onDelete: (m: ChatMessage) => void;
  onRegenerate: (m: ChatMessage) => void;
  onRegenerateWithModel: (m: ChatMessage, id: string) => void;
}>;

function list({ messages, streaming, ...rest }: MessageListProps = {}) {
  return (
    <TooltipProvider>
      <MessageList
        sessionId="s1"
        messages={messages ?? [message()]}
        streaming={streaming ?? null}
        isLoading={false}
        emptyHint={null}
        modelOptions={[]}
        {...noopCallbacks}
        {...rest}
      />
    </TooltipProvider>
  );
}

/** jsdom does no layout, so the container is given a scrollable geometry. */
function makeScrollable(element: HTMLElement, scrollHeight = 1000, clientHeight = 300) {
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
}

function transcript() {
  // The scroll container is the element wrapping the messages, not the page.
  return screen.getByTestId("chat-transcript");
}

describe("MessageList", () => {
  beforeEach(() => {
    for (const mock of Object.values(noopCallbacks)) mock.mockClear();
  });

  it("scrolls its own container rather than the page", () => {
    const { rerender } = render(list());

    const container = transcript();
    expect(container.className).toContain("overflow-y-auto");
    makeScrollable(container);

    rerender(
      list({ messages: [message(), message({ id: "m2", seq: 1, content: "and this one?" })] })
    );

    // A new message pulls the transcript to the end — the page is untouched.
    expect(container.scrollTop).toBe(1000);
  });

  it("opens a conversation at its most recent messages", () => {
    const { rerender } = render(list({ messages: [], streaming: null, isLoading: false }));

    const container = transcript();
    makeScrollable(container);

    // Loading finishing is when the stored transcript first has a height.
    rerender(list({ messages: [message(), message({ id: "m2", seq: 1 })] }));

    expect(container.scrollTop).toBe(1000);
  });

  it("accepts per-message actions and passes them through", async () => {
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    render(
      list({ onCopy, onDelete, modelOptions: [], messages: [message({ role: "user" })] })
    );

    // The action icons live on a row under the message; they are still in the
    // DOM even while invisible, so they can be clicked directly.
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ content: "why did it fail?" }));

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("offers regenerate and switch-model on an assistant message", async () => {
    const onRegenerate = vi.fn();
    const onRegenerateWithModel = vi.fn();
    render(
      list({
        onRegenerate,
        onRegenerateWithModel,
        modelOptions: [{ id: "m1", modelId: "claude-opus-5", providerName: "p", endpointName: "e" }],
        messages: [
          message({ role: "user", content: "why?" }),
          message({ id: "m2", seq: 1, role: "assistant", content: "driver OOM" })
        ]
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onRegenerate).toHaveBeenCalled();

    // The "@" glyph opens a model list; picking one regenerates that reply on
    // that model.
    await userEvent.click(screen.getByRole("button", { name: /different model/i }));
    await userEvent.click(screen.getByRole("button", { name: "claude-opus-5" }));
    expect(onRegenerateWithModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m2" }),
      "m1"
    );
  });

  it("shows the empty hint when there is nothing to scroll", () => {
    render(list({ sessionId: null, messages: [], emptyHint: <p>Paste a job id</p> }));

    expect(screen.getByText("Paste a job id")).toBeInTheDocument();
  });
});
