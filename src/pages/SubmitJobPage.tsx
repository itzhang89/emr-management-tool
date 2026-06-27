import { Eye, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { JobRunsPanel } from "@/components/emr/JobRunsPanel";
import { TemplateVariableFields } from "@/components/templates/TemplateVariableFields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useEffectiveVirtualClusterId, VirtualClusterSelect } from "@/components/emr/VirtualClusterSelect";
import { PageHeader } from "@/components/layout/PageHeader";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useStartJobRun } from "@/hooks/useEmr";
import {
  useJobConfigTemplates,
  useSubmitUser
} from "@/hooks/useJobConfigTemplates";
import { useTemplates } from "@/hooks/useTemplates";
import { getShortcutPrimaryKey, SHORTCUT_IDS } from "@/data/keyboardShortcuts";
import { applyResourceOverride } from "@/services/resourceOverride";
import {
  getDefaultCustomVariableValues,
  resolveTemplatePayload,
  toStartJobRunRequest,
  validateSubmitPayload
} from "@/services/templateEngine";
import {
  readSubmitJobFormCache,
  readSubmitJobLastTemplate,
  writeSubmitJobFormCache,
  writeSubmitJobLastTemplate
} from "@/services/submitJobFormStorage";
import { useSessionStore } from "@/stores/sessionStore";
import type { JobConfigTemplate, ResolvedJobPayload, SparkResourceConfig, StartJobRunRequest } from "@/types/domain";

const RECENT_JOB_LIMIT = 20;
const SUBMIT_SHORTCUT = getShortcutPrimaryKey(SHORTCUT_IDS.SUBMIT_JOB);
const PREVIEW_JSON_SHORTCUT = getShortcutPrimaryKey(SHORTCUT_IDS.SUBMIT_PREVIEW_JSON);

