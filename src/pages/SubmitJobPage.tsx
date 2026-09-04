import { Eye, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { toast } from "sonner";
import { JobRunsPanel } from "@/components/emr/JobRunsPanel";
import { JsonTemplateEditor } from "@/components/templates/JsonTemplateEditor";
import { TemplateVariableFields } from "@/components/templates/TemplateVariableFields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useEffectiveVirtualClusterId, VirtualClusterSelect } from "@/components/emr/VirtualClusterSelect";
import { PageHeader } from "@/components/layout/PageHeader";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useStartJobRun } from "@/hooks/useEmr";
import { useSubmitJobSubmissionHistory } from "@/hooks/useSubmitJobAutoRefresh";
import {
  useCreateJobConfigTemplate,
  useJobConfigTemplates,
  useSubmitUser
} from "@/hooks/useJobConfigTemplates";
import { useTemplates } from "@/hooks/useTemplates";
import { getShortcutPrimaryKey, SHORTCUT_IDS } from "@/data/keyboardShortcuts";
import { applyResourceOverride } from "@/services/resourceOverride";
import {
  applyRuntimeToSourcePayload,
  formatSourceJobPayload,
  parseSourceJobPayload
} from "@/services/startJobPayload";
import { parameterizeSourcePayloadForTemplate } from "@/services/parameterizeEntryPointArguments";
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

const SUBMIT_SHORTCUT = getShortcutPrimaryKey(SHORTCUT_IDS.SUBMIT_JOB);
const PREVIEW_JSON_SHORTCUT = getShortcutPrimaryKey(SHORTCUT_IDS.SUBMIT_PREVIEW_JSON);
const TOGGLE_MODE_SHORTCUT = getShortcutPrimaryKey(SHORTCUT_IDS.SUBMIT_TOGGLE_MODE);
const FORM_PANE_MIN_PX = 220;
const HISTORY_PANE_MIN_PX = 140;
const SPLITTER_PX = 8;

