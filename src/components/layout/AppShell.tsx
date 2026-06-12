import { type ReactElement, useMemo, useState } from "react";
import { Cloud, PanelLeftClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAwsAccounts } from "@/hooks/useAwsSettings";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { DashboardPage } from "@/pages/DashboardPage";
import { JobHistoryPage } from "@/pages/JobHistoryPage";
import { LogsPage } from "@/pages/LogsPage";
import { navigationItems, type PageId } from "@/pages/pageMeta";
import { S3BrowserPage } from "@/pages/S3BrowserPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SubmitJobPage } from "@/pages/SubmitJobPage";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { VirtualClustersPage } from "@/pages/VirtualClustersPage";

export function AppShell() {
  const [activePage, setActivePage] = useState<PageId>("submit");
  const activeMeta = useMemo(() => navigationItems.find((item) => item.id === activePage), [activePage]);
  const accounts = useAwsAccounts();
  const activeAccount = accounts.data?.find((account) => account.isActive);
  const pageComponents: Record<PageId, ReactElement> = {
    dashboard: <DashboardPage />,
    submit: <SubmitJobPage />,
    history: <JobHistoryPage onOpenLogs={() => setActivePage("logs")} onOpenS3={() => setActivePage("s3")} />,
    logs: <LogsPage />,
    templates: <TemplatesPage />,
    clusters: <VirtualClustersPage />,
    s3: <S3BrowserPage />,
    settings: <SettingsPage />
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-72 shrink-0 flex-col border-r bg-card">
        <div className="flex h-20 items-center gap-3 px-6">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Cloud className="size-5" />
          </div>
          <div>
            <div className="font-semibold">EMR on EKS</div>
            <div className="text-xs text-muted-foreground">Management Tool</div>
          </div>
        </div>
        <Separator />
        <div className="px-4 py-4">
          <Card className="bg-secondary/60 p-3 shadow-none">
            <div className="text-xs font-medium text-muted-foreground">Current Region</div>
            <div className="mt-1 text-sm font-semibold">{activeAccount?.region ?? "No active account"}</div>
            <div className="text-xs text-muted-foreground">{activeAccount?.name ?? "Configure Settings first"}</div>
          </Card>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 pb-4" aria-label="Primary">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const active = item.id === activePage;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActivePage(item.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="size-4" />
                <span className="flex flex-col">
                  <span className="font-medium">{item.label}</span>
                  <span className={cn("text-xs", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-card px-6">
          <div>
            <div className="text-sm font-medium">{activeMeta?.label}</div>
            <div className="text-xs text-muted-foreground">{activeMeta?.description}</div>
          </div>
          <Button variant="ghost" size="sm">
            <PanelLeftClose data-icon="inline-start" />
            Desktop Mode
          </Button>
        </header>
        <main className="min-w-0 flex-1 overflow-auto p-6">{pageComponents[activePage]}</main>
      </div>
    </div>
  );
}
