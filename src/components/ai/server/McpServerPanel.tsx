import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CircleAlert, Copy, FileCode2, LoaderCircle, Play, Shield } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriClient } from "@/services/tauriClient";
import type { McpStatus } from "@/types/domain";

const DEFAULT_MCP_PORT = 5175;

// --- Per-agent MCP config generation -------------------------------------

type AgentTool = {
  id: string;
  label: string;
  file: string;
  note: string;
  lang: "bash" | "json" | "toml";
  build: (endpointUrl: string) => string;
};

const SERVER_KEY = "emr-eks";

function claudeCodeConfig(endpointUrl: string): string {
  return `claude mcp add --transport http ${SERVER_KEY} ${endpointUrl}`;
}

function mcpJsonConfig(endpointUrl: string): string {
  return JSON.stringify({ mcpServers: { [SERVER_KEY]: { type: "http", url: endpointUrl } } }, null, 2);
}

function cursorConfig(endpointUrl: string): string {
  return JSON.stringify({ mcpServers: { [SERVER_KEY]: { url: endpointUrl } } }, null, 2);
}

function codexConfig(endpointUrl: string): string {
  return [`[mcp_servers.${SERVER_KEY}]`, `url = "${endpointUrl}"`].join("\n");
}

const AGENTS: AgentTool[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    file: "Terminal command (writes to ~/.claude.json)",
    note: "Registers the server with the Claude Code CLI. Run once, then restart any open sessions.",
    lang: "bash",
    build: claudeCodeConfig
  },
  {
    id: "cursor",
    label: "Cursor",
    file: "~/.cursor/mcp.json (or .cursor/mcp.json per-project)",
    note: "Add under mcpServers, then reload Cursor.",
    lang: "json",
    build: cursorConfig
  },
  {
    id: "codex",
    label: "Codex",
    file: "~/.codex/config.toml",
    note: "Codex uses TOML. Add this table, then restart Codex.",
    lang: "toml",
    build: codexConfig
  },
  {
    id: "pi",
    label: "pi",
    file: "~/.config/pi/mcp.json",
    note: "pi reads standard MCP JSON. Add under mcpServers.",
    lang: "json",
    build: mcpJsonConfig
  },
  {
    id: "opencode",
    label: "OpenCode",
    file: "~/.config/opencode/mcp.json",
    note: "Standard MCP JSON format. Add under mcpServers.",
    lang: "json",
    build: mcpJsonConfig
  }
];

/**
 * The Streamable HTTP endpoint external agents connect to. The Chat tab does
 * not need this — it talks to the same tools in-process — so this panel is only
 * about letting other tools in.
 */
