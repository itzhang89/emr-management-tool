import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Plus, ShieldAlert, Trash2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AddModelDialog } from "@/components/ai/settings/AddModelDialog";
import { EndpointForm } from "@/components/ai/settings/EndpointForm";
import { EndpointFormDialog } from "@/components/ai/settings/EndpointFormDialog";
import { ModelTree } from "@/components/ai/settings/ModelTree";
import { ProviderFormDialog } from "@/components/ai/settings/ProviderFormDialog";
import { ProviderList } from "@/components/ai/settings/ProviderList";
import { SyncModelsDialog } from "@/components/ai/settings/SyncModelsDialog";
import { useDeleteAllChatSessions } from "@/hooks/useChat";
import {
  useDeleteLlmEndpoint,
  useDeleteLlmProvider,
  useLlmProviders,
  useSyncLlmModels,
  useUpdateLlmProvider
} from "@/hooks/useLlmConfig";
import { cn } from "@/lib/utils";
import type { LlmModelCandidate } from "@/types/domain";

/**
 * Provider → endpoint → model, as three nested levels: the provider list picks
 * what the right column configures, and inside that column an endpoint selector
 * picks whose key, URL, and models are shown.
 *
 * Models hang off the endpoint rather than the provider, so two endpoints of one
 * provider can offer different model sets and "Sync" always means "ask this
 * endpoint".
 */
