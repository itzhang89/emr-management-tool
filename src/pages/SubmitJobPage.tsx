import { Eye, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { TemplateVariableFields } from "@/components/templates/TemplateVariableFields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStartJobRun, useVirtualClusters } from "@/hooks/useEmr";
import {
  useJobConfigTemplates,
  useSubmitUser
} from "@/hooks/useJobConfigTemplates";
import { useTemplates } from "@/hooks/useTemplates";
import { applyResourceOverride } from "@/services/resourceOverride";
import {
  getDefaultCustomVariableValues,
  resolveTemplatePayload,
  toStartJobRunRequest,
  validateSubmitPayload
} from "@/services/templateEngine";
import { useSessionStore } from "@/stores/sessionStore";
import type { JobConfigTemplate, ResolvedJobPayload, SparkResourceConfig, StartJobRunRequest } from "@/types/domain";

export function SubmitJobPage() {
  const setSelectedVirtualClusterId = useSessionStore((state) => state.setSelectedVirtualClusterId);
  const clonedJobRequest = useSessionStore((state) => state.clonedJobRequest);
  const setClonedJobRequest = useSessionStore((state) => state.setClonedJobRequest);
  const clusters = useVirtualClusters();
  const startJobRun = useStartJobRun();
  const jobConfigTemplates = useJobConfigTemplates();
  const resourceTemplates = useTemplates();
  const submitUserQuery = useSubmitUser();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [virtualClusterId, setVirtualClusterId] = useState("");
  const [resourceTemplateId, setResourceTemplateId] = useState("tiny");
  const [customVariables, setCustomVariables] = useState<Record<string, string | number | boolean | string[]>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cloneRequest, setCloneRequest] = useState<StartJobRunRequest>();

  const templates = jobConfigTemplates.data ?? [];
  const resources = resourceTemplates.data?.resourceTemplates ?? [];
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0];
  const selectedResources =
    resources.find((template) => template.id === resourceTemplateId)?.resources ??
    resources.find((template) => template.id === "tiny")?.resources ??
    defaultResources();

  useEffect(() => {
    if (!selectedTemplateId && templates[0]) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    if (!selectedTemplate) return;
    setCustomVariables(getDefaultCustomVariableValues(selectedTemplate));
    if (selectedTemplate.defaultResourceTemplateId) {
      setResourceTemplateId(selectedTemplate.defaultResourceTemplateId);
    }
  }, [selectedTemplate?.id]);

  useEffect(() => {
    if (!clonedJobRequest) return;
    setCloneRequest({
      ...clonedJobRequest,
      name: `${clonedJobRequest.name}-copy`
    });
    setVirtualClusterId(clonedJobRequest.virtualClusterId);
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

  const submit = async () => {
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
      toast.error(error instanceof Error ? error.message : "Failed to submit job.");
    }
  };

  const validateAndSubmit = () => {
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
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Submit Job</h1>
          <p className="text-sm text-muted-foreground">Submit template-driven Spark jobs to EMR Virtual Clusters.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={!previewPayload} onClick={() => setPreviewOpen(true)}>
            <Eye data-icon="inline-start" />
            Preview JSON
          </Button>
          <Button type="button" disabled={startJobRun.isPending} onClick={validateAndSubmit}>
            <Send data-icon="inline-start" />
            {startJobRun.isPending ? "Submitting..." : "Submit"}
          </Button>
        </div>
      </div>

      {cloneRequest ? (
        <Card>
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

      <div className="grid grid-cols-[1fr_320px] gap-6">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Job Config Template</CardTitle>
              <CardDescription>Select the application JSON template and fill custom variables.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  variables={selectedTemplate.customVariables}
                  values={customVariables}
                  onChange={setCustomVariables}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Runtime Selection</CardTitle>
            <CardDescription>Choose where the job runs and which resource preset to apply.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Virtual Cluster">
              <Select
                value={virtualClusterId}
                onValueChange={(value) => {
                  setVirtualClusterId(value);
                  setSelectedVirtualClusterId(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select cluster" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(clusters.data?.clusters ?? []).map((cluster) => (
                      <SelectItem key={cluster.id} value={cluster.id}>
                        {cluster.name} / {cluster.namespace}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
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
