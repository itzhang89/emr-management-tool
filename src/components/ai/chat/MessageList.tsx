import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import {
  AssistantMessage,
  ContextResetDivider,
  UserMessage
} from "@/components/ai/chat/MessageBubble";
import { toolStepFromEvent, toolStepFromStored } from "@/components/ai/chat/ToolCallStep";
import type { StreamingTurn } from "@/services/chatStream";
import type { ChatAssistant, ChatMessage } from "@/types/domain";

/**
 * The transcript, oldest first, with the in-flight turn appended.
 *
 * Persisted messages and the streaming turn are rendered by the same components,
 * so a reply looks identical while it streams and after a restart.
 */
export function MessageList({
  messages,
  assistant,
  streaming,
  isLoading,
  emptyHint
}: {
  messages: ChatMessage[];
  assistant?: ChatAssistant;
  streaming: StreamingTurn | null;
  isLoading: boolean;
  emptyHint: React.ReactNode;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows. Keyed on the streamed text too, so
  // scrolling continues during a long reply rather than only between messages.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming?.text, streaming?.toolCalls.length]);

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading conversation...
      </p>
    );
  }

  if (messages.length === 0 && !streaming) {
    return <div className="p-4">{emptyHint}</div>;
  }

  const assistantName = assistant?.name ?? "Assistant";

  return (
    <div className="space-y-4 p-4">
      {messages.map((message) => {
        if (message.role === "context_reset") {
          return <ContextResetDivider key={message.id} />;
        }
        if (message.role === "user") {
          return <UserMessage key={message.id} text={message.content ?? ""} />;
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
          streaming
        />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
