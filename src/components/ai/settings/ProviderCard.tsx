import { useEffect, useState } from "react";
import { CircleCheck, CircleX, KeyRound, LoaderCircle, Plug, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiKeysDialog } from "@/components/ai/settings/ApiKeysDialog";
import { CommitInput } from "@/components/ai/settings/CommitInput";
import { CustomHeadersDialog } from "@/components/ai/settings/CustomHeadersDialog";
import { useTestLlmProvider, useUpdateLlmProvider } from "@/hooks/useLlmConfig";
import { LLM_PROTOCOLS, defaultBaseUrl } from "@/services/llmProtocols";
import { cn } from "@/lib/utils";
import type { LlmProtocol, LlmProvider, LlmProviderTestResult } from "@/types/domain";

/**
 * A provider's key, address, and protocol — everything about how to reach it.
 *
 * Two rows of equal geometry: the field takes the remaining width and its
 * trailing controls are fixed-size icon buttons, so the two inputs and the two
 * control clusters line up vertically.
 *
 * There is no Save button. Each field commits when it loses focus or Enter is
 * pressed, which is what the switches and dialogs beside them already do — a form
 * where half the controls save immediately and half wait for a button is the worse
 * of both.
 */
export function ProviderCard({ provider }: { provider: LlmProvider }) {
  const updateProvider = useUpdateLlmProvider();
  const testProvider = useTestLlmProvider();
  const [testResult, setTestResult] = useState<LlmProviderTestResult | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [headersOpen, setHeadersOpen] = useState(false);

  // Switching providers must not carry the previous one's test result over.
  useEffect(() => setTestResult(null), [provider.id]);

  const hasKey = provider.apiKeys.length > 0;
  const usableKeys = provider.apiKeys.filter((key) => key.status !== "unhealthy").length;
  const canReach = hasKey && provider.baseUrl.length > 0;

  const commit = (patch: Partial<Omit<LlmProvider, "id">>) =>
    updateProvider.mutateAsync({ id: provider.id, ...patch });

  const test = () => {
    setTestResult(null);
    testProvider.mutate(provider.id, {
      onSuccess: setTestResult,
      onError: (error: Error) =>
        setTestResult({ ok: false, message: error.message || "Test failed", latencyMs: 0 })
    });
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h4 className="truncate text-base font-semibold">{provider.name}</h4>
          {provider.builtIn && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              Preset
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`provider-enabled-${provider.id}`} className="text-xs text-muted-foreground">
            {provider.enabled ? "Enabled" : "Disabled"}
          </Label>
          <Switch
            id={`provider-enabled-${provider.id}`}
            checked={provider.enabled}
            disabled={updateProvider.isPending}
            onCheckedChange={(enabled) =>
              updateProvider.mutate(
                { id: provider.id, enabled },
                {
                  onError: (error: Error) =>
                    toast.error(error.message || "Failed to update the provider")
                }
              )
            }
          />
        </div>
      </div>

      {/* Row one: the key, then its two icon buttons. */}
      <div className="space-y-2">
        <Label htmlFor={`provider-key-${provider.id}`}>API key</Label>
        <div className="flex items-center gap-2">
          <input
            id={`provider-key-${provider.id}`}
            readOnly
            // Keys are managed in their own dialog because there can be several;
            // this is a summary that opens it, not an input.
            value={provider.apiKeys[0]?.masked ?? ""}
            placeholder="No key yet"
            onClick={() => setKeysOpen(true)}
            className="h-9 min-w-0 flex-1 cursor-pointer rounded-md border border-input bg-transparent px-3 py-1 font-mono text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="relative size-9 shrink-0"
                aria-label="Manage API keys"
                onClick={() => setKeysOpen(true)}
              >
                <KeyRound className="size-4" />
                {provider.apiKeys.length > 1 && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-secondary px-1 text-[10px] leading-4 text-secondary-foreground">
                    {usableKeys}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {provider.apiKeys.length > 1
                ? `Manage keys — ${usableKeys} of ${provider.apiKeys.length} usable`
                : "Manage API keys"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9 shrink-0"
                aria-label="Test connection"
                onClick={test}
                disabled={testProvider.isPending || !canReach}
              >
                {testProvider.isPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plug className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canReach ? "Test connection" : "Add an address and key first"}
            </TooltipContent>
          </Tooltip>
        </div>

        {testResult ? (
          <p
            className={cn(
              "flex items-center gap-1.5 text-xs",
              testResult.ok ? "text-green-600 dark:text-green-500" : "text-destructive"
            )}
          >
            {testResult.ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
            {testResult.message}
            {testResult.ok && ` (${testResult.latencyMs} ms)`}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {hasKey
              ? "Stored in your OS keychain. Keys can be shown while you type them, but never read back."
              : "Stored in your OS keychain, never in the app database and never sent to this UI."}
          </p>
        )}
      </div>

      {/* Row two: the address, then the protocol and header controls. */}
      <div className="space-y-2">
        <Label htmlFor={`provider-url-${provider.id}`}>API address</Label>
        <div className="flex items-center gap-2">
          <CommitInput
            id={`provider-url-${provider.id}`}
            value={provider.baseUrl}
            onCommit={(baseUrl) => commit({ baseUrl })}
            placeholder={defaultBaseUrl(provider.protocol)}
            className="min-w-0 flex-1 font-mono text-sm"
          />
          <Select
            value={provider.protocol}
            onValueChange={(value) => {
              const protocol = value as LlmProtocol;
              // A blank address gets the new protocol's default; a filled-in one is
              // the user's own and must not be overwritten.
              void commit(
                provider.baseUrl.trim()
                  ? { protocol }
                  : { protocol, baseUrl: defaultBaseUrl(protocol) }
              );
            }}
          >
            <SelectTrigger className="h-9 w-32 shrink-0" aria-label="Protocol">
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="relative size-9 shrink-0"
                aria-label="Custom request headers"
                onClick={() => setHeadersOpen(true)}
              >
                <Settings2 className="size-4" />
                {provider.headerNames.length > 0 && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-secondary px-1 text-[10px] leading-4 text-secondary-foreground">
                    {provider.headerNames.length}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {provider.headerNames.length === 0
                ? "Custom request headers"
                : provider.headerNames.join(", ")}
            </TooltipContent>
          </Tooltip>
        </div>
        {!provider.baseUrl && (
          <p className="text-xs text-muted-foreground">
            Add an API address before enabling this provider.
          </p>
        )}
        {provider.baseUrl && !hasKey && (
          <p className="text-xs text-muted-foreground">Add an API key to use this provider.</p>
        )}
      </div>

      <ApiKeysDialog provider={provider} open={keysOpen} onOpenChange={setKeysOpen} />
      <CustomHeadersDialog provider={provider} open={headersOpen} onOpenChange={setHeadersOpen} />
    </div>
  );
}
