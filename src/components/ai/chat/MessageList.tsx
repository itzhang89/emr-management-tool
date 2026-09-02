import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, LoaderCircle, User, X } from "lucide-react";
import {
  AssistantMessage,
  ContextResetDivider,
  UserMessage,
  type ModelActionOption
} from "@/components/ai/chat/MessageBubble";
import { toolStepFromEvent, toolStepFromStored } from "@/components/ai/chat/ToolCallStep";
import { Textarea } from "@/components/ui/textarea";
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
  onCopy,
  onEdit,
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
  onCopy: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage, newText: string) => void;
  onDelete: (message: ChatMessage) => void;
  onRegenerate: (message: ChatMessage) => void;
  onRegenerateWithModel: (message: ChatMessage, modelId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const assistantName = assistant?.name ?? "Assistant";

  // The user message being edited in place, or null. Lives here (not in
  // ChatPanel) because this component renders the bubbles and must swap the one
  // under edit for a textarea. Keyed by message id, reset on session change.
  const [editing, setEditing] = useState<{ message: ChatMessage; draft: string } | null>(null);

  const commitEdit = () => {
    if (!editing) return;
    const original = editing.message.content ?? "";
    const trimmed = editing.draft.trim();
    setEditing(null);
    // An unchanged or empty edit just closes the editor — no re-answer.
    if (!trimmed || trimmed === original.trim()) return;
    onEdit(editing.message, trimmed);
  };

  const scrollToBottom = () => {
    const container = scrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  };

  // Opening a conversation shows its most recent messages, not its oldest. Before
  // paint, so it does not read as a scroll down from the top.
  useLayoutEffect(scrollToBottom, [sessionId, isLoading]);

  // Editing state belongs to one conversation; a session switch closes any editor.
  useEffect(() => setEditing(null), [sessionId]);

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
              if (editing?.message.id === message.id) {
                return (
                  <UserMessageEditor
                    key={message.id}
                    draft={editing.draft}
                    onDraftChange={(draft) =>
                      setEditing((current) => (current ? { ...current, draft } : current))
                    }
                    onSave={commitEdit}
                    onCancel={() => setEditing(null)}
                  />
                );
              }
              return (
                <UserMessage
                  key={message.id}
                  text={message.content ?? ""}
                  onCopy={() => onCopy(message)}
                  onEdit={() => setEditing({ message, draft: message.content ?? "" })}
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

/**
 * The user message body replaced by a textarea while it is edited in place.
 *
 * Enter saves and re-answers (mirroring the composer); Shift+Enter adds a line
 * break; Esc or ✕ cancels. Saving unchanged text just closes the editor — the
 * caller decides that, so this component only guards against saving nothing.
 */
function UserMessageEditor({
  draft,
  onDraftChange,
  onSave,
  onCancel
}: {
  draft: string;
  onDraftChange: (draft: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const trimmed = draft.trim();

  return (
    <div className="flex gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <User className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">You</p>
        <Textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (trimmed) onSave();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          aria-label="Edited question"
          autoFocus
          className="min-h-20 resize-y whitespace-pre-wrap text-sm"
        />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <p className="text-[10px] text-muted-foreground">
            Enter to re-answer · Esc to cancel · saving removes the reply and everything after it
          </p>
          <span className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Cancel editing"
              onClick={onCancel}
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Save and re-answer"
              onClick={onSave}
              disabled={!trimmed}
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <Check className="size-3.5" />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