export function McpServerPanel() {
  const queryClient = useQueryClient();
  const [port, setPort] = useState(DEFAULT_MCP_PORT);
  const [activeAgent, setActiveAgent] = useState(AGENTS[0].id);

  const { data: status, isLoading } = useQuery({
    queryKey: ["mcp-status"],
    queryFn: () => tauriClient.mcpStatus(),
    refetchInterval: (query) => {
      const current = query.state.data;
      if (!current) return 1000;
      if (current.running) return 2000;
      return false;
    }
  });

  const isRunning = status?.running ?? false;
  const mcpPort = status?.mcpPort ?? port;
  const endpointUrl =
    (isRunning ? status?.endpointUrl : undefined) ?? `http://127.0.0.1:${mcpPort}/mcp`;

  const startMcp = useMutation({
    mutationFn: () => tauriClient.mcpStart({ port }),
    onSuccess: (result: McpStatus) => {
      queryClient.setQueryData(["mcp-status"], result);
      toast.success(`MCP server started on port ${result.mcpPort}`);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to start MCP server");
    }
  });

  const stopMcp = useMutation({
    mutationFn: () => tauriClient.mcpStop(),
    onSuccess: () => {
      queryClient.setQueryData(["mcp-status"], { running: false } as McpStatus);
      toast.success("MCP server stopped");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to stop MCP server");
    }
  });

  const busy = startMcp.isPending || stopMcp.isPending;

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        startMcp.mutate();
      } else {
        stopMcp.mutate();
      }
    },
    [startMcp, stopMcp]
  );

  useEffect(() => {
    if (isRunning && status?.mcpPort && status.mcpPort !== port) {
      setPort(status.mcpPort);
    }
  }, [isRunning, status?.mcpPort, port]);

  const agent = AGENTS.find((a) => a.id === activeAgent) ?? AGENTS[0];
  const agentConfig = useMemo(() => agent.build(endpointUrl), [agent, endpointUrl]);

  const copyConfig = useCallback(() => {
    navigator.clipboard.writeText(agentConfig).then(
      () => toast.success(`${agent.label} config copied`),
      () => toast.error("Failed to copy to clipboard")
    );
  }, [agentConfig, agent.label]);

  const copyEndpoint = useCallback(() => {
    navigator.clipboard.writeText(endpointUrl).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Failed to copy")
    );
  }, [endpointUrl]);

  return (
    <div className="max-w-4xl space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-5" />
              MCP Server
            </CardTitle>
            <CardDescription>
              Start the built-in MCP server to allow AI assistants to query EMR jobs and logs through your app.
              It serves a single Streamable HTTP endpoint on <code>127.0.0.1</code>.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Label htmlFor="mcp-toggle" className="text-sm">
              {isRunning ? "Running" : "Stopped"}
            </Label>
            <Switch
              id="mcp-toggle"
              checked={isRunning}
              onCheckedChange={handleToggle}
              disabled={busy || isLoading}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="mcp-port">MCP Port</Label>
            <div className="flex max-w-xs gap-2">
              <Input
                id="mcp-port"
                type="number"
                min={1024}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value) || DEFAULT_MCP_PORT)}
                disabled={isRunning}
                placeholder="5175"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={!isRunning || busy}
                    onClick={() =>
                      stopMcp.mutate(undefined, {
                        onSuccess: () => startMcp.mutate()
                      })
                    }
                  >
                    <Play className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Restart with new port</TooltipContent>
              </Tooltip>
            </div>
            <p className="text-xs text-muted-foreground">
              {isRunning
                ? `Currently running on port ${mcpPort}`
                : "Port for the MCP endpoint. Changes require a restart."}
            </p>
          </div>

          {isRunning ? (
            <div className="rounded-lg bg-green-50 p-3 dark:bg-green-950/30">
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                >
                  Active
                </Badge>
                <span className="text-sm font-medium">MCP server is running</span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
              <div className="flex items-center gap-2">
                <CircleAlert className="size-4 text-amber-600" />
                <span className="text-sm">
                  MCP server is stopped. External AI assistants cannot connect until you start it — the Chat tab
                  is unaffected, since it reaches the same tools in-process.
                </span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Endpoint</Label>
            <div className="flex gap-2">
              <Textarea
                readOnly
                value={endpointUrl}
                className="h-9 resize-none border-0 bg-muted p-2 font-mono text-sm"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={copyEndpoint}>
                    <Copy className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode2 className="size-5" />
            Configure Your AI Assistant
          </CardTitle>
          <CardDescription>
            Pick your tool for the exact config and where it goes. Start the server above first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {AGENTS.map((a) => (
              <Button
                key={a.id}
                type="button"
                size="sm"
                variant={activeAgent === a.id ? "default" : "outline"}
                onClick={() => setActiveAgent(a.id)}
              >
                {a.label}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <Label className="block">{agent.lang === "bash" ? "Command" : "Configuration"}</Label>
                <p className="truncate font-mono text-xs text-muted-foreground">{agent.file}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={copyConfig} className="shrink-0">
                <Copy className="mr-2 size-3" />
                Copy
              </Button>
            </div>
            <Textarea readOnly value={agentConfig} className="h-32 resize-none font-mono text-sm" />
            <p className="text-xs text-muted-foreground">{agent.note}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="size-5" />
            Security
          </CardTitle>
          <CardDescription>How your data and credentials are protected when using MCP.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-green-600">&#10003;</span>
              <span>
                <strong>Credentials never leave your machine.</strong> AWS credentials are stored in the app's
                secure credential store and are never sent to any AI model or external service.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-green-600">&#10003;</span>
              <span>
                <strong>Local-only communication.</strong> The MCP server listens on <code>127.0.0.1</code> only —
                it is not accessible from any other device on your network.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-green-600">&#10003;</span>
              <span>
                <strong>Log sanitization.</strong> Before any logs are sent to an AI model for analysis, common
                sensitive patterns (tokens, keys, credentials) are automatically redacted.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-green-600">&#10003;</span>
              <span>
                <strong>Account names only.</strong> The AI model sees only account display names — never account
                IDs, access keys, or other identifying information.
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {startMcp.isPending ? "Starting MCP server..." : "Stopping MCP server..."}
        </div>
      )}
    </div>
  );
}
