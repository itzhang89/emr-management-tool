import { type ReactElement, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Cloud, Layers3, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useAwsAccounts, useSetActiveAwsAccount } from "@/hooks/useAwsSettings";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ApplicationConfigTemplatesPage } from "@/pages/ApplicationConfigTemplatesPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { JobHistoryPage } from "@/pages/JobHistoryPage";
import { LogsPage } from "@/pages/LogsPage";
import { navigationItems, templateNavigationItems, type PageId } from "@/pages/pageMeta";
import { S3BrowserPage } from "@/pages/S3BrowserPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SubmitJobPage } from "@/pages/SubmitJobPage";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { VirtualClustersPage } from "@/pages/VirtualClustersPage";

export function AppShell() {
  const [activePage, setActivePage] = useState<PageId>("submit");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(true);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const activeMeta = useMemo(
    () => [...navigationItems, ...templateNavigationItems].find((item) => item.id === activePage),
    [activePage]
  );
  const accounts = useAwsAccounts();
  const activeAccount = accounts.data?.find((account) => account.isActive);
  const setActiveAccount = useSetActiveAwsAccount();
  const pageComponents: Record<PageId, ReactElement> = {
    dashboard: <DashboardPage />,
    submit: <SubmitJobPage />,
    history: <JobHistoryPage onOpenLogs={() => setActivePage("logs")} onOpenS3={() => setActivePage("logs")} />,
    logs: <LogsPage />,
    templates: <TemplatesPage />,
    appConfig: <ApplicationConfigTemplatesPage />,
    clusters: <VirtualClustersPage />,
    s3: <S3BrowserPage />,
    settings: <SettingsPage />
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className={cn("flex shrink-0 flex-col border-r bg-card transition-[width]", sidebarCollapsed ? "w-20" : "w-72")}>
        <div className={cn("flex h-20 items-center gap-3 px-4", sidebarCollapsed ? "justify-center px-2" : "justify-between px-6")}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Cloud className="size-5" />
            </div>
            {!sidebarCollapsed ? (
              <div className="min-w-0">
                <div className="font-semibold">EMR on EKS</div>
                <div className="text-xs text-muted-foreground">Management Tool</div>
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>
        <Separator />
        <div className={cn("py-4", sidebarCollapsed ? "px-2" : "px-4")}>
          <button
            type="button"
            className={cn(
              "w-full rounded-lg bg-secondary/60 p-3 text-left shadow-none transition-colors hover:bg-secondary",
              sidebarCollapsed ? "flex justify-center" : undefined
            )}
            aria-label="Switch AWS account"
            title="Switch AWS account"
            onClick={() => setAccountDialogOpen(true)}
          >
            {sidebarCollapsed ? (
              <Cloud className="size-5 text-muted-foreground" />
            ) : (
              <>
                <div className="text-xs font-medium text-muted-foreground">Current Region</div>
                <div className="mt-1 truncate text-sm font-semibold">{activeAccount?.region ?? "No active account"}</div>
                <div className="truncate text-xs text-muted-foreground">{activeAccount?.name ?? "Configure Settings first"}</div>
              </>
            )}
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 pb-4" aria-label="Primary">
          {navigationItems.slice(0, 3).map((item) =>
            renderNavButton({ item, activePage, setActivePage, sidebarCollapsed })
          )}
          <div>
            <button
              type="button"
              onClick={() => setTemplatesOpen((open) => !open)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                sidebarCollapsed ? "justify-center" : undefined,
                templateNavigationItems.some((item) => item.id === activePage) ? "bg-accent text-accent-foreground" : undefined
              )}
              aria-expanded={sidebarCollapsed ? true : templatesOpen}
              aria-label="Templates"
              title="Templates"
            >
              <Layers3 className="size-4 shrink-0" />
              {!sidebarCollapsed ? (
                <>
                  <span className="flex flex-1 flex-col">
                    <span className="font-medium">Templates</span>
                    <span className="text-xs text-muted-foreground">Config and resources</span>
                  </span>
                  <ChevronDown className={cn("size-4 transition-transform", templatesOpen ? "rotate-180" : undefined)} />
                </>
              ) : null}
            </button>
            {(templatesOpen || sidebarCollapsed) ? (
              <div className={cn("mt-1 flex flex-col gap-1", sidebarCollapsed ? undefined : "pl-5")}>
                {templateNavigationItems.map((item) =>
                  renderNavButton({ item, activePage, setActivePage, sidebarCollapsed, compact: true })
                )}
              </div>
            ) : null}
          </div>
          {navigationItems.slice(3).map((item) =>
            renderNavButton({ item, activePage, setActivePage, sidebarCollapsed })
          )}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-card px-6">
          <div>
            <div className="text-sm font-medium">{activeMeta?.label}</div>
            <div className="text-xs text-muted-foreground">{activeMeta?.description}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}>
            {sidebarCollapsed ? <PanelLeftOpen data-icon="inline-start" /> : <PanelLeftClose data-icon="inline-start" />}
            {sidebarCollapsed ? "Expand Nav" : "Collapse Nav"}
          </Button>
        </header>
        <main className="min-w-0 flex-1 overflow-auto p-6">{pageComponents[activePage]}</main>
      </div>
      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch AWS Account</DialogTitle>
            <DialogDescription>Choose the active AWS account used by EMR, CloudWatch, and S3.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {accounts.isLoading ? <p className="text-sm text-muted-foreground">Loading accounts...</p> : null}
            {accounts.error ? <p className="text-sm text-destructive">Failed to load AWS accounts.</p> : null}
            {accounts.data?.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No AWS accounts are configured yet. Open Settings to add one.
              </p>
            ) : null}
            {accounts.data?.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-3 rounded-lg border p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{account.name}</p>
                    {account.isActive ? <Badge>Active</Badge> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {account.region} · {account.accessKeyIdMasked}
                    {account.identity ? ` · ${account.identity.account}` : ""}
                  </p>
                  {account.identity ? <p className="truncate text-xs text-muted-foreground">{account.identity.arn}</p> : null}
                </div>
                <Button
                  type="button"
                  variant={account.isActive ? "secondary" : "outline"}
                  disabled={account.isActive || setActiveAccount.isPending}
                  onClick={() => {
                    setActiveAccount.mutate(account.id, {
                      onSuccess: () => {
                        toast.success(`${account.name} is now active.`);
                        setAccountDialogOpen(false);
                      },
                      onError: (error) =>
                        toast.error(error instanceof Error ? error.message : "Failed to set active account.")
                    });
                  }}
                >
                  <CheckCircle2 data-icon="inline-start" />
                  {account.isActive ? "Active" : "Use"}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type NavItem = (typeof navigationItems)[number] | (typeof templateNavigationItems)[number];

function renderNavButton({
  item,
  activePage,
  setActivePage,
  sidebarCollapsed,
  compact = false
}: {
  item: NavItem;
  activePage: PageId;
  setActivePage: (page: PageId) => void;
  sidebarCollapsed: boolean;
  compact?: boolean;
}) {
  const Icon = item.icon;
  const active = item.id === activePage;

  return (
    <button
      key={item.id}
      type="button"
      onClick={() => setActivePage(item.id)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors",
        compact ? "py-2" : "py-2.5",
        sidebarCollapsed ? "justify-center" : undefined,
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
      aria-label={item.label}
      title={item.label}
    >
      <Icon className="size-4 shrink-0" />
      {!sidebarCollapsed ? (
        <span className="flex flex-col">
          <span className="font-medium">{item.label}</span>
          <span className={cn("text-xs", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
            {item.description}
          </span>
        </span>
      ) : null}
    </button>
  );
}
