import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CircleAlert,
  CircleHelp,
  Copy,
  FileCode2,
  FolderOpen,
  LoaderCircle,
  Play,
  Radio,
  Shield,
  Terminal,
  Waypoints
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/PageHeader";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriClient } from "@/services/tauriClient";
import type { McpStatus, McpTransport } from "@/types/domain";

const DEFAULT_MCP_PORT = 5175;

type TransportOption = {
  value: McpTransport;
  label: string;
  hint: string;
  icon: typeof Radio;
};

const TRANSPORTS: TransportOption[] = [
  {
    value: "stdio",
    label: "stdio",
    hint: "The AI agent launches the server over stdin/stdout. Best for Claude Code, Cursor, Codex.",
    icon: Terminal
  },
  {
    value: "streamableHttp",
    label: "HTTP",
    hint: "Streamable HTTP. A single /mcp endpoint for agents that connect over the network.",
    icon: Waypoints
  },
  {
    value: "sse",
    label: "SSE",
    hint: "Legacy Server-Sent Events transport for older MCP clients.",
    icon: Radio
  }
];

// --- Per-agent MCP config generation -------------------------------------

type AgentTool = {
  id: string;
  label: string;
  file: string;
  note: string;
  lang: "bash" | "json" | "toml";
  build: (ctx: ConfigContext) => string;
};

type ConfigContext = {
  transport: McpTransport;
  endpointUrl: string;
  entryPoint: string;
};

const SERVER_KEY = "emr-eks";

function stdioBlock(entryPoint: string) {
  return { command: "node", args: [entryPoint] };
}

function httpBlock(ctx: ConfigContext) {
  return { type: ctx.transport === "sse" ? "sse" : "http", url: ctx.endpointUrl };
}

function claudeCodeConfig(ctx: ConfigContext): string {
  if (ctx.transport === "stdio") {
    return `claude mcp add ${SERVER_KEY} -- node ${ctx.entryPoint}`;
  }
  const type = ctx.transport === "sse" ? "sse" : "http";
  return `claude mcp add --transport ${type} ${SERVER_KEY} ${ctx.endpointUrl}`;
}

function mcpJsonConfig(ctx: ConfigContext): string {
  const server = ctx.transport === "stdio" ? stdioBlock(ctx.entryPoint) : httpBlock(ctx);
  return JSON.stringify({ mcpServers: { [SERVER_KEY]: server } }, null, 2);
}

function cursorConfig(ctx: ConfigContext): string {
  const server = ctx.transport === "stdio" ? stdioBlock(ctx.entryPoint) : { url: ctx.endpointUrl };
  return JSON.stringify({ mcpServers: { [SERVER_KEY]: server } }, null, 2);
}

