import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, LoaderCircle, ShieldAlert, Trash2 } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CommitInput } from "@/components/ai/settings/CommitInput";
import { ModelFormDialog } from "@/components/ai/settings/ModelFormDialog";
import { ModelTree } from "@/components/ai/settings/ModelTree";
import { ProviderCard } from "@/components/ai/settings/ProviderCard";
import { ProviderFormDialog } from "@/components/ai/settings/ProviderFormDialog";
import { ProviderList } from "@/components/ai/settings/ProviderList";
import { SyncModelsDialog } from "@/components/ai/settings/SyncModelsDialog";
import { useDeleteAllChatSessions } from "@/hooks/useChat";
import {
  useDeleteLlmProvider,
  useLlmProviders,
  useSyncLlmModels,
  useUpdateLlmProvider
} from "@/hooks/useLlmConfig";
import type { LlmModel, LlmModelCandidate, LlmProvider } from "@/types/domain";

/**
 * Provider → model, two levels: the provider list picks what the right column
 * configures, and that column holds the one address, the keys that open it, and
 * the models it offers.
 *
 * There is no endpoint level. A second address is a second provider — the
 * duplicate action copies everything but the key, which is the only thing that
 * actually differs between two accounts on one gateway.
 *
 * OpenAI, Anthropic, and Gemini are seeded as disabled presets, so the common case
 * is pasting a key into a row that already knows the right address.
 */
