import { lazy, Suspense, useCallback, useMemo, useState, useTransition } from "react";
import { CheckCircle2, Cloud, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
import { SubmitJobPage } from "@/pages/SubmitJobPage";
import { navigationItems, type PageId } from "@/pages/pageMeta";
import { PageLoader } from "@/components/layout/PageLoader";

const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const JobHistoryPage = lazy(() => import("@/pages/JobHistoryPage").then((module) => ({ default: module.JobHistoryPage })));
const LogsPage = lazy(() => import("@/pages/LogsPage").then((module) => ({ default: module.LogsPage })));
const TemplatesPage = lazy(() => import("@/pages/TemplatesPage").then((module) => ({ default: module.TemplatesPage })));
const VirtualClustersPage = lazy(() =>
  import("@/pages/VirtualClustersPage").then((module) => ({ default: module.VirtualClustersPage }))
);
const S3BrowserPage = lazy(() => import("@/pages/S3BrowserPage").then((module) => ({ default: module.S3BrowserPage })));
const GlueCatalogPage = lazy(() =>
  import("@/pages/GlueCatalogPage").then((module) => ({ default: module.GlueCatalogPage }))
);
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));

export function AppShell() {
  const [activePage, setActivePage] = useState<PageId>("submit");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [, startPageTransition] = useTransition();
  const accounts = useAwsAccounts();
  const activeAccount = accounts.data?.find((account) => account.isActive);
  const setActiveAccount = useSetActiveAwsAccount();
  const openLogsPage = useCallback(() => {
    startPageTransition(() => setActivePage("logs"));
  }, []);
  const openS3Page = useCallback(() => {
    startPageTransition(() => setActivePage("s3"));
  }, []);
  const navigateToPage = useCallback((page: PageId) => {
    startPageTransition(() => setActivePage(page));
  }, []);

  const activePageContent = useMemo(() => {
    switch (activePage) {
      case "dashboard":
        return <DashboardPage />;
      case "submit":
        return <SubmitJobPage />;
      case "history":
        return <JobHistoryPage onOpenLogs={openLogsPage} onOpenS3={openS3Page} />;
      case "logs":
        return <LogsPage />;
      case "templates":
        return <TemplatesPage />;
      case "clusters":
        return <VirtualClustersPage />;
      case "s3":
        return <S3BrowserPage />;
      case "glue":
        return <GlueCatalogPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return <SubmitJobPage />;
    }
  }, [activePage, openLogsPage, openS3Page]);

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
                <div className="text-xs font-medium text-muted-foreground">Current Account</div>
                <div className="mt-1 truncate text-sm font-semibold">{activeAccount?.name ?? "No active account"}</div>
                <div className="truncate text-xs text-muted-foreground">{activeAccount?.region ?? "Configure Settings first"}</div>
              </>
            )}
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 pb-4" aria-label="Primary">
          {navigationItems.map((item) => renderNavButton({ item, activePage, setActivePage: navigateToPage, sidebarCollapsed }))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
          <Suspense fallback={<PageLoader />}>
            <div className="flex min-h-0 flex-1 flex-col">{activePageContent}</div>
          </Suspense>
        </main>
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

type NavItem = (typeof navigationItems)[number];

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
