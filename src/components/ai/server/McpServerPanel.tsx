import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CircleAlert, Copy, FileCode2, LoaderCircle, Play, Shield, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriClient } from "@/services/tauriClient";
import type { McpStatus, McpToolInfo } from "@/types/domain";

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
  const t = useT();
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

  const { data: tools = [], isLoading: toolsLoading } = useQuery({
    queryKey: ["mcp-tools"],
    queryFn: () => tauriClient.listMcpTools(),
    refetchInterval: 5_000
  });

  const builtinTools = useMemo(() => tools.filter((tool) => !tool.isDbhub), [tools]);
  const dbhubTools = useMemo(() => tools.filter((tool) => tool.isDbhub), [tools]);

  const isRunning = status?.running ?? false;
  const mcpPort = status?.mcpPort ?? port;
  const endpointUrl =
    (isRunning ? status?.endpointUrl : undefined) ?? `http://127.0.0.1:${mcpPort}/mcp`;

  const startMcp = useMutation({
    mutationFn: () => tauriClient.mcpStart({ port }),
    onSuccess: (result: McpStatus) => {
      queryClient.setQueryData(["mcp-status"], result);
      toast.success(t("MCP server started on port {port}", { port: result.mcpPort ?? port }));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to start MCP server");
    }
  });

  const stopMcp = useMutation({
    mutationFn: () => tauriClient.mcpStop(),
    onSuccess: () => {
      queryClient.setQueryData(["mcp-status"], { running: false } as McpStatus);
      toast.success(t("MCP server stopped"));
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
      () => toast.success(t("{name} config copied", { name: agent.label })),
      () => toast.error("Failed to copy to clipboard")
    );
  }, [agentConfig, agent.label, t]);

  const copyEndpoint = useCallback(() => {
    navigator.clipboard.writeText(endpointUrl).then(
      () => toast.success(t("Copied to clipboard")),
      () => toast.error("Failed to copy")
    );
  }, [endpointUrl, t]);

  return (
    <div className="max-w-4xl space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-5" />
              {t("MCP Server")}
            </CardTitle>
            <CardDescription>
              {t("Start the built-in MCP server to allow AI assistants to query EMR jobs and logs through your app. It serves a single Streamable HTTP endpoint on {address}.", { address: "127.0.0.1" })}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Label htmlFor="mcp-toggle" className="text-sm">
              {isRunning ? t("Running") : t("Stopped")}
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
            <Label htmlFor="mcp-port">{t("MCP Port")}</Label>
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
                <TooltipContent>{t("Restart with new port")}</TooltipContent>
              </Tooltip>
            </div>
            <p className="text-xs text-muted-foreground">
              {isRunning
                ? t("Currently running on port {port}", { port: mcpPort })
                : t("Port for the MCP endpoint. Changes require a restart.")}
            </p>
          </div>

          {isRunning ? (
            <div className="rounded-lg bg-green-50 p-3 dark:bg-green-950/30">
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                >
                  {t("Active")}
                </Badge>
                <span className="text-sm font-medium">{t("MCP server is running")}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
              <div className="flex items-center gap-2">
                <CircleAlert className="size-4 text-amber-600" />
                <span className="text-sm">
                  {t("MCP server is stopped. External AI assistants cannot connect until you start it — the Chat tab is unaffected, since it reaches the same tools in-process.")}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>{t("Endpoint")}</Label>
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
                <TooltipContent>{t("Copy")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode2 className="size-5" />
            {t("Configure Your AI Assistant")}
          </CardTitle>
          <CardDescription>
            {t("Pick your tool for the exact config and where it goes. Start the server above first.")}
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
                <Label className="block">{agent.lang === "bash" ? t("Command") : t("Configuration")}</Label>
                <p className="truncate font-mono text-xs text-muted-foreground">{agent.file}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={copyConfig} className="shrink-0">
                <Copy className="mr-2 size-3" />
                {t("Copy")}
              </Button>
            </div>
            <Textarea readOnly value={agentConfig} className="h-32 resize-none font-mono text-sm" />
            <p className="text-xs text-muted-foreground">{t(agent.note)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="size-5" />
            {t("Available tools")}
          </CardTitle>
          <CardDescription>
            {t("Tools Chat and external agents can call. DBHub tools are rebuilt from the active account's AI-enabled connections.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {toolsLoading && tools.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              {t("Loading tools…")}
            </div>
          ) : (
            <>
              <ToolGroup title={t("Built-in")} tools={builtinTools} />
              <ToolGroup
                title={t("DBHub (active account)")}
                empty={t("No AI-enabled connections. Turn on Enabled for AI on a DBHub connection card.")}
                tools={dbhubTools}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="size-5" />
            {t("Security")}
          </CardTitle>
          <CardDescription>{t("How your data and credentials are protected when using MCP.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-green-600">&#10003;</span>
              <span>
                <strong>{t("Credentials never leave your machine.")}</strong>{" "}
                {t("AWS credentials are stored in the app's secure credential store and are never sent to any AI model or external service.")}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-green-600">&#10003;</span>
              <span>
                <strong>{t("Local-only communication.")}</strong>{" "}
                {t("The MCP server listens on {address} only — it is not accessible from any other device on your network.", { address: "127.0.0.1" })}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-green-600">&#10003;</span>
              <span>
                <strong>{t("Log sanitization.")}</strong>{" "}
                {t("Before any logs are sent to an AI model for analysis, common sensitive patterns (tokens, keys, credentials) are automatically redacted.")}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-green-600">&#10003;</span>
              <span>
                <strong>{t("Account names only.")}</strong>{" "}
                {t("The AI model sees only account display names — never account IDs, access keys, or other identifying information.")}
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {startMcp.isPending ? t("Starting MCP server...") : t("Stopping MCP server...")}
        </div>
      )}
    </div>
  );
}

function ToolGroup({
  title,
  tools,
  empty
}: {
  title: string;
  tools: McpToolInfo[];
  empty?: string;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{t(title)}</Label>
        <Badge variant="secondary">{tools.length}</Badge>
      </div>
      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(empty ?? "None.")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {tools.map((tool) => (
            <li key={tool.name} className="space-y-1 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-sm font-medium">{tool.name}</code>
                <Badge variant={tool.enabled ? "default" : "outline"}>
                  {tool.enabled ? t("enabled") : t("disabled")}
                </Badge>
                <Badge variant="outline">
                  {t("auto-approve: {state}", {
                    state:
                      tool.autoApprove === "default_allow" ? t("default allow") : tool.autoApprove
                  })}
                </Badge>
              </div>
              {tool.description ? (
                <p className="text-xs text-muted-foreground">{tool.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
