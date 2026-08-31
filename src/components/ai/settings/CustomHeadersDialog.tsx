import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
import { useSetLlmProviderHeaders } from "@/hooks/useLlmConfig";
import type { LlmProvider } from "@/types/domain";

type Row = {
  name: string;
  value: string;
  /** True for a header already stored, whose value this UI has never seen. */
  stored: boolean;
};

/**
 * Custom request headers for a provider.
 *
 * Values are treated as secrets — a gateway asking for a token in `X-Api-Token`
 * is no different from one asking for an API key — so they go to the keychain and
 * are never read back. An existing header therefore shows its name with an empty
 * value field: leaving it alone keeps the stored value, and typing replaces it.
 */
export function CustomHeadersDialog({
  provider,
  open,
  onOpenChange
}: {
  provider: LlmProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setHeaders = useSetLlmProviderHeaders();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (open) {
      setRows(provider.headerNames.map((name) => ({ name, value: "", stored: true })));
    }
  }, [open, provider.headerNames]);

  const update = (index: number, patch: Partial<Row>) => {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  };

  const submit = () => {
    const named = rows.filter((row) => row.name.trim().length > 0);
    // A row that is new and blank was never filled in; sending it would only
    // produce an error about a missing value.
    const incomplete = named.find((row) => !row.stored && !row.value.trim());
    if (incomplete) {
      toast.error(`Enter a value for ${incomplete.name.trim()}.`);
      return;
    }

    setHeaders.mutate(
      {
        providerId: provider.id,
        headers: named.map((row) => ({
          name: row.name.trim(),
          // Omitted means "keep the stored value" — the only way to express that,
          // since this UI cannot round-trip a value it never received.
          value: row.value.trim() ? row.value : undefined
        }))
      },
      {
        onSuccess: (names) => {
          toast.success(names.length === 0 ? "Custom headers cleared" : "Custom headers saved");
          onOpenChange(false);
        },
        onError: (error: Error) => toast.error(error.message || "Failed to save the headers")
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Custom headers for {provider.name}</DialogTitle>
          <DialogDescription>
            Sent with every request to this provider. Values are stored in your OS keychain like API
            keys, and cannot be shown again.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {rows.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                No custom headers. Most providers need none — the protocol's own auth header is added
                automatically.
              </p>
            ) : (
              rows.map((row, index) => (
                <div key={index} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label htmlFor={`header-name-${index}`} className="text-xs">
                      Name
                    </Label>
                    <Input
                      id={`header-name-${index}`}
                      value={row.name}
                      onChange={(event) => update(index, { name: event.target.value })}
                      placeholder="X-Api-Token"
                      className="h-9 font-mono text-sm"
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label htmlFor={`header-value-${index}`} className="text-xs">
                      Value
                    </Label>
                    <Input
                      id={`header-value-${index}`}
                      type="password"
                      value={row.value}
                      onChange={(event) => update(index, { value: event.target.value })}
                      placeholder={row.stored ? "Stored — type to replace" : "value"}
                      className="h-9 font-mono text-sm"
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove header ${row.name || index + 1}`}
                    onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setRows((current) => [...current, { name: "", value: "", stored: false }])}
          >
            <Plus className="mr-1 size-3.5" />
            Add header
          </Button>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={setHeaders.isPending}>
              {setHeaders.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
