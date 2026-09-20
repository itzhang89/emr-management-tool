import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { tauriClient } from "@/services/tauriClient";
import type { RemediationRunbook, RemediationRunbookInput } from "@/types/domain";
import { useMemo, useState } from "react";

function toInput(runbook: RemediationRunbook): RemediationRunbookInput {
  const advice = runbook.actions.find((action) => action.type === "advise");
  const message =
    advice && advice.type === "advise"
      ? advice.message
      : "Review the failure and decide next steps.";
  const hasRerun = runbook.actions.some((action) => action.type === "rerunEmrJob");
  return {
    name: runbook.name,
    enabled: runbook.enabled,
    approved: runbook.approved,
    priority: runbook.priority,
    matchRules: runbook.matchRules,
    actions: [
      { type: "advise", message },
      ...(hasRerun ? ([{ type: "rerunEmrJob" }] as const) : [])
    ]
  };
}

/**
 * Master–detail editor for remediation runbooks. Approved runbooks with a
 * rerun action may auto-submit EMR jobs via propose_rerun_job.
 */
export function RunbooksPanel() {
  const t = useT();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["remediation-runbooks"],
    queryFn: () => tauriClient.listRemediationRunbooks()
  });
  const runbooks = list.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => runbooks.find((runbook) => runbook.id === selectedId) ?? runbooks[0] ?? null,
    [runbooks, selectedId]
  );

  const save = useMutation({
    mutationFn: async (runbook: RemediationRunbook) =>
      tauriClient.updateRemediationRunbook(runbook.id, toInput(runbook)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["remediation-runbooks"] });
      toast.success(t("Runbook saved"));
    },
    onError: (error: Error) => toast.error(error.message || "Failed to save runbook")
  });

  const create = useMutation({
    mutationFn: () =>
      tauriClient.createRemediationRunbook({
        name: "New runbook",
        enabled: true,
        approved: false,
        priority: 100,
        matchRules: { currentStatusPrefix: "failed" },
        actions: [{ type: "advise", message: "Describe the remediation steps here." }]
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["remediation-runbooks"] });
      setSelectedId(created.id);
      toast.success(t("Runbook created"));
    },
    onError: (error: Error) => toast.error(error.message || "Failed to create runbook")
  });

  const remove = useMutation({
    mutationFn: (id: string) => tauriClient.deleteRemediationRunbook(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["remediation-runbooks"] });
      setSelectedId(null);
      toast.success(t("Runbook deleted"));
    },
    onError: (error: Error) => toast.error(error.message || "Failed to delete runbook")
  });

  if (list.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Loading runbooks…")}</p>;
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_1fr]">
      <Card className="min-h-0 overflow-hidden">
        <CardHeader className="space-y-2 py-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">{t("Runbooks")}</CardTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus className="size-3.5" />
              {t("Add")}
            </Button>
          </div>
          <CardDescription>{t("Match advice and optional EMR auto-rerun.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 overflow-y-auto p-2">
          {runbooks.map((runbook) => (
            <button
              key={runbook.id}
              type="button"
              className={`flex w-full flex-col rounded-md px-2 py-2 text-left text-sm hover:bg-muted ${
                selected?.id === runbook.id ? "bg-muted" : ""
              }`}
              onClick={() => setSelectedId(runbook.id)}
            >
              <span className="font-medium">{runbook.name}</span>
              <span className="flex gap-1 pt-1">
                {runbook.approved ? (
                  <Badge>{t("approved")}</Badge>
                ) : (
                  <Badge variant="outline">{t("draft")}</Badge>
                )}
                {!runbook.enabled ? <Badge variant="secondary">{t("off")}</Badge> : null}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      {selected ? (
        <RunbookEditor
          key={selected.id}
          runbook={selected}
          saving={save.isPending}
          deleting={remove.isPending}
          onSave={(next) => save.mutate(next)}
          onDelete={() => {
            if (window.confirm(t("Delete runbook “{name}”?", { name: selected.name }))) {
              remove.mutate(selected.id);
            }
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("No runbooks yet. Add one to get started.")}
        </p>
      )}
    </div>
  );
}

function RunbookEditor({
  runbook,
  saving,
  deleting,
  onSave,
  onDelete
}: {
  runbook: RemediationRunbook;
  saving: boolean;
  deleting: boolean;
  onSave: (runbook: RemediationRunbook) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(runbook);
  const advice =
    draft.actions.find((action) => action.type === "advise")?.message ??
    (draft.actions[0] && draft.actions[0].type === "advise" ? draft.actions[0].message : "");
  const hasRerun = draft.actions.some((action) => action.type === "rerunEmrJob");

  return (
    <Card className="min-h-0 overflow-y-auto">
      <CardHeader>
        <CardTitle className="text-base">{draft.name}</CardTitle>
        <CardDescription>
          {t("Approved + rerun action → Chat may call propose_rerun_job automatically. compare_source_yellowbrick is reserved and not executed yet.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t("Name")}</Label>
          <Input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.enabled}
              onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked === true })}
            />
            {t("Enabled")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.approved}
              onCheckedChange={(checked) => setDraft({ ...draft, approved: checked === true })}
            />
            {t("Approved (allows auto-rerun)")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={hasRerun}
              onCheckedChange={(checked) => {
                const message = advice || "Review the failure.";
                setDraft({
                  ...draft,
                  actions:
                    checked === true
                      ? [{ type: "advise", message }, { type: "rerunEmrJob" }]
                      : [{ type: "advise", message }]
                });
              }}
            />
            {t("Include EMR rerun action")}
          </label>
        </div>
        <div className="space-y-2">
          <Label>{t("Match: current status starts with")}</Label>
          <Input
            value={draft.matchRules.currentStatusPrefix ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                matchRules: {
                  ...draft.matchRules,
                  currentStatusPrefix: event.target.value || null
                }
              })
            }
            placeholder="consecutive failures"
          />
        </div>
        <div className="space-y-2">
          <Label>{t("Match: error contains")}</Label>
          <Input
            value={draft.matchRules.errorContains ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                matchRules: {
                  ...draft.matchRules,
                  errorContains: event.target.value || null
                }
              })
            }
            placeholder="OutOfMemory"
          />
        </div>
        <div className="space-y-2">
          <Label>{t("Match: job name regex")}</Label>
          <Input
            value={draft.matchRules.jobNameRegex ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                matchRules: { ...draft.matchRules, jobNameRegex: event.target.value || null }
              })
            }
            placeholder="_streaming$"
          />
        </div>
        <div className="space-y-2">
          <Label>{t("Match: project name (exact)")}</Label>
          <Input
            value={draft.matchRules.projectName ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                matchRules: { ...draft.matchRules, projectName: event.target.value || null }
              })
            }
            placeholder="bigdata_etl"
          />
        </div>
        <div className="space-y-2">
          <Label>{t("Advice")}</Label>
          <Textarea
            className="min-h-28"
            value={advice}
            onChange={(event) => {
              const message = event.target.value;
              setDraft({
                ...draft,
                actions: hasRerun
                  ? [{ type: "advise", message }, { type: "rerunEmrJob" }]
                  : [{ type: "advise", message }]
              });
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={saving} onClick={() => onSave(draft)}>
            {t("Save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={deleting}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
            {t("Delete")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