export function LlmSettingsPanel({
  preselectProviderId,
  onPreselectHandled
}: {
  /** A provider the Chat tab wants selected (the one behind an errored reply). */
  preselectProviderId?: string | null;
  /** Called once the preselection is applied, so the parent can clear it. */
  onPreselectHandled?: () => void;
}) {
  const providers = useLlmProviders();
  const updateProvider = useUpdateLlmProvider();
  const deleteProvider = useDeleteLlmProvider();
  const syncModels = useSyncLlmModels();

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerDialog, setProviderDialog] = useState<{ duplicateOf: LlmProvider | null } | null>(
    null
  );
  const [modelDialog, setModelDialog] = useState<{ model: LlmModel | null } | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [candidates, setCandidates] = useState<LlmModelCandidate[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<LlmProvider | null>(null);

  const providerList = providers.data ?? [];
  const selected = useMemo(
    () => providerList.find((provider) => provider.id === selectedProviderId) ?? providerList[0] ?? null,
    [providerList, selectedProviderId]
  );

  // Keep the selection pointing at a row that still exists after a delete.
  useEffect(() => {
    if (selected && selected.id !== selectedProviderId) {
      setSelectedProviderId(selected.id);
    }
  }, [selected, selectedProviderId]);

  // The Chat tab can ask to arrive with a specific provider selected (the one
  // behind an errored reply). Apply each distinct request once — cleared via
  // onPreselectHandled so the same provider can be requested again later.
  const appliedPreselectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!preselectProviderId) {
      appliedPreselectRef.current = null;
      return;
    }
    if (appliedPreselectRef.current === preselectProviderId) return;
    if (!providerList.some((provider) => provider.id === preselectProviderId)) return;
    appliedPreselectRef.current = preselectProviderId;
    setSelectedProviderId(preselectProviderId);
    onPreselectHandled?.();
  }, [preselectProviderId, providerList, onPreselectHandled]);

  const startSync = () => {
    if (!selected) return;
    setCandidates([]);
    setSyncOpen(true);
    syncModels.mutate(selected.id, {
      onSuccess: setCandidates,
      onError: (error: Error) => {
        setSyncOpen(false);
        toast.error(error.message || "Could not fetch the model list. Add models manually instead.");
      }
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteProvider.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success(`${deleteTarget.name} deleted`);
        setSelectedProviderId(null);
        setDeleteTarget(null);
      },
      onError: (error: Error) => toast.error(error.message || "Failed to delete")
    });
  };

  if (providers.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading providers...
      </p>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
      {/* Until now this app sent nothing anywhere except AWS. Chat changes that,
          and the place where a provider gets configured is where it has to be
          said. */}
      <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <p>
          Chat sends your messages and tool results — including log excerpts — to the provider you enable
          here. API keys and custom header values are stored in your OS keychain and never sent back to this
          UI. No provider is enabled by default.
        </p>
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 gap-6 overflow-hidden lg:grid-cols-[minmax(180px,20%)_minmax(0,1fr)]">
        <ProviderList
          providers={providerList}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedProviderId}
          onAdd={() => setProviderDialog({ duplicateOf: null })}
        />

        <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto">
          {!selected ? (
            <p className="text-sm text-muted-foreground">
              Add a provider to configure its API address and models.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <CommitInput
                  value={selected.name}
                  onCommit={(name) => updateProvider.mutateAsync({ id: selected.id, name })}
                  aria-label="Provider name"
                  className="h-9 min-w-0 flex-1 text-base font-semibold"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0"
                      aria-label={`Duplicate ${selected.name}`}
                      onClick={() => setProviderDialog({ duplicateOf: selected })}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Duplicate for another account or gateway</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${selected.name}`}
                      onClick={() => setDeleteTarget(selected)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete this provider</TooltipContent>
                </Tooltip>
              </div>

              <ProviderCard provider={selected} />

              <ModelTree
                models={selected.models}
                onAddModel={() => setModelDialog({ model: null })}
                onEditModel={(model) => setModelDialog({ model })}
                onSyncModels={startSync}
                canSync={selected.apiKeys.length > 0 && selected.baseUrl.length > 0}
                syncing={syncModels.isPending}
              />
            </>
          )}
        </div>
      </div>

      <ProviderFormDialog
        duplicateOf={providerDialog?.duplicateOf ?? null}
        open={providerDialog !== null}
        onOpenChange={(open) => !open && setProviderDialog(null)}
        onCreated={setSelectedProviderId}
      />

      {selected && (
        <>
          <ModelFormDialog
            providerId={selected.id}
            model={modelDialog?.model ?? null}
            open={modelDialog !== null}
            onOpenChange={(open) => !open && setModelDialog(null)}
          />
          <SyncModelsDialog
            providerId={selected.id}
            candidates={candidates}
            loading={syncModels.isPending}
            open={syncOpen}
            onOpenChange={setSyncOpen}
          />
        </>
      )}

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete provider?</DialogTitle>
            <DialogDescription>
              This removes <span className="font-medium text-foreground">{deleteTarget?.name}</span>, its
              models, and its stored API keys from this app. This cannot be undone.
              {deleteTarget?.builtIn && " A deleted preset is not restored on the next start."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteProvider.isPending}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StoredConversations />
    </div>
  );
}

/**
 * Conversation history lives in the local SQLite database, and tool output means
 * that includes log excerpts. This is the one action that clears all of it, kept
 * next to the provider config because that is where a user thinking about what
 * this feature stores and sends will look.
 */
function StoredConversations() {
  const deleteAll = useDeleteAllChatSessions();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="shrink-0 space-y-2 border-t pt-4">
      <p className="text-sm font-medium">Stored conversations</p>
      <p className="text-xs text-muted-foreground">
        Chat history is saved locally, including any log excerpts tools returned. Assistants are presets
        and are kept.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 className="mr-1.5 size-3.5" />
        Clear all conversations
      </Button>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Clear all conversations?</DialogTitle>
            <DialogDescription>
              This permanently removes every chat session and message from this app, including stored log
              excerpts. Your assistants and provider settings are kept. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteAll.isPending}
              onClick={() =>
                deleteAll.mutate(undefined, {
                  onSuccess: (removed) => {
                    toast.success(
                      removed === 1 ? "1 conversation cleared" : `${removed} conversations cleared`
                    );
                    setConfirming(false);
                  },
                  onError: (error: Error) =>
                    toast.error(error.message || "Failed to clear conversations")
                })
              }
            >
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