export function LlmSettingsPanel() {
  const providers = useLlmProviders();
  const updateProvider = useUpdateLlmProvider();
  const deleteProvider = useDeleteLlmProvider();
  const deleteEndpoint = useDeleteLlmEndpoint();
  const syncModels = useSyncLlmModels();

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [endpointDialogOpen, setEndpointDialogOpen] = useState(false);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [candidates, setCandidates] = useState<LlmModelCandidate[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "provider" | "endpoint"; id: string; name: string } | null
  >(null);

  const providerList = providers.data ?? [];
  const selectedProvider = useMemo(
    () => providerList.find((provider) => provider.id === selectedProviderId) ?? providerList[0] ?? null,
    [providerList, selectedProviderId]
  );
  const selectedEndpoint = useMemo(() => {
    if (!selectedProvider) return null;
    return (
      selectedProvider.endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ??
      selectedProvider.endpoints.find((endpoint) => endpoint.isDefault) ??
      selectedProvider.endpoints[0] ??
      null
    );
  }, [selectedProvider, selectedEndpointId]);

  // Keep the selections pointing at rows that still exist after a delete.
  useEffect(() => {
    if (selectedProvider && selectedProvider.id !== selectedProviderId) {
      setSelectedProviderId(selectedProvider.id);
    }
  }, [selectedProvider, selectedProviderId]);
  useEffect(() => {
    if (selectedEndpoint && selectedEndpoint.id !== selectedEndpointId) {
      setSelectedEndpointId(selectedEndpoint.id);
    }
  }, [selectedEndpoint, selectedEndpointId]);

  const startSync = () => {
    if (!selectedEndpoint) return;
    setCandidates([]);
    setSyncOpen(true);
    syncModels.mutate(selectedEndpoint.id, {
      onSuccess: (result) => setCandidates(result),
      onError: (error: Error) => {
        setSyncOpen(false);
        toast.error(error.message || "Could not fetch the model list. Add models manually instead.");
      }
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const mutation = deleteTarget.kind === "provider" ? deleteProvider : deleteEndpoint;
    mutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success(`${deleteTarget.name} deleted`);
        if (deleteTarget.kind === "provider") {
          setSelectedProviderId(null);
        }
        setSelectedEndpointId(null);
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
    <div className="flex min-h-0 flex-col gap-4">
      {/* Until now this app sent nothing anywhere except AWS. Chat changes that,
          and the place where a provider gets configured is where it has to be
          said. */}
      <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <p>
          Chat sends your messages and tool results — including log excerpts — to the provider you configure
          here. API keys are stored in your OS keychain and never sent to this UI. No provider is configured by
          default.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(180px,20%)_minmax(0,1fr)]">
        <ProviderList
          providers={providerList}
          selectedId={selectedProvider?.id ?? null}
          onSelect={(id) => {
            setSelectedProviderId(id);
            setSelectedEndpointId(null);
          }}
          onAdd={() => setProviderDialogOpen(true)}
        />

        <div className="min-w-0 space-y-4 overflow-y-auto">
          {!selectedProvider ? (
            <p className="text-sm text-muted-foreground">
              Add a provider to configure an API endpoint and its models.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">{selectedProvider.name}</h3>
                <div className="flex items-center gap-3">
                  <Label htmlFor="provider-enabled" className="text-xs text-muted-foreground">
                    {selectedProvider.enabled ? "Enabled" : "Disabled"}
                  </Label>
                  <Switch
                    id="provider-enabled"
                    checked={selectedProvider.enabled}
                    disabled={updateProvider.isPending}
                    onCheckedChange={(enabled) =>
                      updateProvider.mutate(
                        { id: selectedProvider.id, enabled },
                        {
                          onError: (error: Error) =>
                            toast.error(error.message || "Failed to update the provider")
                        }
                      )
                    }
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${selectedProvider.name}`}
                        onClick={() =>
                          setDeleteTarget({
                            kind: "provider",
                            id: selectedProvider.id,
                            name: selectedProvider.name
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete this provider</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {selectedProvider.endpoints.map((endpoint) => (
                    <Button
                      key={endpoint.id}
                      type="button"
                      size="sm"
                      variant={endpoint.id === selectedEndpoint?.id ? "default" : "outline"}
                      onClick={() => setSelectedEndpointId(endpoint.id)}
                      className={cn(!endpoint.hasApiKey && "border-dashed")}
                    >
                      {endpoint.name}
                      {endpoint.isDefault && " ★"}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEndpointDialogOpen(true)}
                  >
                    <Plus className="mr-1 size-3.5" />
                    Add endpoint
                  </Button>
                </div>

                {selectedEndpoint ? (
                  <>
                    <EndpointForm endpoint={selectedEndpoint} />
                    {selectedProvider.endpoints.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setDeleteTarget({
                            kind: "endpoint",
                            id: selectedEndpoint.id,
                            name: selectedEndpoint.name
                          })
                        }
                      >
                        <Trash2 className="mr-1 size-3.5" />
                        Delete this endpoint
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                    No endpoints yet. Add one with this provider's base URL and API key.
                  </p>
                )}
              </div>

              {selectedEndpoint && (
                <ModelTree
                  models={selectedEndpoint.models}
                  onAddModel={() => setAddModelOpen(true)}
                  onSyncModels={startSync}
                  canSync={selectedEndpoint.hasApiKey}
                  syncing={syncModels.isPending}
                />
              )}
            </>
          )}
        </div>
      </div>

      <ProviderFormDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
        onCreated={(providerId) => {
          setSelectedProviderId(providerId);
          setSelectedEndpointId(null);
          // A provider with no endpoint cannot do anything, so go straight on to
          // adding one rather than leaving an empty shell selected.
          setEndpointDialogOpen(true);
        }}
      />

      {selectedProvider && (
        <EndpointFormDialog
          provider={selectedProvider}
          open={endpointDialogOpen}
          onOpenChange={setEndpointDialogOpen}
          onCreated={setSelectedEndpointId}
        />
      )}

      {selectedEndpoint && (
        <>
          <AddModelDialog
            endpointId={selectedEndpoint.id}
            open={addModelOpen}
            onOpenChange={setAddModelOpen}
          />
          <SyncModelsDialog
            endpointId={selectedEndpoint.id}
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
            <DialogTitle>
              Delete {deleteTarget?.kind === "provider" ? "provider" : "endpoint"}?
            </DialogTitle>
            <DialogDescription>
              This removes <span className="font-medium text-foreground">{deleteTarget?.name}</span>
              {deleteTarget?.kind === "provider" ? ", its endpoints," : ""} its models, and its stored API
              key from this app. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteProvider.isPending || deleteEndpoint.isPending}
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
