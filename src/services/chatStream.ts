import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import { CHAT_EVENTS } from "@/types/domain";
import type {
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatTitleEvent,
  ChatToolEvent
} from "@/types/domain";

export type ChatStreamHandlers = {
  onDelta: (event: ChatDeltaEvent) => void;
  onTool: (event: ChatToolEvent) => void;
  onDone: (event: ChatDoneEvent) => void;
  onError: (event: ChatErrorEvent) => void;
  onTitle: (event: ChatTitleEvent) => void;
};

/**
 * Subscribes to the Rust chat loop's progress channels.
 *
 * Returns an unsubscribe function. Outside the Tauri runtime it is a no-op, so
 * the Chat panel renders in tests and in a browser without special-casing.
 */
export async function bindChatStreamEvents(handlers: ChatStreamHandlers) {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const unlisteners = await Promise.all([
    listen<ChatDeltaEvent>(CHAT_EVENTS.delta, (event) => handlers.onDelta(event.payload)),
    listen<ChatToolEvent>(CHAT_EVENTS.tool, (event) => handlers.onTool(event.payload)),
    listen<ChatDoneEvent>(CHAT_EVENTS.done, (event) => handlers.onDone(event.payload)),
    listen<ChatErrorEvent>(CHAT_EVENTS.error, (event) => handlers.onError(event.payload)),
    listen<ChatTitleEvent>(CHAT_EVENTS.title, (event) => handlers.onTitle(event.payload))
  ]);

  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}

/**
 * The in-flight assistant turn, assembled from stream events.
 *
 * Streaming state is kept out of the react-query cache: a token-by-token write
 * would re-render the whole message list on every delta. Once `chat:done` lands
 * the persisted rows become the source of truth and this is discarded.
 */
export type StreamingTurn = {
  sessionId: string;
  messageId: string;
  text: string;
  /** Tool steps in the order they started, updated in place when they end. */
  toolCalls: ChatToolEvent[];
  error?: string;
};

export function emptyStreamingTurn(sessionId: string, messageId = ""): StreamingTurn {
  return { sessionId, messageId, text: "", toolCalls: [] };
}

/** Appends a text delta, adopting the message id the backend assigned. */
export function applyDelta(turn: StreamingTurn, event: ChatDeltaEvent): StreamingTurn {
  return {
    ...turn,
    messageId: event.messageId || turn.messageId,
    text: turn.text + event.text
  };
}

/**
 * Records a tool step. A "start" appends it; an "end" replaces the matching
 * entry so its result and duration land on the step already on screen rather
 * than adding a duplicate row.
 */
export function applyToolEvent(turn: StreamingTurn, event: ChatToolEvent): StreamingTurn {
  const index = turn.toolCalls.findIndex((call) => call.callId === event.callId);
  const toolCalls =
    index === -1
      ? [...turn.toolCalls, event]
      : turn.toolCalls.map((call, position) => (position === index ? event : call));

  return { ...turn, messageId: event.messageId || turn.messageId, toolCalls };
}

/**
 * Attaches a failure to the in-flight turn.
 *
 * The chat panel does not use this: `chat:error` ends the turn, and the assistant
 * row persisted by the backend already carries the error, so the panel drops the
 * streaming turn and lets the refreshed transcript show it once. Kept because a
 * caller that wants to render a partial answer plus its failure reason without
 * re-reading the transcript needs exactly this.
 */
export function applyError(turn: StreamingTurn, event: ChatErrorEvent): StreamingTurn {
  return { ...turn, messageId: event.messageId || turn.messageId, error: event.message };
}
