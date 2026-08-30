import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { ChatAssistant, ChatSession } from "@/types/domain";

/**
 * The Chat tab: assistants and conversations on the left, the selected
 * conversation on the right.
 *
 * Every answer is grounded in the same in-process MCP tools external agents
 * reach over HTTP, so what the model can see here is exactly what the Audit tab
 * would show for an outside client.
 */
export function ChatPanel({ onConfigureModels }: { onConfigureModels: () => void }) {
  const assistants = useChatAssistants();
  const sessions = useChatSessions();
  const createSession = useCreateChatSession();
  const updateSession = useUpdateChatSession();
  const deleteSession = useDeleteChatSession();
  const deleteAssistant = useDeleteChatAssistant();
  const modelOptions = useModelOptions();

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

  if (assistants.isLoading || sessions.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading conversations...
      </p>
    );
  }

  const noModels = modelOptions.length === 0;
  const effectiveModelId =
    activeSession?.modelId ??
    activeAssistant?.defaultModelId ??
    defaultModelOption(modelOptions)?.id ??
    null;

  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 gap-3",
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

      <div className="flex min-h-0 min-w-0 flex-col rounded-lg border">
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          <MessageList
              messages={conversation.messages}
            assistant={activeAssistant}
            streaming={conversation.streaming}
            isLoading={conversation.isLoading}
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
                  <Button type="button" size="sm" onClick={onConfigureModels}>
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
        </div>

        <Composer
          disabled={!activeSession || noModels}
          streaming={conversation.sending || conversation.streaming !== null}
          onSend={(text) => {
            void conversation.send(text).catch((error: Error) => {
              toast.error(error.message || "Failed to send the message");
            });
          }}
          onCancel={() => void conversation.cancel()}
          onClearContext={() => void handleClearContext()}
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
    </div>
  );
}