export function SubmitJobPage({ onOpenLogs }: { onOpenLogs?: () => void }) {
  const setSelectedVirtualClusterId = useSessionStore((state) => state.setSelectedVirtualClusterId);
  const clonedJobRequest = useSessionStore((state) => state.clonedJobRequest);
  const setClonedJobRequest = useSessionStore((state) => state.setClonedJobRequest);
  const virtualClusterId = useEffectiveVirtualClusterId();
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const startJobRun = useStartJobRun();
  const jobConfigTemplates = useJobConfigTemplates();
  const resourceTemplates = useTemplates();
  const submitUserQuery = useSubmitUser();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [resourceTemplateId, setResourceTemplateId] = useState("tiny");
  const [customVariables, setCustomVariables] = useState<Record<string, string | number | boolean | string[]>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cloneRequest, setCloneRequest] = useState<StartJobRunRequest>();
  const previewOpenRef = useRef(previewOpen);
  previewOpenRef.current = previewOpen;

  const templates = jobConfigTemplates.data ?? [];
  const resources = resourceTemplates.data?.resourceTemplates ?? [];
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0];
  const selectedResources =
    resources.find((template) => template.id === resourceTemplateId)?.resources ??
    resources.find((template) => template.id === "tiny")?.resources ??
    defaultResources();

  useEffect(() => {
    if (selectedTemplateId || templates.length === 0) return;
    const lastTemplateId = accountId ? readSubmitJobLastTemplate(accountId) : undefined;
    if (lastTemplateId && templates.some((template) => template.id === lastTemplateId)) {
      setSelectedTemplateId(lastTemplateId);
      return;
    }
    setSelectedTemplateId(templates[0].id);
  }, [accountId, selectedTemplateId, templates]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const defaults = getDefaultCustomVariableValues(selectedTemplate);
    const cached = accountId ? readSubmitJobFormCache(accountId, selectedTemplate.id) : undefined;
    setCustomVariables(cached?.customVariables ? { ...defaults, ...cached.customVariables } : defaults);
    setResourceTemplateId(
      cached?.resourceTemplateId ?? selectedTemplate.defaultResourceTemplateId ?? "tiny"
    );
  }, [accountId, selectedTemplate?.id]);

  useEffect(() => {
    if (!accountId || !selectedTemplateId || cloneRequest) return;
    writeSubmitJobFormCache(accountId, selectedTemplateId, {
      resourceTemplateId,
      customVariables
    });
    writeSubmitJobLastTemplate(accountId, selectedTemplateId);
  }, [accountId, cloneRequest, customVariables, resourceTemplateId, selectedTemplateId]);

  useEffect(() => {
    if (!clonedJobRequest) return;
    setCloneRequest({
      ...clonedJobRequest,
      name: `${clonedJobRequest.name}-copy`
    });
    setSelectedVirtualClusterId(clonedJobRequest.virtualClusterId);
    setClonedJobRequest(undefined);
    toast.success("Cloned job configuration loaded.");
  }, [clonedJobRequest, setClonedJobRequest, setSelectedVirtualClusterId]);

  const resolvedPayload = useMemo(() => {
    if (cloneRequest || !selectedTemplate || !virtualClusterId) return undefined;
    try {
      return resolveTemplatePayload(selectedTemplate, {
        templateName: selectedTemplate.name,
        virtualClusterId,
        submitUser: submitUserQuery.data ?? "user",
        customVariables
      });
    } catch {
      return undefined;
    }
  }, [cloneRequest, customVariables, selectedTemplate, submitUserQuery.data, virtualClusterId]);

  const previewPayload = useMemo(() => {
    if (cloneRequest) return cloneRequest;
    if (!resolvedPayload) return undefined;
    return applyResourceOverride(resolvedPayload, selectedResources);
  }, [cloneRequest, resolvedPayload, selectedResources]);

  const submit = useCallback(async () => {
    try {
      const request = buildSubmitRequest({
        cloneRequest,
        selectedTemplate,
        resolvedPayload,
        selectedResources,
        customVariables
      });
      if (!request) {
        toast.error("Complete the template selections before submitting.");
        return;
      }
      const job = await startJobRun.mutateAsync(request);
      toast.success(`Submitted ${job.name}`);
      setCloneRequest(undefined);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to submit job."));
    }
  }, [cloneRequest, customVariables, resolvedPayload, selectedResources, selectedTemplate, startJobRun]);

  const validateAndSubmit = useCallback(() => {
    if (cloneRequest) {
      void submit();
      return;
    }
    if (!selectedTemplate || !resolvedPayload) {
      toast.error("Select a job config template and virtual cluster.");
      return;
    }
    const validation = validateSubmitPayload(
      applyResourceOverride(resolvedPayload, selectedResources),
      selectedTemplate.customVariables,
      customVariables
    );
    if (!validation.ok) {
      toast.error(validation.errors[0] ?? "Submit payload validation failed.");
      if (validation.errors.length > 1) {
        validation.errors.slice(1).forEach((error) => toast.error(error));
      }
      return;
    }
    void submit();
  }, [cloneRequest, customVariables, resolvedPayload, selectedResources, selectedTemplate, submit]);

  const openPreview = useCallback(() => {
    if (!previewPayload) return;
    setPreviewOpen(true);
  }, [previewPayload]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (previewOpenRef.current) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.shiftKey && (event.key === "P" || event.key === "p")) {
        event.preventDefault();
        openPreview();
        return;
      }

      if (!event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        validateAndSubmit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openPreview, validateAndSubmit]);

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col gap-4 overflow-hidden">
      <PageHeader
        pageId="submit"
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="outline" disabled={!previewPayload} onClick={openPreview}>
                  <Eye data-icon="inline-start" />
                  Preview JSON
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preview JSON · {PREVIEW_JSON_SHORTCUT}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" disabled={startJobRun.isPending} onClick={validateAndSubmit}>
                  <Send data-icon="inline-start" />
                  {startJobRun.isPending ? "Submitting..." : "Submit"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Submit job · {SUBMIT_SHORTCUT}</TooltipContent>
            </Tooltip>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        {cloneRequest ? (
          <Card className="shrink-0">
            <CardHeader>
              <CardTitle>Cloned Job Configuration</CardTitle>
              <CardDescription>
                Submitting a cloned request from Job History. Clear it by choosing a template again.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => setCloneRequest(undefined)}>
                Use Template Instead
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid max-h-[min(48vh,520px)] shrink-0 grid-cols-[1fr_320px] gap-4 overflow-hidden">
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="shrink-0">
              <CardTitle>Job Config Template</CardTitle>
              <CardDescription>Select the application JSON template and fill custom variables.</CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-4 overflow-auto">
              <Field label="Template">
                <Select
                  value={selectedTemplateId}
                  onValueChange={(value) => {
                    setCloneRequest(undefined);
                    setSelectedTemplateId(value);
                  }}
                  disabled={Boolean(cloneRequest)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {selectedTemplate ? (
                <TemplateVariableFields
                  variables={selectedTemplate.customVariables ?? []}
                  values={customVariables}
                  onChange={setCustomVariables}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="shrink-0">
              <CardTitle>Runtime Selection</CardTitle>
              <CardDescription>Choose where the job runs and which resource preset to apply.</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
              <Field label="Virtual Cluster">
                <VirtualClusterSelect className="w-full" />
              </Field>
              <Field label="Resource Template">
                <Select value={resourceTemplateId} onValueChange={setResourceTemplateId} disabled={Boolean(cloneRequest)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select resources" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {resources.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                Driver {selectedResources.driverCores}c / {selectedResources.driverMemory}
                <br />
                Executors {selectedResources.executorInstances} x {selectedResources.executorCores}c /{" "}
                {selectedResources.executorMemory}
              </div>
            </CardContent>
          </Card>
        </div>

        <JobRunsPanel
          virtualClusterId={virtualClusterId}
          maxItems={RECENT_JOB_LIMIT}
          title="Recent Submissions"
          showAutoRefreshControl
          submittedOnly
          onOpenLogs={onOpenLogs}
          className="min-h-0 flex-1"
        />
      </div>

      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} payload={previewPayload} />
    </div>
  );
}

function PreviewDialog({
  open,
  onOpenChange,
  payload
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload?: ResolvedJobPayload | StartJobRunRequest;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resolved Submit Payload</DialogTitle>
        </DialogHeader>
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(payload ?? {}, null, 2)}</pre>
      </DialogContent>
    </Dialog>
  );
}

function buildSubmitRequest({
  cloneRequest,
  selectedTemplate,
  resolvedPayload,
  selectedResources,
  customVariables
}: {
  cloneRequest?: StartJobRunRequest;
  selectedTemplate?: JobConfigTemplate;
  resolvedPayload?: ResolvedJobPayload;
  selectedResources: SparkResourceConfig;
  customVariables: Record<string, string | number | boolean | string[]>;
}) {
  if (cloneRequest) {
    return cloneRequest;
  }
  if (!selectedTemplate || !resolvedPayload) {
    return undefined;
  }
  const validation = validateSubmitPayload(
    applyResourceOverride(resolvedPayload, selectedResources),
    selectedTemplate.customVariables,
    customVariables
  );
  if (!validation.ok) {
    return undefined;
  }
  return toStartJobRunRequest(resolvedPayload, selectedResources);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function defaultResources(): SparkResourceConfig {
  return { driverCores: 1, driverMemory: "1G", executorCores: 1, executorMemory: "1G", executorInstances: 1 };
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}
