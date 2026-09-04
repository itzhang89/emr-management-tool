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
  findModelOption,
  ModelSelect,
  useModelOptions,
  type ModelOption
} from "@/components/ai/chat/ModelSelect";
import { useLlmProviders } from "@/hooks/useLlmConfig";
import { isClearContextKey } from "@/lib/keyboardShortcut";
import { jobAnalysisPrompt, jobSessionTitle, sameJobTitle } from "@/services/aiAnalyzeJob";
import { useSessionStore } from "@/stores/sessionStore";
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
 * The model this conversation runs on: its own stored choice, else the
 * assistant's default, else the app default.
 */
function resolveEffectiveModelId(
  activeSession: ChatSession | null,
  activeAssistant: ChatAssistant | null | undefined,
  options: ModelOption[]
): string | null {
  return (
    activeSession?.modelId ??
    activeAssistant?.defaultModelId ??
    defaultModelOption(options)?.id ??
    null
  );
}

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

  /**
   * Which provider a model reference belongs to, accepting either a model row id
   * (what a session/assistant stores) or an API-facing model id like
   * "claude-opus-4-8". Row ids and API ids live in different namespaces, so both
   * are keyed in the same map.
   */
  const providerIdByModelRef = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of llmProviders.data ?? []) {
      for (const model of provider.models) {
        map.set(model.id, provider.id);
        map.set(model.modelId, provider.id);
      }
    }
    return map;
  }, [llmProviders.data]);
  const providerForModelRef = (modelRef: string | null | undefined): string | null =>
    modelRef ? (providerIdByModelRef.get(modelRef) ?? null) : null;

  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

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

  // The last model any conversation ran on, so an auto-created analysis session
  // can start on the model the user was just using. The sessions list is ordered
  // most-recently-active first, so the first session that names a still-available
  // model is that model.
  const lastUsedModelId = useMemo(() => {
    for (const session of sessionList) {
      if (session.modelId && findModelOption(modelOptions, session.modelId)) {
        return session.modelId;
      }
    }
    return null;
  }, [sessionList, modelOptions]);

  // The provider half of the effective model, so the settings link can open the
  // right provider's row when no explicit provider was requested.
  const effectiveProviderId = useMemo(
    () => providerForModelRef(resolveEffectiveModelId(activeSession, activeAssistant, modelOptions)),
    [activeSession, activeAssistant, modelOptions, providerForModelRef]
  );

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

  const conversation = useChatConversation(activeSession?.id ?? null);

  // Job History → AI: an "Analyze" click on a FAILED job stores the job here and
  // opens the Chat tab. On mount this consumes that intent — reuses the
  // conversation for that job's name (clearing its context first so the model
  // does not carry the previous run's history), or starts a new one named after
  // the job — then auto-sends the question.
  const pendingAiAnalyze = useSessionStore((state) => state.pendingAiAnalyze);
  const setPendingAiAnalyze = useSessionStore((state) => state.setPendingAiAnalyze);
  const [queuedAnalyze, setQueuedAnalyze] = useState<{
    sessionId: string;
    text: string;
    clearContext: boolean;
  } | null>(null);
  const [pendingNewSession, setPendingNewSession] = useState<{
    sessionId: string;
    text: string;
  } | null>(null);
  // The send must run against the conversation bound to whatever session becomes
  // active, so the latest bound functions are read through a ref rather than a
  // stale effect closure.
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  useEffect(() => {
    if (!pendingAiAnalyze) return;
    // Wait for the real lists so the find-or-reuse decision is made against
    // loaded data, not an empty first render.
    if (assistants.isLoading || sessions.isLoading || llmProviders.isLoading) return;

    // Consume the intent atomically. Reading through getState() and clearing
    // there means StrictMode's double-invoked effect — or a remount — sees the
    // value once, because the second pass reads the store as already cleared.
    const data = useSessionStore.getState().pendingAiAnalyze;
    if (!data) return;
    useSessionStore.getState().setPendingAiAnalyze(undefined);

    if (assistantList.length === 0) {
      toast.error("No assistant is available to analyze the job.");
      return;
    }
    if (noModels) {
      // Chat is already showing its "configure a provider" empty state — the
      // fix this needs — so drop the intent rather than firing into nothing.
      toast.error("No model is configured yet. Configure one in LLM Setting, then press Analyze again.");
      return;
    }

    const title = jobSessionTitle(data.jobName) || data.jobId;
    const text = jobAnalysisPrompt(data);

    const existing = sessionList.find((session) => sameJobTitle(session.title, title));
    if (existing) {
      setActiveSessionId(existing.id);
      setQueuedAnalyze({ sessionId: existing.id, text, clearContext: true });
      return;
    }

    const assistantId =
      (assistantList.find((assistant) => assistant.builtIn) ?? assistantList[0]).id;
    // The new conversation runs on the last model used in any conversation, when
    // one still exists and is still selectable; otherwise it falls back to the
    // default. (Handpicked options are a `ModelOption.id`, the same key a session
    // stores and the session's own model picker writes.)
    const modelId =
      findModelOption(modelOptions, lastUsedModelId)?.id ??
      defaultModelOption(modelOptions)?.id ??
      null;
    createSession
      .mutateAsync({ assistantId, title, modelId: modelId ?? undefined })
      .then((sessionId) => setPendingNewSession({ sessionId, text }))
      .catch((error: Error) => toast.error(error?.message || "Failed to start the AI analysis"));
  }, [
    pendingAiAnalyze,
    assistantList,
    sessionList,
    assistants.isLoading,
    sessions.isLoading,
    llmProviders.isLoading,
    noModels,
    createSession,
    lastUsedModelId,
    modelOptions
  ]);

  // A freshly created session only appears in the sessions query after it
  // refetches; select it then, when it is actually in the list, so the
  // keep-selection-on-delete effect below cannot clear the choice first.
  useEffect(() => {
    if (!pendingNewSession) return;
    if (!sessionList.some((session) => session.id === pendingNewSession.sessionId)) return;
    const { sessionId, text } = pendingNewSession;
    setPendingNewSession(null);
    setActiveSessionId(sessionId);
    setQueuedAnalyze({ sessionId, text, clearContext: false });
  }, [pendingNewSession, sessionList]);

  const streamingActive = conversation.streaming !== null;
  // Fires the queued analysis once the target session is actually selected and
  // idle (its messages loaded, no stream in flight).
  useEffect(() => {
    if (!queuedAnalyze) return;
    const queued = queuedAnalyze;
    if (activeSession?.id !== queued.sessionId) return;
    if (conversation.isLoading || conversation.sending || streamingActive) return;
    setQueuedAnalyze(null);
    void (async () => {
      const current = conversationRef.current;
      if (queued.clearContext) {
        await current.clearContext();
      }
      try {
        await current.send(queued.text);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to send the job for analysis");
      }
    })();
  }, [queuedAnalyze, activeSession?.id, conversation.isLoading, conversation.sending, streamingActive]);

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
   * Re-answering always runs, even when the wording is unchanged: in edit mode the
   * send action means "regenerate", and an unchanged-text no-op would read as the
   * button being dead.
   */
  const handleComposerSend = async (text: string) => {
    if (editingMessage) {
      const original = editingMessage.content?.trim() ?? "";
      const message = editingMessage;
      const target = text.trim();
      setEditingMessage(null);
      setComposerText("");
      try {
        await conversation.edit(message.id, target);
        // An unchanged text is still a regenerate; the fresh stream already shows
        // that, so only an actual wording change earns a success toast.
        if (target !== original) {
          toast.success("Question updated and answered again");
        }
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

  /** Jump to LLM Setting with the provider of the session's currently selected model. */
  const handleConfigureProvider = () => {
    onConfigureModels(effectiveProviderId ?? undefined);
  };

  const handleRegenerate = async (message: ChatMessage) => {
    try {
      await conversation.regenerate(message.id);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to regenerate the answer"));
    }
  };

  const handleRegenerateWithModel = async (message: ChatMessage, modelId: string) => {
    try {
      await conversation.regenerate(message.id, modelId);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to regenerate the answer"));
    }
  };

  /** Switch which recorded answer of a message is displayed. */
  const handleSwitchVersion = async (message: ChatMessage, versionId: string) => {
    try {
      await conversation.switchVersion(message.id, versionId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to switch the answer version");
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

  const effectiveModelId = resolveEffectiveModelId(activeSession, activeAssistant, modelOptions);

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
          onCopy={handleCopy}
          onEdit={handleEditRequest}
          onConfigureProvider={() => void handleConfigureProvider()}
          onDelete={setMessageDeleteTarget}
          onRegenerate={handleRegenerate}
          onRegenerateWithModel={handleRegenerateWithModel}
          onSwitchVersion={handleSwitchVersion}
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

/** Picks the message off an error of any shape (Tauri errors are plain objects). */
function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}
