import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, PanelLeftClose, PanelLeftOpen, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AssistantFormDialog } from "@/components/ai/chat/AssistantFormDialog";
import { AssistantSidebar } from "@/components/ai/chat/AssistantSidebar";
import { Composer } from "@/components/ai/chat/Composer";
import { MessageList } from "@/components/ai/chat/MessageList";
import {
  defaultModelOption,
  ModelSelect,
  useModelOptions
} from "@/components/ai/chat/ModelSelect";
import { useLlmProviders } from "@/hooks/useLlmConfig";
import { isClearContextKey } from "@/lib/keyboardShortcut";
import {
  useChatAssistants,
  useChatConversation,
  useChatSessions,
  useCreateChatSession,
  useDeleteChatAssistant,
  useDeleteChatSession,
  useUpdateChatSession
} from "@/hooks/useChat";
import { cn } from "@/lib/utils";
import type { ChatAssistant, ChatMessage, ChatSession } from "@/types/domain";

/**
 * The Chat tab: assistants and conversations on the left, the selected
 * conversation on the right.
 *
 * Every answer is grounded in the same in-process MCP tools external agents
 * reach over HTTP, so what the model can see here is exactly what the Audit tab
 * would show for an outside client.
 */
export function ChatPanel({
  onConfigureModels
}: {
  /** Jump to LLM Setting, optionally with a specific provider preselected. */
  onConfigureModels: (providerId?: string) => void;
}) {
  const assistants = useChatAssistants();
  const sessions = useChatSessions();
  const createSession = useCreateChatSession();
  const updateSession = useUpdateChatSession();
  const deleteSession = useDeleteChatSession();
  const deleteAssistant = useDeleteChatAssistant();
  const modelOptions = useModelOptions();
  const llmProviders = useLlmProviders();
  const noModels = modelOptions.length === 0;

  // A message's modelId is the API-facing id (e.g. "claude-opus-4-8"), not the
  // provider's local row id. To send an errored reply to the right provider
  // settings, map each API model id back to the provider that offers it.
  const providerIdByModelId = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of llmProviders.data ?? []) {
      for (const model of provider.models) {
        map.set(model.modelId, provider.id);
      }
    }
    return map;
  }, [llmProviders.data]);

  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [assistantDialog, setAssistantDialog] = useState<{
    open: boolean;
    assistant: ChatAssistant | null;
  }>({ open: false, assistant: null });
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "session" | "assistant"; id: string; name: string } | null
  >(null);
  // A message queued for deletion, or null when the confirm dialog is closed.
  const [messageDeleteTarget, setMessageDeleteTarget] = useState<ChatMessage | null>(null);
  // The composer's draft, owned here so "Edit" on a past question can load its
  // text into the same box that sends new messages.
  const [composerText, setComposerText] = useState("");
  // The user message being edited through the composer (greyed out in the
  // transcript), or null when the composer is just composing.
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);

  const sessionList = sessions.data ?? [];
  const assistantList = assistants.data ?? [];

  const activeSession = useMemo(
    () => sessionList.find((session) => session.id === activeSessionId) ?? null,
    [sessionList, activeSessionId]
  );
  const activeAssistant = useMemo(
    () => assistantList.find((assistant) => assistant.id === activeSession?.assistantId),
    [assistantList, activeSession]
  );

  const conversation = useChatConversation(activeSession?.id ?? null);

  // Keep the selection on a session that still exists after a delete.
  useEffect(() => {
    if (activeSessionId && !sessionList.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(null);
    }
  }, [sessionList, activeSessionId]);

  // An in-progress edit belongs to one conversation; switching conversations
  // abandons it so the next conversation does not open mid-edit.
  const previousSessionRef = useRef(activeSession?.id ?? null);
  useEffect(() => {
    const sessionId = activeSession?.id ?? null;
    if (previousSessionRef.current !== sessionId) {
      previousSessionRef.current = sessionId;
      setEditingMessage(null);
      setComposerText("");
    }
  }, [activeSession]);

  const startSession = useCallback(
    (assistantId: string) => {
      createSession.mutate(
        { assistantId },
        {
          onSuccess: (sessionId) => setActiveSessionId(sessionId),
          onError: (error: Error) => toast.error(error.message || "Failed to start a conversation")
        }
      );
    },
    [createSession]
  );

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const mutation = deleteTarget.kind === "session" ? deleteSession : deleteAssistant;
    mutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success(`${deleteTarget.name} deleted`);
        setActiveSessionId(null);
        setDeleteTarget(null);
      },
      onError: (error: Error) => toast.error(error.message || "Failed to delete")
    });
  };

  const handleClearContext = async () => {
    const cleared = await conversation.clearContext();
    toast[cleared ? "success" : "info"](
      cleared ? "Context cleared. Earlier messages stay visible." : "Nothing to clear yet."
    );
  };

  // Cmd+K clears the context from anywhere on the chat page. The listener is
  // bound once and reads the latest handler and streaming/session state through
  // refs, so re-rendering never churns the DOM listener. Clearing mid-reply or
  // with nothing to work on would be confusing, so the shortcut stays quiet in
  // those cases — the same cases that disable the toolbar button.
  const handleClearContextRef = useRef(handleClearContext);
  handleClearContextRef.current = handleClearContext;
  const isStreamingRef = useRef(conversation.streaming !== null || conversation.sending);
  isStreamingRef.current = conversation.streaming !== null || conversation.sending;
  const noModelsRef = useRef(noModels);
  noModelsRef.current = noModels;
  const activeSessionRef = useRef(activeSession);
  activeSessionRef.current = activeSession;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isClearContextKey(event)) return;
      if (isStreamingRef.current || noModelsRef.current || !activeSessionRef.current) return;
      event.preventDefault();
      void handleClearContextRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleRename = () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (!title) {
      toast.error("Enter a title.");
      return;
    }
    updateSession.mutate(
      { id: renaming.id, title },
      {
        onSuccess: () => setRenaming(null),
        onError: (error: Error) => toast.error(error.message || "Failed to rename")
      }
    );
  };

  // Per-message actions, kept in handlers here so MessageList stays presentational.
  const handleCopy = (message: ChatMessage) => {
    const text = message.content;
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Failed to copy to clipboard")
    );
  };

  /** Edit clicked on a past question: pull its text into the composer and grey it out. */
  const handleEditRequest = (message: ChatMessage) => {
    setEditingMessage(message);
    setComposerText(message.content ?? "");
  };

  /** Esc or the composer's ✕: leave edit mode without touching the message. */
  const handleCancelEdit = () => {
    setEditingMessage(null);
    setComposerText("");
  };

  /**
   * The composer's send. While a past question is being edited, the box re-answers
   * that question instead of sending a new one — mirroring the old inline editor.
   * An unchanged or empty edit just closes the editor, no re-answer.
   */
  const handleComposerSend = async (text: string) => {
    if (editingMessage) {
      const original = editingMessage.content?.trim() ?? "";
      const target = text.trim();
      const message = editingMessage;
      setEditingMessage(null);
      setComposerText("");
      if (!target || target === original) return;
      try {
        await conversation.edit(message.id, target);
        toast.success("Question updated and answered again");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update the message");
      }
      return;
    }
    try {
      await conversation.send(text);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send the message");
    }
  };

  /** Jump to LLM Setting with the provider of an errored reply preselected. */
  const handleConfigureProvider = (providerId: string) => {
    onConfigureModels(providerId);
  };

  const handleRegenerate = async (message: ChatMessage) => {
    try {
      await conversation.regenerate(message.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to regenerate the answer");
    }
  };

  const handleRegenerateWithModel = async (message: ChatMessage, modelId: string) => {
    try {
      await conversation.regenerate(message.id, modelId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to regenerate the answer");
    }
  };

  const handleMessageDelete = async () => {
    if (!messageDeleteTarget) return;
    try {
      await conversation.deleteMessage(messageDeleteTarget.id);
      toast.success("Message deleted");
      setMessageDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete the message");
    }
  };

  if (assistants.isLoading || sessions.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading conversations...
      </p>
    );
  }

  const effectiveModelId =
    activeSession?.modelId ??
    activeAssistant?.defaultModelId ??
    defaultModelOption(modelOptions)?.id ??
    null;

  return (
    <div
      className={cn(
        // overflow-hidden so a long transcript cannot stretch the grid and push
        // its scrollbar onto the page.
        "grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden",
        sidebarVisible ? "lg:grid-cols-[minmax(180px,20%)_minmax(0,1fr)]" : "grid-cols-1"
      )}
    >
      {sidebarVisible && (
        <AssistantSidebar
          assistants={assistantList}
          sessions={sessionList}
          activeSessionId={activeSession?.id ?? null}
          onSelectSession={setActiveSessionId}
          onAddAssistant={() => setAssistantDialog({ open: true, assistant: null })}
          onEditAssistant={(assistant) => setAssistantDialog({ open: true, assistant })}
          onDeleteAssistant={(assistant) =>
            setDeleteTarget({ kind: "assistant", id: assistant.id, name: assistant.name })
          }
          onNewSession={startSession}
          onDeleteSession={(session: ChatSession) =>
            setDeleteTarget({ kind: "session", id: session.id, name: session.title })
          }
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border">
        <div className="flex shrink-0 items-center gap-2 border-b p-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label={sidebarVisible ? "Hide the sidebar" : "Show the sidebar"}
                onClick={() => setSidebarVisible((visible) => !visible)}
              >
                {sidebarVisible ? (
                  <PanelLeftClose className="size-4" />
                ) : (
                  <PanelLeftOpen className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sidebarVisible ? "Hide sidebar" : "Show sidebar"}</TooltipContent>
          </Tooltip>

          {activeSession ? (
            <>
              <button
                type="button"
                onDoubleClick={() =>
                  setRenaming({ id: activeSession.id, title: activeSession.title })
                }
                className="min-w-0 flex-1 truncate rounded px-1 text-left text-sm font-medium hover:bg-muted/60"
                title="Double-click to rename"
              >
                {activeSession.title}
              </button>
              <ModelSelect
                options={modelOptions}
                value={effectiveModelId}
                onChange={(modelId) =>
                  updateSession.mutate(
                    { id: activeSession.id, modelId },
                    {
                      onError: (error: Error) =>
                        toast.error(error.message || "Failed to change the model")
                    }
                  )
                }
                className="h-8 w-56 shrink-0 text-xs"
              />
            </>
          ) : (
            <span className="flex-1 text-sm text-muted-foreground">No conversation selected</span>
          )}
        </div>

        {/* The transcript owns its own scrolling — see MessageList. */}
        <MessageList
          sessionId={activeSession?.id ?? null}
          messages={conversation.messages}
          assistant={activeAssistant}
          streaming={conversation.streaming}
          isLoading={conversation.isLoading}
          modelOptions={modelOptions}
          editingMessageId={editingMessage?.id ?? null}
          // A message's modelId is API-facing; resolve it back to the provider
          // that offers it so an errored reply can link to the right settings.
          resolveProviderId={(message) =>
            message.modelId ? providerIdByModelId.get(message.modelId) ?? null : null
          }
          onCopy={handleCopy}
          onEdit={handleEditRequest}
          onConfigureProvider={(providerId) => void handleConfigureProvider(providerId)}
          onDelete={setMessageDeleteTarget}
          onRegenerate={handleRegenerate}
          onRegenerateWithModel={handleRegenerateWithModel}
          emptyHint={
            noModels ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <p>
                    No model is configured yet. Chat sends your messages and tool results —
                    including log excerpts — to the provider you configure. Until now this app
                    sent nothing anywhere except AWS.
                  </p>
                </div>
                <Button type="button" size="sm" onClick={() => onConfigureModels()}>
                  Configure a provider
                </Button>
              </div>
            ) : (
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>Paste a job id and ask why it failed.</p>
                <p className="text-xs">
                  The assistant locates the job across your accounts, then reads its controller
                  and Spark logs. Every tool call is shown, and all of them are read-only.
                </p>
              </div>
            )
          }
        />

        <Composer
          disabled={!activeSession || noModels}
          streaming={conversation.sending || conversation.streaming !== null}
          value={composerText}
          onValueChange={setComposerText}
          editing={editingMessage !== null}
          onSend={(text) => void handleComposerSend(text)}
          onCancel={() => void conversation.cancel()}
          onClearContext={() => void handleClearContext()}
          onCancelEdit={handleCancelEdit}
        />
      </div>

      <AssistantFormDialog
        assistant={assistantDialog.assistant}
        open={assistantDialog.open}
        onOpenChange={(open) => setAssistantDialog((current) => ({ ...current, open }))}
      />

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={renaming?.title ?? ""}
            onChange={(event) =>
              setRenaming((current) => (current ? { ...current, title: event.target.value } : null))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleRename();
              }
            }}
            aria-label="Conversation title"
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleRename} disabled={updateSession.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete {deleteTarget?.kind === "session" ? "conversation" : "assistant"}?
            </DialogTitle>
            <DialogDescription>
              This permanently removes{" "}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>
              {deleteTarget?.kind === "assistant"
                ? " and every conversation belonging to it, including any log excerpts stored with them."
                : " and its messages, including any log excerpts stored with them."}{" "}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteSession.isPending || deleteAssistant.isPending}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={messageDeleteTarget !== null}
        onOpenChange={(open) => !open && setMessageDeleteTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this message?</DialogTitle>
            <DialogDescription>
              The message and any answer it produced are removed. Tool results that read job logs
              are stored locally, so this also clears whatever they brought back. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMessageDeleteTarget(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleMessageDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
