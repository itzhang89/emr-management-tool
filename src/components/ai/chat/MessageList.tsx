import { useEffect, useLayoutEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import {
  AssistantMessage,
  ContextResetDivider,
  UserMessage,
  type ModelActionOption
} from "@/components/ai/chat/MessageBubble";
import { toolStepFromEvent, toolStepFromStored } from "@/components/ai/chat/ToolCallStep";
import type { StreamingTurn } from "@/services/chatStream";
import type { ChatAssistant, ChatMessage } from "@/types/domain";

/**
 * How far from the bottom still counts as "following the conversation". Auto-
 * scrolling someone who scrolled up to re-read a log excerpt would fight them, so
 * streamed tokens only pull the view down while they are already at the end.
 */
const FOLLOW_THRESHOLD_PX = 80;

/**
 * The transcript, oldest first, with the in-flight turn appended.
 *
 * This component owns its scroll container. It was previously scrolled by an
 * ancestor through `scrollIntoView`, which scrolls *every* scrollable ancestor —
 * so a long conversation moved the whole page rather than the transcript.
 *
 * Persisted messages and the streaming turn are rendered by the same components,
 * so a reply looks identical while it streams and after a restart.
 */
export function MessageList({
  sessionId,
  messages,
  assistant,
  streaming,
  isLoading,
  emptyHint,
  modelOptions,
  editingMessageId,
  onCopy,
  onEdit,
  onConfigureProvider,
  onDelete,
  onRegenerate,
  onRegenerateWithModel
}: {
  sessionId: string | null;
  messages: ChatMessage[];
  assistant?: ChatAssistant;
  streaming: StreamingTurn | null;
  isLoading: boolean;
  emptyHint: React.ReactNode;
  modelOptions: ModelActionOption[];
  /** The user message being edited through the composer, dimmed in the transcript. */
  editingMessageId: string | null;
  onCopy: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  /** Open LLM Setting for the provider of the conversation's current model. */
  onConfigureProvider: () => void;
  onDelete: (message: ChatMessage) => void;
  onRegenerate: (message: ChatMessage) => void;
  onRegenerateWithModel: (message: ChatMessage, modelId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const assistantName = assistant?.name ?? "Assistant";

  const scrollToBottom = () => {
    const container = scrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  };

  // Opening a conversation shows its most recent messages, not its oldest. Before
  // paint, so it does not read as a scroll down from the top.
  useLayoutEffect(scrollToBottom, [sessionId, isLoading]);

  // A new message always pulls the view down: it is either the user's own, or the
  // start of the answer they just asked for.
  useEffect(scrollToBottom, [messages.length]);

  // Streamed tokens follow only from the bottom, so reading back through the
  // transcript is not interrupted mid-reply.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom <= FOLLOW_THRESHOLD_PX) {
      scrollToBottom();
    }
  }, [streaming?.text, streaming?.toolCalls.length]);

  return (
    // overscroll-contain keeps a wheel gesture that reaches the end of the
    // transcript from continuing into whatever scrolls behind it.
    <div
      ref={scrollRef}
      data-testid="chat-transcript"
      className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
    >
      {isLoading ? (
        <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading conversation...
        </p>
      ) : messages.length === 0 && !streaming ? (
        <div className="p-4">{emptyHint}</div>
      ) : (
        <div className="space-y-4 p-4">
          {messages.map((message) => {
            if (message.role === "context_reset") {
              return <ContextResetDivider key={message.id} />;
            }
            if (message.role === "user") {
              return (
                <UserMessage
                  key={message.id}
                  text={message.content ?? ""}
                  dimmed={editingMessageId === message.id}
                  onCopy={() => onCopy(message)}
                  onEdit={() => onEdit(message)}
                  onDelete={() => onDelete(message)}
                />
              );
            }
            if (message.role === "assistant") {
              return (
                <AssistantMessage
                  key={message.id}
                  assistantName={assistantName}
                  accent={assistant?.accent}
                  modelId={message.modelId}
                  text={message.content}
                  toolSteps={message.toolCalls.map(toolStepFromStored)}
                  durationMs={message.durationMs}
                  error={message.error}
                  errorDetails={message.errorDetails}
                  modelOptions={modelOptions}
                  createdAt={message.createdAt}
                  // The settings link opens the provider of the conversation's
                  // current model — which errored is the point, and the panel
                  // itself resolves that provider.
                  onConfigureProvider={onConfigureProvider}
                  onCopy={() => onCopy(message)}
                  onRegenerate={() => onRegenerate(message)}
                  onRegenerateWithModel={(modelId) => onRegenerateWithModel(message, modelId)}
                  onDelete={() => onDelete(message)}
                />
              );
            }
            // Tool rows are folded into their assistant message, so nothing to draw.
            return null;
          })}

          {streaming && (
            <AssistantMessage
              assistantName={assistantName}
              accent={assistant?.accent}
              text={streaming.text || null}
              toolSteps={streaming.toolCalls.map(toolStepFromEvent)}
              error={streaming.error}
              errorDetails={streaming.errorDetails ?? null}
              streaming
              startedAt={streaming.startedAt}
              modelOptions={modelOptions}
              onCopy={() => {}}
              onRegenerate={() => {}}
              onRegenerateWithModel={() => {}}
              onDelete={() => {}}
            />
          )}
        </div>
      )}
    </div>
  );
}
