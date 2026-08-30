import { useEffect, useState } from "react";
import { CircleCheck, CircleX, KeyRound, LoaderCircle, Plug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTestLlmEndpoint, useUpdateLlmEndpoint } from "@/hooks/useLlmConfig";
import { cn } from "@/lib/utils";
import type { LlmEndpoint, LlmEndpointTestResult } from "@/types/domain";

/**
 * Level two: one endpoint's base URL and API key.
 *
 * The key is write-only by design. The backend returns a masked value and never
 * the key itself, so the field starts empty with the mask as its placeholder:
 * leaving it untouched keeps the stored key, and typing replaces it. There is no
 * way to render the current key because the WebView never receives it.
 */
export function EndpointForm({ endpoint }: { endpoint: LlmEndpoint }) {
  const updateEndpoint = useUpdateLlmEndpoint();
  const testEndpoint = useTestLlmEndpoint();
  const [name, setName] = useState(endpoint.name);
  const [baseUrl, setBaseUrl] = useState(endpoint.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<LlmEndpointTestResult | null>(null);

  // Switching endpoints must not carry the previous one's edits — or, worse, a
  // typed API key — into the newly selected row.
  useEffect(() => {
    setName(endpoint.name);
    setBaseUrl(endpoint.baseUrl);
    setApiKey("");
    setTestResult(null);
  }, [endpoint.id, endpoint.name, endpoint.baseUrl]);

  const dirty = name !== endpoint.name || baseUrl !== endpoint.baseUrl || apiKey.length > 0;

  const save = () => {
    updateEndpoint.mutate(
      {
        id: endpoint.id,
        name: name.trim() === endpoint.name ? undefined : name.trim(),
        baseUrl: baseUrl.trim() === endpoint.baseUrl ? undefined : baseUrl.trim(),
        // Omitted rather than empty: an empty string would clear the stored key.
        apiKey: apiKey.length > 0 ? apiKey : undefined
      },
      {
        onSuccess: () => {
          toast.success("Endpoint saved");
          setApiKey("");
          setTestResult(null);
        },
        onError: (error: Error) => toast.error(error.message || "Failed to save the endpoint")
      }
    );
  };

  const test = () => {
    if (dirty) {
      toast.error("Save your changes before testing the connection.");
      return;
    }
    setTestResult(null);
    testEndpoint.mutate(endpoint.id, {
      onSuccess: (result) => setTestResult(result),
      onError: (error: Error) =>
        setTestResult({ ok: false, message: error.message || "Test failed", latencyMs: 0 })
    });
  };

  return (
    <form
      className="space-y-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-2">
          <Label htmlFor={`endpoint-name-${endpoint.id}`}>Endpoint name</Label>
          <Input
            id={`endpoint-name-${endpoint.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="default"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`endpoint-url-${endpoint.id}`}>API base URL</Label>
          <Input
            id={`endpoint-url-${endpoint.id}`}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com/v1"
            className="font-mono text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`endpoint-key-${endpoint.id}`} className="flex items-center gap-2">
          <KeyRound className="size-3.5" />
          API key
        </Label>
        <Input
          id={`endpoint-key-${endpoint.id}`}
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={endpoint.apiKeyMasked ?? "Not set"}
          className="font-mono text-sm"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          {endpoint.hasApiKey
            ? "A key is stored. Type a new one to replace it — the stored key cannot be shown."
            : "Stored in your OS keychain, never in the app database and never sent to the UI."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!dirty || updateEndpoint.isPending}>
          {updateEndpoint.isPending ? "Saving..." : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={test}
          disabled={testEndpoint.isPending || !endpoint.hasApiKey}
        >
          {testEndpoint.isPending ? (
            <LoaderCircle className="mr-2 size-3.5 animate-spin" />
          ) : (
            <Plug className="mr-2 size-3.5" />
          )}
          Test connection
        </Button>

        {testResult && (
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs",
              testResult.ok ? "text-green-600 dark:text-green-500" : "text-destructive"
            )}
          >
            {testResult.ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
            {testResult.message}
            {testResult.ok && ` (${testResult.latencyMs} ms)`}
          </span>
        )}
        {!endpoint.hasApiKey && !testResult && (
          <span className="text-xs text-muted-foreground">Add an API key to test the connection.</span>
        )}
      </div>
    </form>
  );
}
