import { Copy, Download, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useJobLogs } from "@/hooks/useLogs";
import { useSessionStore } from "@/stores/sessionStore";

export function LogsPage() {
  const selectedJobId = useSessionStore((state) => state.selectedJobId) ?? "job-preview";
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [search, setSearch] = useState("");
  const logs = useJobLogs(selectedJobId, undefined, autoRefresh);
  const logLines = useMemo(
    () =>
      (logs.data?.entries ?? [])
        .map((entry) => `${entry.timestamp} ${entry.level.toUpperCase()} ${entry.message}`)
        .filter((line) => line.toLowerCase().includes(search.toLowerCase())),
    [logs.data?.entries, search]
  );

  const logText = logLines.join("\n");
  const copyLogs = async () => {
    await navigator.clipboard?.writeText(logText);
    toast.success("Logs copied.");
  };
  const downloadLogs = () => {
    const url = URL.createObjectURL(new Blob([logText], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedJobId}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="text-sm text-muted-foreground">Browse driver, executor, and CloudWatch log streams.</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          Auto Refresh
          <Switch aria-label="Auto refresh logs" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>CloudWatch Logs</CardTitle>
          <CardDescription>Log data is loaded through Tauri commands backed by CloudWatch Logs.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search log text" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Button variant="outline" onClick={() => logs.refetch()}>
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
            <Button variant="outline" onClick={copyLogs}>
              <Copy data-icon="inline-start" />
              Copy
            </Button>
            <Button variant="outline" onClick={downloadLogs}>
              <Download data-icon="inline-start" />
              Download
            </Button>
          </div>
          <Tabs defaultValue="driver">
            <TabsList>
              <TabsTrigger value="driver">Driver Log</TabsTrigger>
              <TabsTrigger value="executor">Executor Log</TabsTrigger>
              <TabsTrigger value="cloudwatch">CloudWatch Log</TabsTrigger>
            </TabsList>
            {["driver", "executor", "cloudwatch"].map((tab) => (
              <TabsContent key={tab} value={tab}>
                <ScrollArea className="h-[520px] rounded-md border bg-slate-950 p-4">
                  <pre className="font-mono text-xs leading-6 text-slate-100">
                    {logText || "No log lines match the current filters."}
                  </pre>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
