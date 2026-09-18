import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { tauriClient } from "@/services/tauriClient";
import type { RemediationRunbook } from "@/types/domain";
import { useMemo, useState } from "react";

/**
 * Master–detail editor for remediation runbooks. Approved runbooks with a
 * rerun action may auto-submit EMR jobs via propose_rerun_job.
 */
export function RunbooksPanel() {
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
    mutationFn: async (runbook: RemediationRunbook) => {
      const advice = runbook.actions.find((action) => action.type === "advise");
      const message =
        advice && advice.type === "advise"
          ? advice.message
          : "Review the failure and decide next steps.";
      const hasRerun = runbook.actions.some((action) => action.type === "rerunEmrJob");
      const request = {
        name: runbook.name,
        enabled: runbook.enabled,
        approved: runbook.approved,
        priority: runbook.priority,
        matchRules: runbook.matchRules,
        actions: [
          { type: "advise" as const, message },
          ...(hasRerun ? [{ type: "rerunEmrJob" as const }] : [])
        ]
      };
      return tauriClient.updateRemediationRunbook(runbook.id, request);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["remediation-runbooks"] });
      toast.success("Runbook saved");
    },
    onError: (error: Error) => toast.error(error.message || "Failed to save runbook")
  });

  if (list.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading runbooks…</p>;
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_1fr]">
      <Card className="min-h-0 overflow-hidden">
        <CardHeader className="py-3">
          <CardTitle className="text-base">Runbooks</CardTitle>
          <CardDescription>Match advice and optional EMR auto-rerun.</CardDescription>
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
                {runbook.approved ? <Badge>approved</Badge> : <Badge variant="outline">draft</Badge>}
                {!runbook.enabled ? <Badge variant="secondary">off</Badge> : null}
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
          onSave={(next) => save.mutate(next)}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No runbooks yet.</p>
      )}
    </div>
  );
}

function RunbookEditor({
  runbook,
  saving,
  onSave
}: {
  runbook: RemediationRunbook;
  saving: boolean;
  onSave: (runbook: RemediationRunbook) => void;
}) {
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
          Approved + rerun action → Chat may call propose_rerun_job automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Name</Label>
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
            Enabled
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.approved}
              onCheckedChange={(checked) => setDraft({ ...draft, approved: checked === true })}
            />
            Approved (allows auto-rerun)
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
            Include EMR rerun action
          </label>
        </div>
        <div className="space-y-2">
          <Label>Match: current status starts with</Label>
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
          <Label>Match: job name regex</Label>
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
          <Label>Advice</Label>
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
        <Button type="button" disabled={saving} onClick={() => onSave(draft)}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
