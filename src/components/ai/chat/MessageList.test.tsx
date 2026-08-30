import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
  it("scrolls its own container rather than the page", () => {
    const { rerender } = render(
      <MessageList
        sessionId="s1"
        messages={[message()]}
        streaming={null}
        isLoading={false}
        emptyHint={null}
      />
    );

    const container = transcript();
    expect(container.className).toContain("overflow-y-auto");
    makeScrollable(container);

    rerender(
      <MessageList
        sessionId="s1"
        messages={[message(), message({ id: "m2", seq: 1, content: "and this one?" })]}
        streaming={null}
        isLoading={false}
        emptyHint={null}
      />
    );

    // A new message pulls the transcript to the end — the page is untouched.
    expect(container.scrollTop).toBe(1000);
  });

  it("opens a conversation at its most recent messages", () => {
    const { rerender } = render(
      <MessageList
        sessionId="s1"
        messages={[]}
        streaming={null}
        isLoading
        emptyHint={null}
      />
    );

    const container = transcript();
    makeScrollable(container);

    // Loading finishing is when the stored transcript first has a height.
    rerender(
      <MessageList
        sessionId="s1"
        messages={[message(), message({ id: "m2", seq: 1 })]}
        streaming={null}
        isLoading={false}
        emptyHint={null}
      />
    );

    expect(container.scrollTop).toBe(1000);
  });

  it("keeps following the reply while the user sits at the bottom", () => {
    let turn = emptyStreamingTurn("s1");
    const { rerender } = render(
      <MessageList
        sessionId="s1"
        messages={[message()]}
        streaming={turn}
        isLoading={false}
        emptyHint={null}
      />
    );

    const container = transcript();
    makeScrollable(container);
    container.scrollTop = 700; // 1000 - 700 - 300 = at the bottom

    turn = { ...turn, text: "the driver ran out of memory" };
    rerender(
      <MessageList
        sessionId="s1"
        messages={[message()]}
        streaming={turn}
        isLoading={false}
        emptyHint={null}
      />
    );

    expect(container.scrollTop).toBe(1000);
  });

  it("leaves the view alone while the user reads back through the transcript", () => {
    let turn = emptyStreamingTurn("s1");
    const { rerender } = render(
      <MessageList
        sessionId="s1"
        messages={[message()]}
        streaming={turn}
        isLoading={false}
        emptyHint={null}
      />
    );

    const container = transcript();
    makeScrollable(container);
    container.scrollTop = 100; // scrolled up to re-read an earlier log excerpt

    turn = { ...turn, text: "still streaming" };
    rerender(
      <MessageList
        sessionId="s1"
        messages={[message()]}
        streaming={turn}
        isLoading={false}
        emptyHint={null}
      />
    );

    // Yanking them to the bottom mid-read would fight the user.
    expect(container.scrollTop).toBe(100);
  });

  it("shows the empty hint when there is nothing to scroll", () => {
    render(
      <MessageList
        sessionId={null}
        messages={[]}
        streaming={null}
        isLoading={false}
        emptyHint={<p>Paste a job id</p>}
      />
    );

    expect(screen.getByText("Paste a job id")).toBeInTheDocument();
  });
});
