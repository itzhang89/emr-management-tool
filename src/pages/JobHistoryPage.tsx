import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { JobHistoryTab } from "@/components/emr/JobHistoryTab";
import { useEffectiveVirtualClusterId } from "@/components/emr/VirtualClusterSelect";
import { JobTabStrip, type JobTabStripItem } from "@/components/history/JobTabStrip";
import { PersistMount } from "@/components/layout/PersistMount";
import { LogsTab } from "@/components/logs/LogsTab";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { HISTORY_TAB_ID, useJobLogTabs, type TabSnapshot } from "@/hooks/useJobLogTabs";
import { useT } from "@/i18n";
import { stripJobNameTimestamp } from "@/services/jobRunDisplay";
import { isCloseTabKey, isTabCycleNextKey, isTabCyclePreviousKey } from "@/lib/keyboardShortcut";
import type { JobRunSummary } from "@/types/domain";

/**
 * Job History and Logs, now one page.
 *
 * The job list is the first tab and never closes; every job whose logs the user
 * opens gets a tab of its own, and `+` opens a draft for a job the list does
 * not show. Logs used to be a separate sidebar page, which meant losing the
 * tree selection, the source switch and the find bar every time the user went
 * back for the next job — and losing everything when they navigated away.
 *
 * Each log tab mounts lazily and then stays mounted, so switching between two
 * jobs' logs keeps both exactly as they were (see `PersistMount`). The tab list
 * *and* the log text are cached per AWS account locally, so a restart comes
 * back to the same tabs; closing a tab is what releases its cache.
 */

/** A cross-page "open this job's logs" request, carrying a one-shot nonce. */
export interface LogTabIntent {
  jobId: string;
  virtualClusterId?: string;
  /** Bumped per request: the tab list may have changed since the last one, and
   *  a value that has already been handled must not reopen a closed tab. */
  nonce: number;
}

