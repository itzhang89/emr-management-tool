import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Bot,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Copy,
  FileCode2,
  History,
  LoaderCircle,
  Play,
  RefreshCw,
  Shield,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriClient } from "@/services/tauriClient";
import type { McpAuditEntry, McpStatus } from "@/types/domain";

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
          Logs are retained for 30 days and automatically pruned. Recent entries can be reviewed in the{" "}
          <strong>Audit Log</strong> tab on this page.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function auditSummary(entry: McpAuditEntry): string {
  if (entry.error) return "Error";
  const causes = entry.resultPreview.candidateCauses ?? [];
  if (causes.length > 0) return causes.join("; ");
  const size = entry.resultPreview.sizeChars;
  return size ? `${size.toLocaleString()} chars returned` : "OK";
}

function AuditLogRow({ entry }: { entry: McpAuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <TableCell className="w-8 pr-0">
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
        </TableCell>
        <TableCell className="whitespace-nowrap font-mono text-xs">
          {format(new Date(entry.timestamp), "MM-dd HH:mm:ss")}
        </TableCell>
        <TableCell className="font-mono text-xs">{entry.tool}</TableCell>
        <TableCell>
          {entry.error ? (
            <Badge variant="destructive" className="text-xs">
              Error
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            >
              OK
            </Badge>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDuration(entry.duration)}
        </TableCell>
        <TableCell className="max-w-md truncate text-xs text-muted-foreground">{auditSummary(entry)}</TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="hover:bg-muted/30">
          <TableCell colSpan={6} className="bg-muted/30 py-3">
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Request arguments</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">
                    {JSON.stringify(entry.args ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Result preview</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">
                    {JSON.stringify(entry.resultPreview ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
              {entry.error && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-destructive">Error</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                    {entry.error}
                  </pre>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function AuditLogPanel() {
  const queryClient = useQueryClient();
  const { data: auditDir } = useQuery({
    queryKey: ["mcp-audit-dir"],
    queryFn: () => tauriClient.getMcpAuditDir()
  });
  const { data: entries, isLoading, isFetching } = useQuery({
    queryKey: ["mcp-audit-entries"],
    queryFn: () => tauriClient.listMcpAuditEntries(200),
    refetchInterval: 5000
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["mcp-audit-entries"] });
  }, [queryClient]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <History className="size-5" />
            Audit Log
          </CardTitle>
          <CardDescription>
            Recent MCP tool invocations — time, status, request arguments and result preview. Click a row for
            details. Entries are retained for 30 days.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={refresh} disabled={isFetching}>
          <RefreshCw className={cn("mr-2 size-4", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Loading audit entries...
          </p>
        ) : (entries ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tool invocations recorded yet. Entries appear here after an AI assistant calls a tool through the
            MCP server.
          </p>
        ) : (
          <div className="overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Time</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(entries ?? []).map((entry) => (
                  <AuditLogRow key={entry.id} entry={entry} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {auditDir && (
          <p className="mt-3 truncate font-mono text-xs text-muted-foreground" title={auditDir}>
            Files: {auditDir}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function McpPage() {
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
  const bridgePort = status?.bridgePort;
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
    <div className="flex max-w-4xl flex-col gap-6 overflow-auto">
      <PageHeader pageId="mcp" actions={<AuditLogHelp />} />

      <Tabs defaultValue="server" className="flex flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="server">Server</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="server" className="mt-0 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-2">
                  <Bot className="size-5" />
                  MCP Server
                </CardTitle>
                <CardDescription>
                  Start the built-in MCP server to allow AI assistants to query EMR jobs and logs through your
                  app. It serves a single Streamable HTTP endpoint on <code>127.0.0.1</code>.
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
                    <strong>Local-only communication.</strong> The MCP server listens on <code>127.0.0.1</code>{" "}
                    only — it is not accessible from any other device on your network.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-green-600">&#10003;</span>
                  <span>
                    <strong>Token-authenticated bridge.</strong> Internal API calls between MCP and the app require
                    a randomly generated token that is created fresh each time the server starts.
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
                    <strong>Account names only.</strong> The AI model sees only account display names — never
                    account IDs, access keys, or other identifying information.
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-0">
          <AuditLogPanel />
        </TabsContent>
      </Tabs>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {startMcp.isPending ? "Starting MCP server..." : "Stopping MCP server..."}
        </div>
      )}
    </div>
  );
}
