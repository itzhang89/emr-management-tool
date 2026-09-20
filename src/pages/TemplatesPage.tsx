import { Copy, Edit2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { useT } from "@/i18n";
import { useCreateTemplate, useDeleteTemplate, useDuplicateTemplate, useTemplates, useUpdateTemplate } from "@/hooks/useTemplates";
import { ApplicationConfigTemplatesPage } from "@/pages/ApplicationConfigTemplatesPage";
import type { ResourceTemplate, SparkResourceConfig } from "@/types/domain";

type Editing = { template?: ResourceTemplate } | undefined;

export function TemplatesPage() {
  const t = useT();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader pageId="templates" />

      <Tabs defaultValue="appConfig" className="space-y-4">
        <TabsList>
          <TabsTrigger value="appConfig">{t("Application Config")}</TabsTrigger>
          <TabsTrigger value="resources">{t("Resource Templates")}</TabsTrigger>
        </TabsList>
        <TabsContent value="appConfig">
          <ApplicationConfigTemplatesPage embedded />
        </TabsContent>
        <TabsContent value="resources">
          <ResourceTemplatesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ResourceTemplatesPanel() {
  const t = useT();
  const templates = useTemplates();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const duplicate = useDuplicateTemplate();
  const [editing, setEditing] = useState<Editing>();
  const resources = templates.data?.resourceTemplates ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("Resource Templates")}</h2>
          <p className="text-sm text-muted-foreground">{t("Manage reusable Spark driver and executor sizing presets.")}</p>
        </div>
        <Button onClick={() => setEditing({})}>
          <Plus data-icon="inline-start" />
          {t("Resource Template")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {resources.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>{template.name}</CardTitle>
                {template.builtIn ? <Badge variant="secondary">{t("Built-in")}</Badge> : null}
              </div>
              <CardDescription>{template.id}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {t("Driver: {cores} cores / {memory}", {
                  cores: template.resources.driverCores,
                  memory: template.resources.driverMemory
                })}
              </div>
              <div className="text-sm text-muted-foreground">
                {t("Executors: {instances} x {cores} cores / {memory}", {
                  instances: template.resources.executorInstances,
                  cores: template.resources.executorCores,
                  memory: template.resources.executorMemory
                })}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Edit {name}", { name: template.name })}
                  onClick={() => setEditing({ template })}
                >
                  <Edit2 />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Duplicate {name}", { name: template.name })}
                  onClick={() => duplicate.mutate({ id: template.id, type: "resource" })}
                >
                  <Copy />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Delete {name}", { name: template.name })}
                  onClick={async () => {
                    try {
                      await deleteTemplate.mutateAsync({ id: template.id, type: "resource" });
                      toast.success(t("Resource template deleted."));
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Failed to delete resource template.");
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {resources.length === 0 ? (
          <Card className="col-span-2">
            <CardHeader>
              <CardTitle>{t("No resource templates")}</CardTitle>
              <CardDescription>{t("Create a custom resource preset for Submit Job.")}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>

      <ResourceTemplateDialog
        editing={editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
        onSave={async (template) => {
          try {
            if (editing?.template) {
              await updateTemplate.mutateAsync(template);
            } else {
              await createTemplate.mutateAsync(template);
            }
            toast.success(t("Resource template saved."));
            setEditing(undefined);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to save template.");
          }
        }}
      />
    </div>
  );
}

function ResourceTemplateDialog({
  editing,
  onOpenChange,
  onSave
}: {
  editing: Editing;
  onOpenChange: (open: boolean) => void;
  onSave: (template: ResourceTemplate) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [resources, setResources] = useState<SparkResourceConfig>(defaultResources());
  const template = editing?.template;
  const now = new Date().toISOString();

  useEffect(() => {
    setName(template?.name ?? "");
    setResources(template?.resources ?? defaultResources());
  }, [template]);

  if (!editing) return null;

  return (
    <Dialog open={Boolean(editing)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{template ? t("Edit resource template") : t("Create resource template")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("Name")}>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("Driver Cores")}>
              <Input
                type="number"
                value={resources.driverCores}
                onChange={(event) => setResources((current) => ({ ...current, driverCores: Number(event.target.value) }))}
              />
            </Field>
            <Field label={t("Driver Memory")}>
              <Input
                value={resources.driverMemory}
                onChange={(event) => setResources((current) => ({ ...current, driverMemory: event.target.value }))}
              />
            </Field>
            <Field label={t("Executor Cores")}>
              <Input
                type="number"
                value={resources.executorCores}
                onChange={(event) => setResources((current) => ({ ...current, executorCores: Number(event.target.value) }))}
              />
            </Field>
            <Field label={t("Executor Memory")}>
              <Input
                value={resources.executorMemory}
                onChange={(event) => setResources((current) => ({ ...current, executorMemory: event.target.value }))}
              />
            </Field>
            <Field label={t("Executor Instances")}>
              <Input
                type="number"
                value={resources.executorInstances}
                onChange={(event) =>
                  setResources((current) => ({ ...current, executorInstances: Number(event.target.value) }))
                }
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            onClick={() =>
              void onSave({
                id: template?.id ?? crypto.randomUUID(),
                name,
                resources,
                builtIn: template?.builtIn ?? false,
                createdAt: template?.createdAt ?? now,
                updatedAt: now
              })
            }
          >
            {t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function defaultResources(): SparkResourceConfig {
  return { driverCores: 1, driverMemory: "1G", executorCores: 1, executorMemory: "1G", executorInstances: 1 };
}