export function SubmitJobPage({
  onOpenLogs,
  onOpenAiAssistant
}: {
  onOpenLogs?: () => void;
  /** When provided, FAILED rows in Recent Submissions gain the same "Analyze"
      action as Job History, opening the AI assistant for failure analysis. */
  onOpenAiAssistant?: () => void;
}) {
  const setSelectedVirtualClusterId = useSessionStore((state) => state.setSelectedVirtualClusterId);
  const clonedJobRequest = useSessionStore((state) => state.clonedJobRequest);
  const setClonedJobRequest = useSessionStore((state) => state.setClonedJobRequest);
  const pendingSourceSubmit = useSessionStore((state) => state.pendingSourceSubmit);
  const setPendingSourceSubmit = useSessionStore((state) => state.setPendingSourceSubmit);
  const virtualClusterId = useEffectiveVirtualClusterId();
  const activeAccount = useActiveAwsAccount();
  const accountId = activeAccount.data?.id;
  const startJobRun = useStartJobRun();
  const {
    autoRefresh: submissionAutoRefresh,
    setAutoRefresh: setSubmissionAutoRefresh,
    enableAfterSubmit,
    refreshCountdown: submissionRefreshCountdown,
    submissionJobs
  } = useSubmitJobSubmissionHistory(virtualClusterId);
  const jobConfigTemplates = useJobConfigTemplates();
  const createTemplate = useCreateJobConfigTemplate();
  const resourceTemplates = useTemplates();
  const submitUserQuery = useSubmitUser();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [resourceTemplateId, setResourceTemplateId] = useState("tiny");
  const [customVariables, setCustomVariables] = useState<Record<string, string | number | boolean | string[]>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cloneRequest, setCloneRequest] = useState<StartJobRunRequest>();
  const [mode, setMode] = useState<"template" | "source">("template");
  const [sourceJson, setSourceJson] = useState("{}");
  const [sourceOrigin, setSourceOrigin] = useState<"template" | "external">("external");
  const [sourceSwitchConfirmOpen, setSourceSwitchConfirmOpen] = useState(false);
  const [createTemplateDialogOpen, setCreateTemplateDialogOpen] = useState(false);
  const [createTemplateName, setCreateTemplateName] = useState("");
  const [createTemplateDescription, setCreateTemplateDescription] = useState("");
  const [formPaneHeight, setFormPaneHeight] = useState<number | null>(null);
  const previewOpenRef = useRef(previewOpen);
  const modeRef = useRef(mode);
  const runtimeSyncRef = useRef<{ virtualClusterId: string; resourceTemplateId: string } | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  previewOpenRef.current = previewOpen;
  modeRef.current = mode;

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

  useEffect(() => {
    if (!pendingSourceSubmit) return;
    setMode("source");
    setSourceOrigin("external");
    setSourceJson(formatSourceJobPayload(pendingSourceSubmit.payload));
    setSelectedVirtualClusterId(pendingSourceSubmit.virtualClusterId);
    runtimeSyncRef.current = {
      virtualClusterId: pendingSourceSubmit.virtualClusterId,
      resourceTemplateId
    };
    setPendingSourceSubmit(undefined);
    toast.success("Loaded job configuration into Source submit.");
  }, [pendingSourceSubmit, resourceTemplateId, setPendingSourceSubmit, setSelectedVirtualClusterId]);

  useEffect(() => {
    if (mode !== "source" || !virtualClusterId) return;

    const previous = runtimeSyncRef.current;
    if (!previous) {
      runtimeSyncRef.current = { virtualClusterId, resourceTemplateId };
      return;
    }
    if (previous.virtualClusterId === virtualClusterId && previous.resourceTemplateId === resourceTemplateId) {
      return;
    }
    runtimeSyncRef.current = { virtualClusterId, resourceTemplateId };

    setSourceJson((current) => {
      const parsed = parseSourceJobPayload(current);
      if (!parsed.ok) {
        toast.error("Fix JSON before syncing Runtime selection.");
        return current;
      }
      try {
        const next = applyRuntimeToSourcePayload(parsed.payload, virtualClusterId, selectedResources);
        const formatted = formatSourceJobPayload(next);
        return formatted !== current ? formatted : current;
      } catch {
        toast.error("Could not apply resource template to source JSON.");
        return current;
      }
    });
  }, [mode, resourceTemplateId, selectedResources, virtualClusterId]);

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
    try {
      return applyResourceOverride(resolvedPayload, selectedResources);
    } catch {
      return undefined;
    }
  }, [cloneRequest, resolvedPayload, selectedResources]);

  const submit = useCallback(async () => {
    try {
      let request: StartJobRunRequest | undefined;
      if (mode === "source") {
        const parsed = parseSourceJobPayload(sourceJson);
        if (!parsed.ok) {
          toast.error(parsed.error);
          return;
        }
        const overridden = applyResourceOverride(parsed.payload, selectedResources);
        request = toStartJobRunRequest(overridden, selectedResources);
      } else {
        request = buildSubmitRequest({
          cloneRequest,
          selectedTemplate,
          resolvedPayload,
          selectedResources,
          customVariables
        });
      }
      if (!request) {
        toast.error("Complete the template selections before submitting.");
        return;
      }
      const job = await startJobRun.mutateAsync(request);
      toast.success(`Submitted ${job.name}`);
      setCloneRequest(undefined);
      enableAfterSubmit();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to submit job."));
    }
  }, [
    cloneRequest,
    customVariables,
    enableAfterSubmit,
    mode,
    resolvedPayload,
    selectedResources,
    selectedTemplate,
    sourceJson,
    startJobRun
  ]);

  const validateAndSubmit = useCallback(() => {
    if (mode === "source") {
      const parsed = parseSourceJobPayload(sourceJson);
      if (!parsed.ok) {
        toast.error(parsed.error);
        return;
      }
      const overridden = applyResourceOverride(parsed.payload, selectedResources);
      const validation = validateSubmitPayload(overridden);
      if (!validation.ok) {
        toast.error(validation.errors[0] ?? "Submit payload validation failed.");
        if (validation.errors.length > 1) {
          validation.errors.slice(1).forEach((error) => toast.error(error));
        }
        return;
      }
      void submit();
      return;
    }
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
  }, [cloneRequest, customVariables, mode, resolvedPayload, selectedResources, selectedTemplate, sourceJson, submit]);

  const enterSourceMode = useCallback(() => {
    if (previewPayload) {
      setSourceJson(formatSourceJobPayload(previewPayload));
      setSourceOrigin(cloneRequest ? "external" : "template");
    } else {
      setSourceJson("{}");
      setSourceOrigin("external");
    }
    runtimeSyncRef.current = virtualClusterId
      ? { virtualClusterId, resourceTemplateId }
      : null;
    setMode("source");
  }, [cloneRequest, previewPayload, resourceTemplateId, virtualClusterId]);

  const enterTemplateMode = useCallback(() => {
    if (sourceOrigin === "template") {
      setMode("template");
      return;
    }
    setSourceSwitchConfirmOpen(true);
  }, [sourceOrigin]);

  const handleModeChange = useCallback(
    (nextMode: string) => {
      if (nextMode === mode) return;
      if (nextMode === "source") {
        enterSourceMode();
        return;
      }
      enterTemplateMode();
    },
    [enterSourceMode, enterTemplateMode, mode]
  );

  const discardSourceAndSwitchToTemplate = useCallback(() => {
    setSourceSwitchConfirmOpen(false);
    setSourceJson("{}");
    setSourceOrigin("external");
    setMode("template");
  }, []);

  const openCreateTemplateDialog = useCallback(() => {
    setSourceSwitchConfirmOpen(false);
    setCreateTemplateName("");
    setCreateTemplateDescription("");
    setCreateTemplateDialogOpen(true);
  }, []);

  const saveTemplateFromSource = useCallback(async () => {
    const name = createTemplateName.trim();
    if (!name) {
      toast.error("Template name is required.");
      return;
    }
    const parsed = parseSourceJobPayload(sourceJson);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    const now = new Date().toISOString();
    const templateId = crypto.randomUUID();
    const description = createTemplateDescription.trim();
    const parameterized = parameterizeSourcePayloadForTemplate(parsed.payload);
    try {
      await createTemplate.mutateAsync({
        id: templateId,
        name,
        description: description || undefined,
        payloadTemplate: parameterized.payloadTemplate,
        customVariables: parameterized.customVariables,
        defaultResourceTemplateId: resourceTemplateId,
        builtIn: false,
        createdAt: now,
        updatedAt: now
      });
      setSelectedTemplateId(templateId);
      setMode("template");
      setSourceOrigin("template");
      setCreateTemplateDialogOpen(false);
      setSourceSwitchConfirmOpen(false);
      toast.success(
        parameterized.customVariables.length > 0
          ? `Template created with ${parameterized.customVariables.length} variables from entryPointArguments.`
          : "Template created from source JSON."
      );
    } catch (error) {
      toast.error(errorMessage(error, "Failed to create template."));
    }
  }, [
    createTemplate,
    createTemplateDescription,
    createTemplateName,
    resourceTemplateId,
    sourceJson
  ]);

  const beginFormPaneResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;

    const formPane = container.querySelector<HTMLElement>("[data-submit-form-pane]");
    const startY = event.clientY;
    const startHeight =
      formPaneHeight ?? formPane?.getBoundingClientRect().height ?? container.clientHeight * 0.7;

    const handleMove = (moveEvent: MouseEvent) => {
      const maxHeight = container.clientHeight - HISTORY_PANE_MIN_PX - SPLITTER_PX;
      const nextHeight = Math.min(
        maxHeight,
        Math.max(FORM_PANE_MIN_PX, startHeight + moveEvent.clientY - startY)
      );
      setFormPaneHeight(nextHeight);
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [formPaneHeight]);

  const toggleSubmitMode = useCallback(() => {
    if (modeRef.current === "template") {
      enterSourceMode();
      return;
    }
    enterTemplateMode();
  }, [enterSourceMode, enterTemplateMode]);

  const openPreview = useCallback(() => {
    if (!previewPayload) return;
    setPreviewOpen(true);
  }, [previewPayload]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (previewOpenRef.current || sourceSwitchConfirmOpen || createTemplateDialogOpen) return;

      if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, [contenteditable='true'], .cm-editor")) {
          return;
        }
        event.preventDefault();
        toggleSubmitMode();
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.shiftKey && (event.key === "P" || event.key === "p")) {
        if (modeRef.current !== "template") return;
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
  }, [
    createTemplateDialogOpen,
    openPreview,
    sourceSwitchConfirmOpen,
    toggleSubmitMode,
    validateAndSubmit
  ]);

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col gap-4 overflow-hidden">
      <PageHeader
        pageId="submit"
        actions={
          <>
            {mode === "template" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="outline" disabled={!previewPayload} onClick={openPreview}>
                    <Eye data-icon="inline-start" />
                    Preview JSON
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Preview JSON · {PREVIEW_JSON_SHORTCUT}</TooltipContent>
              </Tooltip>
            ) : null}
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

      <div ref={splitContainerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
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

        <div
          data-submit-form-pane
          className="grid min-h-0 grid-cols-[1fr_320px] gap-4 overflow-hidden"
          style={
            formPaneHeight != null
              ? { height: formPaneHeight, flex: "none" }
              : { flex: "7 1 0%" }
          }
        >
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6">
              <Tabs value={mode} onValueChange={handleModeChange} className="shrink-0">
                <TabsList title={`Toggle mode · ${TOGGLE_MODE_SHORTCUT}`}>
                  <TabsTrigger value="template">Template</TabsTrigger>
                  <TabsTrigger value="source">Source</TabsTrigger>
                </TabsList>
              </Tabs>
              {mode === "template" ? (
                <div className="min-h-0 flex-1 space-y-4 overflow-auto">
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
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-hidden">
                  <JsonTemplateEditor
                    value={sourceJson}
                    onChange={setSourceJson}
                    enableTemplateVariables={false}
                    fillHeight
                    className="h-full"
                  />
                </div>
              )}
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

        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize editor and recent submissions"
          aria-valuenow={formPaneHeight ?? undefined}
          className="group relative h-2 shrink-0 cursor-row-resize touch-none"
          onMouseDown={beginFormPaneResize}
        >
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border group-hover:bg-primary/50" />
        </div>

        <div
          className="flex min-h-0 flex-col overflow-hidden"
          style={formPaneHeight != null ? { flex: "1 1 0%" } : { flex: "3 1 0%" }}
        >
          <JobRunsPanel
            virtualClusterId={virtualClusterId}
            title="Recent Submissions"
            showAutoRefreshControl
            submittedOnly
            autoRefresh={submissionAutoRefresh}
            onAutoRefreshChange={setSubmissionAutoRefresh}
            refreshCountdown={submissionRefreshCountdown}
            submissionJobsQuery={submissionJobs}
            onOpenLogs={onOpenLogs}
            onOpenAiAssistant={onOpenAiAssistant}
            onSubmissionStarted={enableAfterSubmit}
            className="min-h-0 flex-1"
          />
        </div>
      </div>

      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} payload={previewPayload} />
      <Dialog open={sourceSwitchConfirmOpen} onOpenChange={setSourceSwitchConfirmOpen}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Switch to Template submit?</DialogTitle>
            <DialogDescription>
              Current source JSON was not loaded from a template. Switching discards the editor contents unless you
              save it as a template.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setSourceSwitchConfirmOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={openCreateTemplateDialog}>
              Create template and switch
            </Button>
            <Button type="button" className="w-full sm:w-auto" onClick={discardSourceAndSwitchToTemplate}>
              Discard and switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={createTemplateDialogOpen} onOpenChange={setCreateTemplateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create template from source</DialogTitle>
            <DialogDescription>
              Save the current source JSON as a job config template, then switch to Template submit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Name">
              <Input
                value={createTemplateName}
                onChange={(event) => setCreateTemplateName(event.target.value)}
                placeholder="Template name"
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={createTemplateDescription}
                onChange={(event) => setCreateTemplateDescription(event.target.value)}
                placeholder="Optional description"
                rows={3}
              />
            </Field>
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setCreateTemplateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!createTemplateName.trim() || createTemplate.isPending}
              onClick={() => void saveTemplateFromSource()}
            >
              {createTemplate.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  return {
    ...toStartJobRunRequest(resolvedPayload, selectedResources),
    templateName: selectedTemplate.name
  };
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
