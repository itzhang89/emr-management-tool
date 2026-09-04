import { fireEvent, render, screen } from "@testing-library/react";
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
  onRegenerateWithModel: vi.fn(),
  onSwitchVersion: vi.fn(),
  onConfigureProvider: vi.fn()
};

type MessageListProps = Partial<{
  sessionId: string | null;
  messages: ChatMessage[];
  streaming: ReturnType<typeof emptyStreamingTurn> | null;
  isLoading: boolean;
  emptyHint: React.ReactNode;
  modelOptions: Parameters<typeof MessageList>[0]["modelOptions"];
  editingMessageId: string | null;
  onCopy: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
  onRegenerate: (m: ChatMessage) => void;
  onRegenerateWithModel: (m: ChatMessage, id: string) => void;
  onSwitchVersion: (m: ChatMessage, versionId: string) => void;
  onConfigureProvider: () => void;
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
        editingMessageId={null}
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

    // The icons only exist while the message is hovered.
    await userEvent.hover(screen.getByText("why did it fail?"));

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ content: "why did it fail?" }));

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("regenerates on the active model and offers the @ model list", async () => {
    const onRegenerate = vi.fn();
    const onRegenerateWithModel = vi.fn();
    render(
      list({
        onRegenerate,
        onRegenerateWithModel,
        modelOptions: [
          { id: "m1", modelId: "claude-opus-5", providerName: "p" },
          { id: "m2", modelId: "claude-sonnet-5", providerName: "p" }
        ],
        messages: [
          message({ role: "user", content: "why?" }),
          message({ id: "m3", seq: 1, role: "assistant", content: "driver OOM" })
        ]
      })
    );

    // fireEvent keeps the hover state put while the action row stays mounted,
    // which the setup-bound userEvent.click cannot rely on for Tooltip-wrapped
    // buttons (see the edit test below).
    fireEvent.mouseEnter(screen.getByText("driver OOM"));

    // Regenerate re-answers on the version currently shown.
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onRegenerate).toHaveBeenCalled();

    // A single-version message shows no version capsules — switching needs
    // something to switch to.
    expect(screen.queryByRole("button", { name: /Show version/i })).not.toBeInTheDocument();

    // The "@" glyph opens the model list; picking one regenerates on it.
    await userEvent.click(screen.getByRole("button", { name: "Answer with another model" }));
    await userEvent.click(screen.getByRole("button", { name: /claude-sonnet-5/i }));
    expect(onRegenerateWithModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m3" }),
      "claude-sonnet-5"
    );
  });

  it("switches the displayed version from the capsule bar when one is recorded", async () => {
    const onSwitchVersion = vi.fn();
    render(
      list({
        onSwitchVersion,
        messages: [
          message({ role: "user", content: "why?" }),
          message({
            id: "m3",
            seq: 1,
            role: "assistant",
            content: "driver OOM",
            modelId: "claude-sonnet-5",
            versions: [
              {
                id: "v1",
                modelId: "claude-opus-5",
                isActive: false,
                createdAt: "2026-08-30T00:00:00Z"
              },
              {
                id: "v2",
                modelId: "claude-sonnet-5",
                isActive: true,
                createdAt: "2026-08-31T00:00:00Z"
              }
            ]
          })
        ]
      })
    );

    fireEvent.mouseEnter(screen.getByText("driver OOM"));

    // A regenerated message (two versions) reveals its version capsules as soon
    // as the action row is up — switching needs no trip through the "@" model
    // menu first. The group is drawn as one boxed, numbered set.
    const group = screen.getByRole("group", { name: "Answer versions" });
    expect(group.className).toContain("rounded-full");
    const shown = screen.getByRole("button", { name: "Showing version 2" });
    expect(shown).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Show version 1" })).toHaveTextContent("1");

    // Clicking the other version switches to it; it does not regenerate. The
    // toolbox-wrapped capsule button swallows userEvent.click in jsdom, so the
    // click is fired directly, like the Edit action test above.
    fireEvent.click(screen.getByRole("button", { name: "Show version 1" }));
    expect(onSwitchVersion).toHaveBeenCalledWith(expect.objectContaining({ id: "m3" }), "v1");
    expect(screen.queryByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });

  it("shows the empty hint when there is nothing to scroll", () => {
    render(list({ sessionId: null, messages: [], emptyHint: <p>Paste a job id</p> }));

    expect(screen.getByText("Paste a job id")).toBeInTheDocument();
  });

  it("reveals the action row on hover and hides it again on mouse leave", async () => {
    const user = userEvent.setup();
    render(list({ messages: [message({ role: "user" })] }));

    // Nothing is rendered until the message is hovered — an invisible-but-present
    // row would still answer the mouse.
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();

    const bubble = screen.getByText("why did it fail?");
    await user.hover(bubble);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

    await user.unhover(bubble);
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("asks the parent to load an edit into the composer", async () => {
    const onEdit = vi.fn();
    render(list({ onEdit, messages: [message({ role: "user", content: "why did it fail?" })] }));

    // Note: userEvent.setup() → user.click() on a Tooltip-wrapped button
    // doesn't fire in jsdom. The module-level userEvent.click() works, so
    // we use it here.
    await userEvent.hover(screen.getByText("why did it fail?"));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("dims the user message being edited", () => {
    render(
      list({
        editingMessageId: "m1",
        messages: [message({ role: "user", content: "why did it fail?" })]
      })
    );

    expect(screen.getByText("why did it fail?").closest(".opacity-50")).not.toBeNull();
  });

  it("links an errored reply to the conversation's provider settings", async () => {
    const user = userEvent.setup();
    const onConfigureProvider = vi.fn();
    render(
      list({
        onConfigureProvider,
        messages: [
          message({ role: "user", content: "why?" }),
          message({
            id: "m2",
            seq: 1,
            role: "assistant",
            content: null,
            modelId: "claude-opus-4-8",
            error: "The provider returned HTTP 401."
          })
        ]
      })
    );

    await user.click(screen.getByRole("button", { name: /open provider settings/i }));
    // The provider is resolved by the panel from the conversation's current
    // model, not from this errored reply, so the callback takes no argument.
    expect(onConfigureProvider).toHaveBeenCalled();
  });
});
