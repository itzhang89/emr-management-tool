import { describe, expect, it } from "vitest";
import {
  applyDelta,
  applyError,
  applyToolEvent,
  emptyStreamingTurn,
  type StreamingTurn
} from "./chatStream";
import type { ChatToolEvent } from "@/types/domain";

function toolEvent(overrides: Partial<ChatToolEvent> = {}): ChatToolEvent {
  return {
    sessionId: "s1",
    messageId: "m1",
    callId: "c1",
    tool: "find_job",
    args: { jobId: "abc" },
    phase: "start",
    ...overrides
  };
}

describe("streaming turn assembly", () => {
  it("accumulates text deltas in order", () => {
    let turn = emptyStreamingTurn("s1");
    turn = applyDelta(turn, { sessionId: "s1", messageId: "m1", text: "Check" });
    turn = applyDelta(turn, { sessionId: "s1", messageId: "m1", text: "ing" });

    expect(turn.text).toBe("Checking");
    // The backend's message id is adopted from the first event that carries it.
    expect(turn.messageId).toBe("m1");
  });

  it("appends a tool step when it starts", () => {
    const turn = applyToolEvent(emptyStreamingTurn("s1"), toolEvent());
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]!.phase).toBe("start");
  });

  it("replaces the step in place when it ends", () => {
    let turn = applyToolEvent(emptyStreamingTurn("s1"), toolEvent());
    turn = applyToolEvent(
      turn,
      toolEvent({ phase: "end", durationMs: 1800, result: { found: true } })
    );

    // The end event updates the row already on screen rather than adding one.
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]!.phase).toBe("end");
    expect(turn.toolCalls[0]!.durationMs).toBe(1800);
    expect(turn.toolCalls[0]!.result).toEqual({ found: true });
  });

  it("keeps parallel tool calls apart", () => {
    let turn = applyToolEvent(emptyStreamingTurn("s1"), toolEvent({ callId: "c1" }));
    turn = applyToolEvent(turn, toolEvent({ callId: "c2", tool: "describe_job" }));
    turn = applyToolEvent(turn, toolEvent({ callId: "c1", phase: "end", durationMs: 10 }));

    expect(turn.toolCalls.map((call) => call.callId)).toEqual(["c1", "c2"]);
    expect(turn.toolCalls[0]!.phase).toBe("end");
    expect(turn.toolCalls[1]!.phase).toBe("start");
  });

  it("records a failed tool step with its error", () => {
    const turn = applyToolEvent(
      applyToolEvent(emptyStreamingTurn("s1"), toolEvent()),
      toolEvent({ phase: "end", error: "job not found", durationMs: 40 })
    );

    expect(turn.toolCalls[0]!.error).toBe("job not found");
  });

  it("keeps streamed text when the turn errors", () => {
    let turn: StreamingTurn = emptyStreamingTurn("s1");
    turn = applyDelta(turn, { sessionId: "s1", messageId: "m1", text: "partial" });
    turn = applyError(turn, { sessionId: "s1", messageId: "m1", message: "rate limited" });

    // A partial answer plus its failure reason beats an empty bubble.
    expect(turn.text).toBe("partial");
    expect(turn.error).toBe("rate limited");
  });
});
