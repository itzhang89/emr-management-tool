import { describe, expect, it } from "vitest";
import {
  applyDelta,
  applyToolEvent,
  emptyStreamingTurn
} from "@/services/chatStream";

describe("chatStream streaming turn", () => {
  it("stamps a start time on an empty turn and keeps it across deltas", () => {
    const turn = emptyStreamingTurn("s1");
    expect(typeof turn.startedAt).toBe("number");

    const next = applyDelta(turn, { sessionId: "s1", messageId: "a1", text: "hi" });
    expect(next.text).toBe("hi");
    expect(next.startedAt).toBe(turn.startedAt);
  });

  it("stamps a start time when a tool starts and drops it when it ends", () => {
    let turn = emptyStreamingTurn("s1");
    turn = applyToolEvent(turn, {
      sessionId: "s1",
      messageId: "a1",
      callId: "c1",
      tool: "find_job",
      args: {},
      phase: "start"
    });

    const running = turn.toolCalls[0];
    expect(running.phase).toBe("start");
    expect(typeof running.startedAt).toBe("number");

    // The end event carries the authoritative duration; the live clock is gone.
    turn = applyToolEvent(turn, {
      sessionId: "s1",
      messageId: "a1",
      callId: "c1",
      tool: "find_job",
      args: {},
      phase: "end",
      durationMs: 12,
      result: { ok: true }
    });
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].phase).toBe("end");
    expect(turn.toolCalls[0].durationMs).toBe(12);
    expect(turn.toolCalls[0].startedAt).toBeUndefined();
  });
});
