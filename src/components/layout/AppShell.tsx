import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useTransition } from "react";
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
import { AboutDialog } from "@/components/help/AboutDialog";
import { ShortcutsDialog } from "@/components/help/ShortcutsDialog";
import { useAwsAccounts, useSetActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useT, type Translator } from "@/i18n";
import { t as translateNow } from "@/i18n/translate";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatModShortcut, getPageNavigationIndex, isAccountSwitchKey, isPageCycleNextKey, isPageCyclePreviousKey, isShortcutsHelpKey, isSidebarToggleKey } from "@/lib/keyboardShortcut";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import { SubmitJobPage } from "@/pages/SubmitJobPage";
import { isBottomNavItem, navigationItems, type PageId } from "@/pages/pageMeta";
import type { JobRunSummary } from "@/types/domain";
import { OVERVIEW_TAB } from "@/pages/DbHubPage";
import type { LogTabIntent } from "@/pages/JobHistoryPage";
import { DbHubSubNav } from "@/components/layout/DbHubSubNav";
import { PageLoader } from "@/components/layout/PageLoader";
import { appUpdater } from "@/services/appUpdater";
import { getReleaseInfo } from "@/services/releaseInfo";
import { bindHelpMenuEvents } from "@/services/helpMenuEvents";
import { getAdjacentPageId, getNavigationIndex, getPageIdByNavigationIndex } from "@/services/pageNavigation";

const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const JobHistoryPage = lazy(() => import("@/pages/JobHistoryPage").then((module) => ({ default: module.JobHistoryPage })));
const TemplatesPage = lazy(() => import("@/pages/TemplatesPage").then((module) => ({ default: module.TemplatesPage })));
const VirtualClustersPage = lazy(() =>
  import("@/pages/VirtualClustersPage").then((module) => ({ default: module.VirtualClustersPage }))
);
const S3BrowserPage = lazy(() => import("@/pages/S3BrowserPage").then((module) => ({ default: module.S3BrowserPage })));
const DbHubPage = lazy(() =>
  import("@/pages/DbHubPage").then((module) => ({ default: module.DbHubPage }))
);
const SecretsPage = lazy(() =>
  import("@/pages/SecretsPage").then((module) => ({ default: module.SecretsPage }))
);
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const AiAssistantPage = lazy(() =>
  import("@/pages/AiAssistantPage").then((module) => ({ default: module.AiAssistantPage }))
);

