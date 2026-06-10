import { Copy, Edit2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { useCreateTemplate, useDeleteTemplate, useDuplicateTemplate, useTemplates, useUpdateTemplate } from "@/hooks/useTemplates";
import type { ApplicationTemplate, ResourceTemplate, SparkResourceConfig } from "@/types/domain";

type Editing =
  | { type: "application"; template?: ApplicationTemplate }
  | { type: "resource"; template?: ResourceTemplate }
  | undefined;

export function TemplatesPage() {
  const templates = useTemplates();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const duplicate = useDuplicateTemplate();
  const [editing, setEditing] = useState<Editing>();
  const applications = templates.data?.applicationTemplates ?? [];
  const resources = templates.data?.resourceTemplates ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">Manage reusable application and resource templates.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditing({ type: "resource" })}>
            <Plus data-icon="inline-start" />
            Resource
          </Button>
          <Button onClick={() => setEditing({ type: "application" })}>
            <Plus data-icon="inline-start" />
            Application
          </Button>
        </div>
      </div>
      <Tabs defaultValue="application">
        <TabsList>
          <TabsTrigger value="application">Application Template</TabsTrigger>
          <TabsTrigger value="resource">Resource Template</TabsTrigger>
        </TabsList>
        <TabsContent value="application">
          <TemplateCards
            items={applications.map((template) => [template.id, template.name, template.jarPath, template.mainClass])}
            type="application"
            onEdit={(id) => setEditing({ type: "application", template: applications.find((template) => template.id === id) })}
            onDuplicate={(id) => duplicate.mutate({ id, type: "application" })}
            onDelete={(id) => {
              if (!window.confirm("Delete this application template?")) return;
              deleteTemplate.mutate({ id, type: "application" });
            }}
          />
        </TabsContent>
        <TabsContent value="resource">
          <TemplateCards
            items={resources.map((template) => [
              template.id,
              template.name,
              `${template.resources.executorInstances} executors`,
              `${template.resources.executorCores} cores / ${template.resources.executorMemory} executor memory`
            ])}
            type="resource"
            onEdit={(id) => setEditing({ type: "resource", template: resources.find((template) => template.id === id) })}
            onDuplicate={(id) => duplicate.mutate({ id, type: "resource" })}
            onDelete={(id) => {
              if (!window.confirm("Delete this resource template?")) return;
              deleteTemplate.mutate({ id, type: "resource" });
            }}
          />
        </TabsContent>
      </Tabs>
      <TemplateDialog
        editing={editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
        onSave={async (template) => {
          try {
            if (editing?.template) {
              await updateTemplate.mutateAsync(template);
            } else {
              await createTemplate.mutateAsync(template);
            }
            toast.success("Template saved.");
            setEditing(undefined);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to save template.");
          }
        }}
      />
    </div>
  );
}

function TemplateCards({
  items,
  type,
  onEdit,
  onDelete,
  onDuplicate
}: {
  items: string[][];
  type: "application" | "resource";
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 pt-4">
      {items.map(([id, title, line1, line2]) => (
        <Card key={id}>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{line1}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">{line2}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" aria-label={`Edit ${title}`} onClick={() => onEdit(id)}>
                <Edit2 data-icon="inline-start" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Duplicate ${title}`} onClick={() => onDuplicate(id)}>
                <Copy data-icon="inline-start" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Delete ${title}`} onClick={() => onDelete(id)}>
                <Trash2 data-icon="inline-start" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {items.length === 0 ? (
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>No {type} templates</CardTitle>
            <CardDescription>Create a template from the Submit Job page.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}

function TemplateDialog({
  editing,
  onOpenChange,
  onSave
}: {
  editing: Editing;
  onOpenChange: (open: boolean) => void;
  onSave: (template: ApplicationTemplate | ResourceTemplate) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [jarPath, setJarPath] = useState("");
  const [mainClass, setMainClass] = useState("");

  const now = new Date().toISOString();
  const appTemplate = editing?.type === "application" ? editing.template : undefined;
  const resourceTemplate = editing?.type === "resource" ? editing.template : undefined;

  useEffect(() => {
    setName(editing?.template?.name ?? "");
    setJarPath(appTemplate?.jarPath ?? "");
    setMainClass(appTemplate?.mainClass ?? "");
  }, [appTemplate?.jarPath, appTemplate?.mainClass, editing?.template?.name]);

  if (!editing) return null;

  return (
    <Dialog open={Boolean(editing)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing.template ? "Edit" : "Create"} {editing.type} template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
          {editing.type === "application" ? (
            <>
              <Field label="Jar Path"><Input value={jarPath} onChange={(event) => setJarPath(event.target.value)} /></Field>
              <Field label="Main Class"><Input value={mainClass} onChange={(event) => setMainClass(event.target.value)} /></Field>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => {
              if (editing.type === "application") {
                void onSave({
                  id: appTemplate?.id ?? uuid(),
                  name,
                  description: appTemplate?.description ?? "",
                  jarPath,
                  mainClass,
                  defaultArguments: appTemplate?.defaultArguments ?? [],
                  sparkConfig: appTemplate?.sparkConfig ?? {},
                  resourceTemplateId: appTemplate?.resourceTemplateId,
                  createdAt: appTemplate?.createdAt ?? now,
                  updatedAt: now
                });
                return;
              }
              void onSave({
                id: resourceTemplate?.id ?? uuid(),
                name,
                resources: resourceTemplate?.resources ?? defaultResources(),
                builtIn: false,
                createdAt: resourceTemplate?.createdAt ?? now,
                updatedAt: now
              });
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function defaultResources(): SparkResourceConfig {
  return { driverCores: 1, driverMemory: "2G", executorCores: 2, executorMemory: "4G", executorInstances: 2 };
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
}
