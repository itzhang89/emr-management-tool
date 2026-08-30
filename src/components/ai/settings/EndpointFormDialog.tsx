import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { useCreateLlmEndpoint } from "@/hooks/useLlmConfig";
import type { LlmProvider } from "@/types/domain";

/** Suggested base URL for a new endpoint, by API shape. Always editable. */
const DEFAULT_BASE_URL: Record<LlmProvider["kind"], string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1"
};

export function EndpointFormDialog({
  provider,
  open,
  onOpenChange,
  onCreated
}: {
  provider: LlmProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (endpointId: string) => void;
}) {
  const createEndpoint = useCreateLlmEndpoint();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (open) {
      // The first endpoint is the common case and is almost always "default";
      // later ones get a name the user picks.
      setName(provider.endpoints.length === 0 ? "default" : "");
      setBaseUrl(provider.endpoints[0]?.baseUrl ?? DEFAULT_BASE_URL[provider.kind]);
      setApiKey("");
    }
  }, [open, provider.endpoints, provider.kind]);

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedUrl = baseUrl.trim();
    if (!trimmedName) {
      toast.error("Enter a name for this endpoint.");
      return;
    }
    if (!/^https?:\/\//.test(trimmedUrl)) {
      toast.error("The API base URL must start with http:// or https://.");
      return;
    }

    createEndpoint.mutate(
      {
        providerId: provider.id,
        name: trimmedName,
        baseUrl: trimmedUrl,
        apiKey: apiKey.length > 0 ? apiKey : undefined
      },
      {
        onSuccess: (endpointId) => {
          toast.success(`${trimmedName} added`);
          onOpenChange(false);
          onCreated(endpointId);
        },
        onError: (error: Error) => toast.error(error.message || "Failed to add the endpoint")
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add endpoint to {provider.name}</DialogTitle>
          <DialogDescription>
            Each endpoint has its own base URL, API key, and model list.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-endpoint-name">Endpoint name</Label>
            <Input
              id="new-endpoint-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="default"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-endpoint-url">API base URL</Label>
            <Input
              id="new-endpoint-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={DEFAULT_BASE_URL[provider.kind]}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-endpoint-key">API key</Label>
            <Input
              id="new-endpoint-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-..."
              className="font-mono text-sm"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Stored in your OS keychain. You can add it later, but syncing models needs it.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createEndpoint.isPending}>
              {createEndpoint.isPending ? "Adding..." : "Add endpoint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
