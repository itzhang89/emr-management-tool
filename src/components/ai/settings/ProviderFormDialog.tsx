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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useCreateLlmProvider, useDuplicateLlmProvider } from "@/hooks/useLlmConfig";
import { LLM_PROTOCOLS } from "@/services/llmProtocols";
import type { LlmProtocol, LlmProvider } from "@/types/domain";

/**
 * Adds a provider, or duplicates one under a new name.
 *
 * Duplicating is the fast path for a second account on the same gateway: the copy
 * keeps the protocol, address, header names, and model list, and needs only its
 * own key. So when duplicating there is nothing to ask but the name.
 */
export function ProviderFormDialog({
  duplicateOf,
  open,
  onOpenChange,
  onCreated
}: {
  /** When set, the dialog duplicates this provider instead of creating a blank one. */
  duplicateOf?: LlmProvider | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (providerId: string) => void;
}) {
  const createProvider = useCreateLlmProvider();
  const duplicateProvider = useDuplicateLlmProvider();
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<LlmProtocol>("openai");
  const duplicating = duplicateOf != null;

  useEffect(() => {
    if (!open) return;
    // A copy suggests a name derived from its source, so the user only has to
    // amend it.
    setName(duplicateOf ? `${duplicateOf.name} copy` : "");
    setProtocol(duplicateOf?.protocol ?? "openai");
  }, [open, duplicateOf]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a name for this provider.");
      return;
    }

    const handlers = {
      onSuccess: (providerId: string) => {
        toast.success(`${trimmed} added`);
        onOpenChange(false);
        onCreated(providerId);
      },
      onError: (error: Error) => toast.error(error.message || "Failed to add the provider")
    };

    if (duplicateOf) {
      duplicateProvider.mutate({ id: duplicateOf.id, name: trimmed }, handlers);
      return;
    }
    createProvider.mutate({ name: trimmed, protocol }, handlers);
  };

  const pending = createProvider.isPending || duplicateProvider.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{duplicating ? "Duplicate provider" : "Add provider"}</DialogTitle>
          <DialogDescription>
            {duplicating
              ? "The copy keeps the protocol, address, custom header names, and models. It gets no API key — add its own."
              : "Name it whatever you call it, then fill in its address and key."}
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
            <Label htmlFor="provider-name">Name</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="agentrouter"
              autoFocus
            />
          </div>

          {!duplicating && (
            <div className="space-y-2">
              <Label htmlFor="provider-protocol">Protocol</Label>
              <Select value={protocol} onValueChange={(value) => setProtocol(value as LlmProtocol)}>
                <SelectTrigger id="provider-protocol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LLM_PROTOCOLS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {LLM_PROTOCOLS.find((option) => option.value === protocol)?.hint}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding..." : duplicating ? "Duplicate" : "Add provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