export function JobHistoryPage({
  logTabIntent,
  onOpenSubmit,
  onOpenAiAssistant
}: {
  logTabIntent?: LogTabIntent;
  onOpenSubmit?: () => void;
  onOpenAiAssistant?: () => void;
}) {
  const t = useT();
  const effectiveVirtualClusterId = useEffectiveVirtualClusterId();
  const {
    tabs,
    activeTabId,
    accountId,
    maxJobTabs,
    jobTabCount,
    selectTab,
    openJobTab,
    openDraftTab,
    promoteDraftTab,
    closeTab,
    reportSnapshot
  } = useJobLogTabs();
  const [handledNonce, setHandledNonce] = useState<LogTabIntent["nonce"]>();
  // Bumped when a shortcut moved the tab, so the strip can carry the focus ring
  // across with it (Radix only does that for its own arrow keys).
  const [stripFocusRequest, setStripFocusRequest] = useState(0);

  const refuseAtCapacity = useCallback(() => {
    toast.error(
      t("Close a log tab first — {used} of {max} are open.", { used: jobTabCount, max: maxJobTabs })
    );
  }, [jobTabCount, maxJobTabs, t]);

  const openLogsForJob = useCallback(
    (job: JobRunSummary) => {
      if (openJobTab(job.id, job.virtualClusterId, job.name) === "at-capacity") {
        refuseAtCapacity();
      }
    },
    [openJobTab, refuseAtCapacity]
  );

  /** ⌘⇧[ / ⌘⇧] walk the strip and wrap, the way the page cycle does. */
  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      const index = tabs.findIndex((tab) => tab.id === activeTabId);
      if (index === -1 || tabs.length < 2) return;
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      if (!next) return;
      selectTab(next.id);
      setStripFocusRequest((request) => request + 1);
    },
    [activeTabId, selectTab, tabs]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTabCyclePreviousKey(event)) {
        event.preventDefault();
        cycleTab(-1);
        return;
      }
      if (isTabCycleNextKey(event)) {
        event.preventDefault();
        cycleTab(1);
        return;
      }
      if (isCloseTabKey(event)) {
        // The fixed Job History tab ignores the close, but the key is still
        // ours: letting it through would close the window instead.
        event.preventDefault();
        closeTab(activeTabId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, closeTab, cycleTab]);

  const openDraft = useCallback(() => {
    if (openDraftTab() === "at-capacity") {
      refuseAtCapacity();
    }
  }, [openDraftTab, refuseAtCapacity]);

  // A tab's snapshot handler has to keep its identity between renders: the tab
  // reports from an effect, and a fresh function each render would re-run it.
  const snapshotHandlers = useMemo(() => {
    const handlers = new Map<string, (snapshot: TabSnapshot) => void>();
    for (const tab of tabs) {
      handlers.set(tab.id, (snapshot: TabSnapshot) => reportSnapshot(tab.id, snapshot));
    }
    return handlers;
  }, [reportSnapshot, tabs]);

  useEffect(() => {
    if (!logTabIntent || logTabIntent.nonce === handledNonce) return;
    const virtualClusterId = logTabIntent.virtualClusterId ?? effectiveVirtualClusterId;
    if (!virtualClusterId) return;
    setHandledNonce(logTabIntent.nonce);
    if (openJobTab(logTabIntent.jobId, virtualClusterId) === "at-capacity") {
      refuseAtCapacity();
    }
  }, [effectiveVirtualClusterId, handledNonce, logTabIntent, openJobTab, refuseAtCapacity]);

  const stripTabs: JobTabStripItem[] = [
    { id: HISTORY_TAB_ID, title: t("Job History"), closable: false },
    ...tabs
      .filter((tab) => tab.kind !== "history")
      .map((tab) => {
        const fullName = tab.jobName ?? tab.jobId ?? tab.id;
        return {
          id: tab.id,
          // The submission timestamp every run carries is noise in a strip:
          // it is what pushes the distinguishing part out of view. The tooltip
          // keeps the whole name.
          title: tab.kind === "draft" ? t("New log tab") : stripJobNameTimestamp(fullName),
          tooltip: fullName,
          closable: true
        };
      })
  ];

  const openTabs = tabs.filter((tab) => tab.kind !== "history");
  const historyActive = activeTabId === HISTORY_TAB_ID;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
      <Tabs
        value={activeTabId}
        onValueChange={selectTab}
        // Manual activation: arrowing across the strip must not mount a tab,
        // because mounting one describes the job and fetches its logs.
        activationMode="manual"
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
      >
        <JobTabStrip
          tabs={stripTabs}
          activeTabId={activeTabId}
          onSelect={selectTab}
          onClose={closeTab}
          onNewTab={openDraft}
          focusRequestId={stripFocusRequest}
        />

        <TabsContent
          value={HISTORY_TAB_ID}
          forceMount
          className="mt-0 hidden min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex"
        >
          <PersistMount visible={historyActive} className="flex min-h-0 w-full flex-col overflow-y-auto">
            <JobHistoryTab
              active={historyActive}
              onOpenLogs={openLogsForJob}
              onOpenSubmit={onOpenSubmit}
              onOpenAiAssistant={onOpenAiAssistant}
            />
          </PersistMount>
        </TabsContent>

        {openTabs.map((tab) => {
          const tabActive = activeTabId === tab.id;
          return (
            <TabsContent
              // The account is part of the key: two accounts can hold a tab with
              // the same `cluster:job` id, and React would otherwise keep the
              // first account's mounted viewer, its selection and its text.
              key={`${accountId ?? "pending"}:${tab.id}`}
              value={tab.id}
              forceMount
              className="mt-0 hidden min-h-0 min-w-0 flex-1 overflow-hidden data-[state=active]:flex"
            >
              <PersistMount visible={tabActive} className="flex min-h-0 w-full flex-col">
                <LogsTab
                  active={tabActive}
                  jobId={tab.jobId}
                  virtualClusterId={tab.virtualClusterId}
                  restored={{
                    activeSource: tab.activeSource,
                    s3SelectedKey: tab.s3SelectedKey,
                    cloudWatchSelectedStream: tab.cloudWatchSelectedStream
                  }}
                  cachedContent={tab.content}
                  onSnapshot={snapshotHandlers.get(tab.id)}
                  onOpenJob={(jobId, virtualClusterId) => {
                    if (tab.kind === "draft") {
                      if (promoteDraftTab(tab.id, jobId, virtualClusterId) === "at-capacity") {
                        refuseAtCapacity();
                      }
                      return;
                    }
                    if (openJobTab(jobId, virtualClusterId) === "at-capacity") {
                      refuseAtCapacity();
                    }
                  }}
                />
              </PersistMount>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