function codexConfig(ctx: ConfigContext): string {
  if (ctx.transport === "stdio") {
    return [
      `[mcp_servers.${SERVER_KEY}]`,
      `command = "node"`,
      `args = ["${ctx.entryPoint}"]`
    ].join("\n");
  }
  return [`[mcp_servers.${SERVER_KEY}]`, `url = "${ctx.endpointUrl}"`].join("\n");
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

function AuditLogHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="About the audit log">
          <CircleHelp className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 space-y-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">About the audit log</p>
        <p>
          Each day's entries are written to a separate <code>mcp-audit-YYYY-MM-DD.jsonl</code> file. Each line
          contains the tool name, arguments, result preview, duration, and any errors.
        </p>
        <p>
          Raw (unsanitized) log text captured by certain tools is stored alongside in a <code>raw/</code>{" "}
          subdirectory, keyed by entry ID.
        </p>
        <p>
          Logs are retained for 30 days and automatically pruned. You can also use the{" "}
          <code>get_audit_entry</code> MCP tool to retrieve a specific entry by its ID.
        </p>
        <p>
          Open the directory from this page, or from the <strong>Help &rarr; View MCP Audit Log</strong> menu.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function McpPage() {
  const queryClient = useQueryClient();
  const [port, setPort] = useState(DEFAULT_MCP_PORT);
  const [transport, setTransport] = useState<McpTransport>("stdio");
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
  const bridgePort = status?.bridgePort;
  const mcpPort = status?.mcpPort ?? port;
  const isStdio = transport === "stdio";
  const entryPoint = status?.entryPoint ?? "<app>/mcp/dist/index.js";
  const endpointUrl =
    (isRunning ? status?.endpointUrl : undefined) ??
    (transport === "stdio"
      ? `node ${entryPoint}`
      : `http://127.0.0.1:${mcpPort}${transport === "sse" ? "/sse" : "/mcp"}`);

  const configCtx: ConfigContext = useMemo(
    () => ({ transport, endpointUrl, entryPoint }),
    [transport, endpointUrl, entryPoint]
  );

  const startMcp = useMutation({
    mutationFn: (nextTransport: McpTransport) =>
      tauriClient.mcpStart({ port, transport: nextTransport }),
    onSuccess: (result: McpStatus) => {
      queryClient.setQueryData(["mcp-status"], result);
      toast.success(
        result.transport === "stdio"
          ? "MCP bridge ready for stdio clients"
          : `MCP server started on port ${result.mcpPort}`
      );
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

  const openAuditLog = useMutation({
    mutationFn: () => tauriClient.openMcpAuditLog(),
    onError: (err: Error) => {
      toast.error(err.message || "Failed to open the audit log directory");
    }
  });

  const busy = startMcp.isPending || stopMcp.isPending;

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        startMcp.mutate(transport);
      } else {
        stopMcp.mutate();
      }
    },
    [startMcp, stopMcp, transport]
  );

  // Switching transport while running needs a restart — the child process reads
  // MCP_TRANSPORT once at spawn time.
  const handleTransportChange = useCallback(
    (next: McpTransport) => {
      if (next === transport) return;
      setTransport(next);
      if (!isRunning) return;
      stopMcp.mutate(undefined, {
        onSuccess: () => startMcp.mutate(next)
      });
    },
    [transport, isRunning, startMcp, stopMcp]
  );

  useEffect(() => {
    if (isRunning && status?.mcpPort && status.mcpPort !== port) {
      setPort(status.mcpPort);
    }
  }, [isRunning, status?.mcpPort, port]);

  const agent = AGENTS.find((a) => a.id === activeAgent) ?? AGENTS[0];
  const agentConfig = agent.build(configCtx);

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
    <div className="flex max-w-4xl flex-col gap-6 overflow-auto">
      <PageHeader pageId="mcp" actions={<AuditLogHelp />} />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-5" />
              MCP Server
            </CardTitle>
            <CardDescription>
              Start the built-in MCP server to allow AI assistants to query EMR jobs and logs through your app.
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
          <div className="flex flex-wrap items-center gap-3">
            <Label className="shrink-0">Protocol</Label>
            <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/50 p-1">
              {TRANSPORTS.map((option) => {
                const Icon = option.icon;
                const selected = transport === option.value;
                return (
                  <Tooltip key={option.value}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleTransportChange(option.value)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          "disabled:cursor-not-allowed disabled:opacity-60",
                          selected
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Icon className="size-3.5" />
                        {option.label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{option.hint}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
          {isRunning && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Switching the protocol restarts the MCP server.
            </p>
          )}

          {!isStdio && (
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
                          onSuccess: () => startMcp.mutate(transport)
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
          )}

          {isRunning ? (
            <div className="rounded-lg bg-green-50 p-3 dark:bg-green-950/30">
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                >
                  Active
                </Badge>
                <span className="text-sm font-medium">
                  {isStdio ? "MCP bridge is running (stdio ready)" : "MCP server is running"}
                </span>
                {bridgePort && (
                  <span className="text-xs text-muted-foreground">
                    (bridge: {bridgePort}
                    {status?.pid ? `, PID: ${status.pid}` : ""})
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
              <div className="flex items-center gap-2">
                <CircleAlert className="size-4 text-amber-600" />
                <span className="text-sm">
                  MCP server is stopped. AI assistants cannot connect until you start it.
                </span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>{isStdio ? "Launch command" : "Endpoint"}</Label>
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
                <Label className="block">
                  {agent.lang === "bash" ? "Command" : "Configuration"}
                </Label>
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
                <strong>Token-authenticated bridge.</strong> Internal API calls between MCP and the app require a
                randomly generated token that is created fresh each time the server starts.
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

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-5" />
              Audit Log
            </CardTitle>
            <CardDescription>
              Every MCP tool invocation is logged locally. Open the directory to review the full interaction
              history.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={openAuditLog.isPending}
            onClick={() => openAuditLog.mutate()}
          >
            <FolderOpen className="mr-2 size-4" />
            Open Audit Log
          </Button>
        </CardHeader>
        <CardContent>
          {isRunning ? (
            <p className="flex items-center gap-2 text-sm text-green-600">
              <span className="inline-block size-2 rounded-full bg-green-500" />
              Audit logging is active
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-block size-2 rounded-full bg-muted-foreground/50" />
              Start the MCP server to begin logging
            </p>
          )}
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
