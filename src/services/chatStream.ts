import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import { CHAT_EVENTS } from "@/types/domain";
import type {
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorDetails,
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
 * A tool step while it streams. `ChatToolEvent` is the wire shape; `startedAt` is
 * stamped locally when the "start" arrives so a running step can show a live
 * clock, and dropped on "end" when the backend's `durationMs` becomes
 * authoritative.
 */
export type LiveToolCall = ChatToolEvent & { startedAt?: number };

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
  toolCalls: LiveToolCall[];
  error?: string;
  /** Diagnostics behind `error`, from the chat:error event. */
  errorDetails?: ChatErrorDetails | null;
  /** When the turn began, ms epoch — drives the live elapsed clock in the UI. */
  startedAt: number;
};

export function emptyStreamingTurn(sessionId: string, messageId = ""): StreamingTurn {
  return { sessionId, messageId, text: "", toolCalls: [], startedAt: Date.now() };
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
 * Records a tool step. A "start" appends it and stamps the wall-clock time so the
 * UI can show how long it has been running; an "end" replaces the matching entry
 * (without the clock) so its result and duration land on the step already on
 * screen rather than adding a duplicate row.
 */
export function applyToolEvent(turn: StreamingTurn, event: ChatToolEvent): StreamingTurn {
  const index = turn.toolCalls.findIndex((call) => call.callId === event.callId);
  const enriched: LiveToolCall = event.phase === "start" ? { ...event, startedAt: Date.now() } : event;
  const toolCalls =
    index === -1 ? [...turn.toolCalls, enriched] : turn.toolCalls.map((call, position) => (position === index ? enriched : call));

  return { ...turn, messageId: event.messageId || turn.messageId, toolCalls };
}