export function AppShell() {
  const t = useT();
  const releaseInfo = getReleaseInfo();
  const [activePage, setActivePage] = useState<PageId>("submit");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  // Which DBHub tab the sidebar's second level points at. Undefined unless the
  // user navigated there through the sub-nav; the page keeps its own state
  // otherwise.
  const [dbHubTabIntent, setDbHubTabIntent] = useState<string>();
  // Which job's logs the Job History page should open, as a one-shot token.
  // The job itself also rides in the session store (JobRunsPanel writes it);
  // the nonce is what makes each request distinct, so a tab the user closed
  // does not come back the next time the page re-renders.
  const [logTabIntent, setLogTabIntent] = useState<LogTabIntent>();
  const [, startPageTransition] = useTransition();
  const accounts = useAwsAccounts();
  const accountList = accounts.data ?? [];
  const activeAccount = accountList.find((account) => account.isActive);
  const setActiveAccount = useSetActiveAwsAccount();
  // Logs live inside Job History now: go there and ask for a tab.
  const openLogsPage = useCallback((job: JobRunSummary) => {
    setLogTabIntent((current) => ({
      jobId: job.id,
      virtualClusterId: job.virtualClusterId,
      nonce: (current?.nonce ?? 0) + 1
    }));
    startPageTransition(() => setActivePage("history"));
  }, []);
  const openSubmitPage = useCallback(() => {
    startPageTransition(() => setActivePage("submit"));
  }, []);
  const openAiAssistantPage = useCallback(() => {
    startPageTransition(() => setActivePage("ai"));
  }, []);
  const navigateToPage = useCallback((page: PageId) => {
    startPageTransition(() => setActivePage(page));
  }, []);
  // Sidebar sub-navigation: jump straight into a DBHub tab (Glue Catalog or a
  // pinned connection's workspace).
  const openDbHubTab = useCallback((tabValue: string) => {
    startPageTransition(() => {
      setDbHubTabIntent(tabValue);
      setActivePage("glue");
    });
  }, []);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => !collapsed);
  }, []);
  const initializeAccountSelection = useCallback(() => {
    const activeId = accounts.data?.find((account) => account.isActive)?.id;
    setSelectedAccountId(activeId ?? accounts.data?.[0]?.id ?? null);
  }, [accounts.data]);
  const openAccountDialog = useCallback(() => {
    initializeAccountSelection();
    setAccountDialogOpen(true);
  }, [initializeAccountSelection]);
  const handleAccountDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        initializeAccountSelection();
      } else {
        setSelectedAccountId(null);
      }
      setAccountDialogOpen(open);
    },
    [initializeAccountSelection]
  );
  const activateAccount = useCallback(
    (accountId: string) => {
      const account = accounts.data?.find((item) => item.id === accountId);
      if (!account || account.isActive || setActiveAccount.isPending) {
        setAccountDialogOpen(false);
        setSelectedAccountId(null);
        return;
      }

      setActiveAccount.mutate(accountId, {
        onSuccess: () => {
          toast.success(t("{name} is now active.", { name: account.name }));
          setAccountDialogOpen(false);
          setSelectedAccountId(null);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to set active account.")
      });
    },
    [accounts.data, setActiveAccount, t]
  );
  const cycleAccountSelection = useCallback(() => {
    if (accountList.length === 0) return;

    setSelectedAccountId((currentId) => {
      const currentIndex = accountList.findIndex((account) => account.id === currentId);
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % accountList.length;
      return accountList[nextIndex]?.id ?? null;
    });
  }, [accountList]);
  const sidebarToggleShortcut = formatModShortcut("/");
  const accountSwitchShortcut = formatModShortcut("E");

  useEffect(() => {
    let unbindMenuEvents = () => {};

    void bindHelpMenuEvents({
      onShowShortcuts: () => setShortcutsDialogOpen(true),
      onShowAbout: () => setAboutDialogOpen(true)
    }).then((unbind) => {
      unbindMenuEvents = unbind;
    });

    return () => {
      unbindMenuEvents();
    };
  }, []);

  useEffect(() => {
    void appUpdater.checkAndInstallSilently({
      onInstalled: () => {
        // Fires long after mount, so it reads the locale at fire time instead of
        // closing over the mount-time translator.
        toast.success(translateNow("Update installed. Restart the app to use the new version."));
      }
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSidebarToggleKey(event)) {
        event.preventDefault();
        toggleSidebar();
        return;
      }

      if (isAccountSwitchKey(event)) {
        event.preventDefault();
        if (accountDialogOpen) {
          cycleAccountSelection();
        } else {
          openAccountDialog();
        }
        return;
      }

      if (accountDialogOpen && event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        if (selectedAccountId) {
          activateAccount(selectedAccountId);
        }
        return;
      }

      if (!accountDialogOpen && !shortcutsDialogOpen) {
        if (isPageCyclePreviousKey(event)) {
          event.preventDefault();
          navigateToPage(getAdjacentPageId(activePage, -1));
          return;
        }

        if (isPageCycleNextKey(event)) {
          event.preventDefault();
          navigateToPage(getAdjacentPageId(activePage, 1));
          return;
        }

        const navigationIndex = getPageNavigationIndex(event);
        if (navigationIndex !== null) {
          const pageId = getPageIdByNavigationIndex(navigationIndex);
          if (pageId) {
            event.preventDefault();
            navigateToPage(pageId);
          }
          return;
        }
      }

      if (isTauriRuntime()) return;
      if (!isShortcutsHelpKey(event)) return;

      event.preventDefault();
      setShortcutsDialogOpen(true);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [
    accountDialogOpen,
    activateAccount,
    activePage,
    cycleAccountSelection,
    navigateToPage,
    openAccountDialog,
    selectedAccountId,
    shortcutsDialogOpen,
    toggleSidebar
  ]);

  const activePageContent = useMemo(() => {
    switch (activePage) {
      case "dashboard":
        return <DashboardPage />;
      case "submit":
        return <SubmitJobPage onOpenLogs={openLogsPage} onOpenAiAssistant={openAiAssistantPage} />;
      case "history":
        return (
          <JobHistoryPage
            logTabIntent={logTabIntent}
            onOpenSubmit={openSubmitPage}
            onOpenAiAssistant={openAiAssistantPage}
          />
        );
      case "templates":
        return <TemplatesPage />;
      case "clusters":
        return <VirtualClustersPage />;
      case "s3":
        return <S3BrowserPage />;
      case "glue":
        return (
          <DbHubPage initialTab={dbHubTabIntent} onOpenAiAssistant={openAiAssistantPage} />
        );
      case "ai":
        return <AiAssistantPage />;
      case "secrets":
        return <SecretsPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return <SubmitJobPage onOpenLogs={openLogsPage} onOpenAiAssistant={openAiAssistantPage} />;
    }
  }, [activePage, dbHubTabIntent, logTabIntent, openLogsPage, openSubmitPage, openAiAssistantPage]);

  return (
    // `h-screen overflow-hidden`, not `min-h-screen`: the shell owns the
    // viewport, so the window itself never scrolls. Pages that are taller than
    // the window (Dashboard, Settings, …) scroll inside `main`; pages that pin
    // themselves to the viewport (DBHub, Job History, S3, Submit) fit it exactly.
    // With
    // `min-h-screen` any tall child — the sidebar with the DBHub second level
    // expanded is the usual one — grew the document past 100vh and dragged a
    // window scrollbar in, leaving the pinned pages short of the bottom edge.
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className={cn("flex shrink-0 flex-col overflow-hidden border-r bg-card transition-[width]", sidebarCollapsed ? "w-20" : "w-72")}>
        <div
          className={cn(
            sidebarCollapsed
              ? "flex flex-col items-center gap-2 px-2 py-3"
              : "flex h-20 items-center justify-between gap-3 px-6"
          )}
        >
          <div className={cn("flex min-w-0 items-center gap-3", sidebarCollapsed && "justify-center")}>
            <div
              className={cn(
                "flex shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground",
                sidebarCollapsed ? "size-9" : "size-10"
              )}
            >
              <Cloud className={sidebarCollapsed ? "size-4" : "size-5"} />
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
            className={sidebarCollapsed ? "size-8 shrink-0" : undefined}
            aria-label={sidebarCollapsed ? t("Expand navigation") : t("Collapse navigation")}
            title={
              sidebarCollapsed
                ? `${t("Expand navigation")} (${sidebarToggleShortcut})`
                : `${t("Collapse navigation")} (${sidebarToggleShortcut})`
            }
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose />}
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
            aria-label={t("Switch AWS account")}
            title={`${t("Switch AWS account")} (${accountSwitchShortcut})`}
            onClick={openAccountDialog}
          >
            {sidebarCollapsed ? (
              <Cloud className="size-5 text-muted-foreground" />
            ) : (
              <>
                <div className="text-xs font-medium text-muted-foreground">{t("Current Account")}</div>
                <div className="mt-1 truncate text-sm font-semibold">
                  {activeAccount?.name ?? t("No active account")}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {activeAccount?.region ?? t("Configure Settings first")}
                </div>
              </>
            )}
          </button>
        </div>
        {/* The nav is the sidebar's one growing region, so it scrolls inside the
            sidebar instead of stretching the shell: with 11 pages plus a DBHub
            second level the list is taller than a laptop window. */}
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3" aria-label={t("Primary")}>
          {scrollingNavItems.map((item) => (
            <div key={item.id}>
              {renderNavButton({
                item,
                activePage,
                setActivePage: navigateToPage,
                sidebarCollapsed,
                t
              })}
              {/* Second level: the DBHub data sources, directly under the
                  sidebar entry (Glue Catalog + pinned connections). */}
              {item.id === "glue" && activePage === "glue" ? (
                <DbHubSubNav
                  activeSubTab={dbHubTabIntent ?? OVERVIEW_TAB}
                  onSelect={openDbHubTab}
                  collapsed={sidebarCollapsed}
                />
              ) : null}
            </div>
          ))}
        </nav>
        {/* Pinned below the scrolling list, so the entry stays put no matter how
            many pages (or DBHub connections) the nav above grows to hold. */}
        <div className={cn("shrink-0 border-t py-3", sidebarCollapsed ? "px-2" : "px-3")}>
          {bottomNavItems.map((item) =>
            renderNavButton({
              item,
              activePage,
              setActivePage: navigateToPage,
              sidebarCollapsed,
              t
            })
          )}
          {/* Which build is on screen matters most when it is not a stable one,
              so the channel is named whenever it differs. The title carries it
              either way. */}
          {!sidebarCollapsed ? (
            <p
              className="px-3 pt-2 text-[11px] leading-4 text-muted-foreground"
              title={`${t("Version:")} ${releaseInfo.version} · ${t(releaseInfo.channelLabel)}`}
              data-testid="sidebar-version"
            >
              {t("Version:")} {releaseInfo.version}
              {releaseInfo.channelLabel === "Stable" ? null : ` · ${t(releaseInfo.channelLabel)}`}
            </p>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* `overflow-y-auto` rather than `hidden`: the window no longer scrolls,
            so the content area has to be the scroll container for the
            document-style pages. Pinned pages are exactly this box's height, so
            they never trigger it. */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
          <Suspense fallback={<PageLoader />}>
            <div className="flex min-h-0 flex-1 flex-col">{activePageContent}</div>
          </Suspense>
        </main>
      </div>
      <Dialog open={accountDialogOpen} onOpenChange={handleAccountDialogOpenChange}>
        {/* grid-cols-1 → minmax(0,1fr): stop the dialog's auto column from growing wider than max-w-lg when an
            account's long name/ARN sets a large intrinsic (min-content) width, which pushed each option past the frame */}
        <DialogContent className="grid-cols-1">
          <DialogHeader>
            <DialogTitle>{t("Switch AWS Account")}</DialogTitle>
            <DialogDescription>
              {t("Choose the active AWS account used by EMR, CloudWatch, and S3.")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-3" role="listbox" aria-label={t("AWS accounts")}>
            {accounts.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("Loading accounts...")}</p>
            ) : null}
            {/* Kept in English: error and failure text is out of the localization scope. */}
            {accounts.error ? <p className="text-sm text-destructive">Failed to load AWS accounts.</p> : null}
            {accounts.data?.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {t("No AWS accounts are configured yet. Open Settings to add one.")}
              </p>
            ) : null}
            {accounts.data?.map((account) => {
              const selected = account.id === selectedAccountId;
              return (
                <div
                  key={account.id}
                  role="option"
                  aria-selected={selected}
                  aria-label={account.name}
                  tabIndex={-1}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 transition-colors",
                    selected ? "border-primary bg-accent" : "hover:bg-secondary/40"
                  )}
                  onClick={() => setSelectedAccountId(account.id)}
                  onDoubleClick={() => activateAccount(account.id)}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate font-medium">{account.name}</p>
                      {account.isActive ? <Badge>{t("Active")}</Badge> : null}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {account.region} · {account.accessKeyIdMasked}
                      {account.identity ? ` · ${account.identity.account}` : ""}
                    </p>
                    {account.identity ? <p className="truncate text-xs text-muted-foreground">{account.identity.arn}</p> : null}
                  </div>
                  <Button
                    type="button"
                    variant={account.isActive ? "secondary" : "outline"}
                    disabled={account.isActive || setActiveAccount.isPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      activateAccount(account.id);
                    }}
                  >
                    <CheckCircle2 data-icon="inline-start" />
                    {account.isActive ? t("Active") : t("Use")}
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
      <ShortcutsDialog open={shortcutsDialogOpen} onOpenChange={setShortcutsDialogOpen} />
      <AboutDialog open={aboutDialogOpen} onOpenChange={setAboutDialogOpen} />
    </div>
  );
}

type NavItem = (typeof navigationItems)[number];

/** `navigationItems` split by where the sidebar puts them: the list that
 *  scrolls, and the foot that stays put. The order within each half is the
 *  order of the source list. */
const scrollingNavItems = navigationItems.filter((item) => !isBottomNavItem(item.id));
const bottomNavItems = navigationItems.filter((item) => isBottomNavItem(item.id));

function renderNavButton({
  item,
  activePage,
  setActivePage,
  sidebarCollapsed,
  t,
  compact = false
}: {
  item: NavItem;
  activePage: PageId;
  setActivePage: (page: PageId) => void;
  sidebarCollapsed: boolean;
  /** Threaded in because this helper is not a component and cannot call hooks. */
  t: Translator;
  compact?: boolean;
}) {
  const Icon = item.icon;
  const active = item.id === activePage;
  const navigationIndex = getNavigationIndex(item.id);
  const navigationShortcut = navigationIndex ? formatModShortcut(String(navigationIndex)) : undefined;

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
      aria-label={t(item.label)}
      title={navigationShortcut ? `${t(item.label)} (${navigationShortcut})` : t(item.label)}
    >
      <Icon className="size-4 shrink-0" />
      {!sidebarCollapsed ? (
        <span className="flex flex-col">
          <span className="font-medium">{t(item.label)}</span>
          <span className={cn("text-xs", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
            {t(item.description)}
          </span>
        </span>
      ) : null}
    </button>
  );
}
