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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCreateLlmProvider } from "@/hooks/useLlmConfig";
import type { LlmProviderKind } from "@/types/domain";

/**
 * Providers are entirely user-defined — the app hardcodes no gateway names.
 * The only structural choice is the API shape, since that decides how requests
 * are built and authenticated.
 */
const KINDS: Array<{ value: LlmProviderKind; label: string; hint: string }> = [
  {
    value: "openai",
    label: "OpenAI-compatible",
    hint: "/chat/completions with a Bearer token. Most gateways speak this."
  },
  {
    value: "anthropic",
    label: "Anthropic",
    hint: "/messages with an x-api-key header."
  }
];

export function ProviderFormDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (providerId: string) => void;
}) {
  const createProvider = useCreateLlmProvider();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LlmProviderKind>("openai");

  useEffect(() => {
    if (open) {
      setName("");
      setKind("openai");
    }
  }, [open]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a name for this provider.");
      return;
    }
    createProvider.mutate(
      { name: trimmed, kind },
      {
        onSuccess: (providerId) => {
          toast.success(`${trimmed} added`);
          onOpenChange(false);
          onCreated(providerId);
        },
        onError: (error: Error) => toast.error(error.message || "Failed to add the provider")
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add provider</DialogTitle>
          <DialogDescription>
            Name it whatever you call it. You will add its API endpoint and key next.
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

          <div className="space-y-2">
            <Label>API shape</Label>
            <RadioGroup
              value={kind}
              onValueChange={(value) => setKind(value as LlmProviderKind)}
              className="gap-2"
            >
              {KINDS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm hover:bg-muted/50"
                >
                  <RadioGroupItem value={option.value} className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{option.hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createProvider.isPending}>
              {createProvider.isPending ? "Adding..." : "Add provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
