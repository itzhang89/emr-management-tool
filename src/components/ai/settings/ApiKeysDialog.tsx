import { useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleX, Eye, EyeOff, KeyRound, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAddLlmApiKey, useDeleteLlmApiKey, useProbeLlmApiKeys } from "@/hooks/useLlmConfig";
import { cn } from "@/lib/utils";
import type { LlmApiKey, LlmProvider } from "@/types/domain";

/**
 * Manages a provider's API keys.
 *
 * Several keys can be stored, but they are not rotated per request: the first
 * one not known to be refused is used until it fails, at which point the next is
 * tried and the failed one is marked. "Detect" makes that same discovery ahead of
 * time, so the first real message does not have to fail over.
 */
export function ApiKeysDialog({
  provider,
  open,
  onOpenChange
}: {
  provider: LlmProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addKey = useAddLlmApiKey();
  const deleteKey = useDeleteLlmApiKey();
  const probeKeys = useProbeLlmApiKeys();
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (open) {
      setValue("");
      setLabel("");
      setRevealed(false);
    }
  }, [open]);

  const active = useMemo(
    () => provider.apiKeys.find((key) => key.status !== "unhealthy"),
    [provider.apiKeys]
  );

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      toast.error("Paste an API key to add.");
      return;
    }
    addKey.mutate(
      { providerId: provider.id, value: trimmed, label: label.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("API key added");
          setValue("");
          setLabel("");
          setRevealed(false);
        },
        onError: (error: Error) => toast.error(error.message || "Failed to add the API key")
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>API keys for {provider.name}</DialogTitle>
          <DialogDescription>
            The first key that has not been refused is used. When one is rejected it is marked and the
            next is tried automatically.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3 rounded-lg border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-api-key" className="flex items-center gap-2">
              <KeyRound className="size-3.5" />
              Add a key
            </Label>
            <div className="flex gap-2">
              <Input
                id="new-api-key"
                // The eye only unmasks what is being typed now. A stored key is
                // never sent back to this UI, so there is nothing to reveal.
                type={revealed ? "text" : "password"}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="sk-..."
                className="font-mono text-sm"
                autoComplete="off"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-9 shrink-0"
                    aria-label={revealed ? "Hide the key you are typing" : "Show the key you are typing"}
                    onClick={() => setRevealed((shown) => !shown)}
                  >
                    {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {revealed ? "Hide what you are typing" : "Check what you just pasted"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-api-key-label">Label (optional)</Label>
            <Input
              id="new-api-key-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="personal"
              className="h-9"
            />
          </div>

          <Button type="submit" size="sm" disabled={addKey.isPending}>
            <Plus className="mr-1 size-3.5" />
            {addKey.isPending ? "Adding..." : "Add key"}
          </Button>
        </form>

        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            Stored keys
            {provider.apiKeys.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">{provider.apiKeys.length}</span>
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={provider.apiKeys.length === 0 || probeKeys.isPending || !provider.baseUrl}
            onClick={() =>
              probeKeys.mutate(provider.id, {
                onSuccess: (keys) => {
                  const healthy = keys.filter((key) => key.status === "healthy").length;
                  toast.success(`${healthy} of ${keys.length} keys answered`);
                },
                onError: (error: Error) => toast.error(error.message || "Could not probe the keys")
              })
            }
          >
            {probeKeys.isPending ? (
              <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
            ) : null}
            Detect
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {provider.apiKeys.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
              No keys yet. This provider cannot be used until one is added.
            </p>
          ) : (
            <div className="divide-y rounded-md border">
              {provider.apiKeys.map((key) => (
                <ApiKeyRow
                  key={key.id}
                  apiKey={key}
                  isActive={key.id === active?.id}
                  onDelete={() =>
                    deleteKey.mutate(key.id, {
                      onError: (error: Error) =>
                        toast.error(error.message || "Failed to remove the key")
                    })
                  }
                  deleting={deleteKey.isPending}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeyRow({
  apiKey,
  isActive,
  onDelete,
  deleting
}: {
  apiKey: LlmApiKey;
  isActive: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <StatusIcon status={apiKey.status} message={apiKey.statusMessage} />
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{apiKey.masked}</span>
      {apiKey.label && (
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{apiKey.label}</span>
      )}
      {/* Which key a request will actually use, so a user with several is not
          left guessing. */}
      {isActive && (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          In use
        </Badge>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove key ${apiKey.masked}`}
            disabled={deleting}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Remove this key</TooltipContent>
      </Tooltip>
    </div>
  );
}

function StatusIcon({ status, message }: { status: LlmApiKey["status"]; message?: string | null }) {
  if (status === "unknown") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label="Not checked"
            className="size-3.5 shrink-0 rounded-full border border-muted-foreground/40"
          />
        </TooltipTrigger>
        <TooltipContent>Not checked yet</TooltipContent>
      </Tooltip>
    );
  }

  const healthy = status === "healthy";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-label={healthy ? "Working" : "Refused"} className="shrink-0">
          {healthy ? (
            <CircleCheck className={cn("size-3.5", "text-green-600 dark:text-green-500")} />
          ) : (
            <CircleX className="size-3.5 text-destructive" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {healthy ? "This key answered" : message || "This key was refused"}
      </TooltipContent>
    </Tooltip>
  );
}
