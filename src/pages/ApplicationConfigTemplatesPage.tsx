import { Copy, Edit2, FileJson, Plus, Trash2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateJobConfigTemplate,
  useDeleteJobConfigTemplate,
  useDuplicateJobConfigTemplate,
  useJobConfigTemplates,
  useUpdateJobConfigTemplate
} from "@/hooks/useJobConfigTemplates";
import { useTemplates } from "@/hooks/useTemplates";
import { defaultExamplePayload } from "@/services/jobConfigExamples";
import type { JobConfigTemplate, TemplateVariableDefinition, TemplateVariableType } from "@/types/domain";

type Editing = { template?: JobConfigTemplate } | undefined;

export function ApplicationConfigTemplatesPage() {
  const templates = useJobConfigTemplates();
  const [editing, setEditing] = useState<Editing>();
  const createTemplate = useCreateJobConfigTemplate();
  const updateTemplate = useUpdateJobConfigTemplate();
  const deleteTemplate = useDeleteJobConfigTemplate();
  const duplicateTemplate = useDuplicateJobConfigTemplate();
  const items = templates.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Application Config</h1>
          <p className="text-sm text-muted-foreground">
            Manage full EMR submit JSON templates with variable substitution.
          </p>
        </div>
        <Button onClick={() => setEditing({})}>
          <Plus data-icon="inline-start" />
          Template
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {items.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>{template.name}</CardTitle>
                {template.builtIn ? <Badge variant="secondary">Built-in</Badge> : null}
              </div>
              <CardDescription>{template.description ?? "No description"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {template.customVariables.length} variable{template.customVariables.length === 1 ? "" : "s"}
                {template.defaultResourceTemplateId
                  ? ` · default resource ${template.defaultResourceTemplateId}`
                  : ""}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="icon" onClick={() => setEditing({ template })}>
                  <Edit2 />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => duplicateTemplate.mutate(template.id)}>
                  <Copy />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    try {
                      await deleteTemplate.mutateAsync(template.id);
                      toast.success("Application config template deleted.");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Failed to delete template.");
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <JobConfigTemplateDialog
        editing={editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
        onSave={async (template) => {
          try {
            if (editing?.template) {
              await updateTemplate.mutateAsync(template);
            } else {
              await createTemplate.mutateAsync(template);
            }
            toast.success("Application config template saved.");
            setEditing(undefined);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to save template.");
          }
        }}
      />
    </div>
  );
}

function JobConfigTemplateDialog({
  editing,
  onOpenChange,
  onSave
}: {
  editing: Editing;
  onOpenChange: (open: boolean) => void;
  onSave: (template: JobConfigTemplate) => Promise<void>;
}) {
  const resourceTemplates = useTemplates();
  const template = editing?.template;
  const now = new Date().toISOString();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [payloadTemplate, setPayloadTemplate] = useState(defaultExamplePayload());
  const [customVariables, setCustomVariables] = useState<TemplateVariableDefinition[]>([]);
  const [defaultResourceTemplateId, setDefaultResourceTemplateId] = useState<string>();

  useEffect(() => {
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setPayloadTemplate(template?.payloadTemplate ?? defaultExamplePayload());
    setCustomVariables(template?.customVariables ?? []);
    setDefaultResourceTemplateId(template?.defaultResourceTemplateId);
  }, [template]);

  if (!editing) return null;

  return (
    <Dialog open={Boolean(editing)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? "Edit" : "Create"} application config template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name">
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Default Resource Template">
              <Select value={defaultResourceTemplateId ?? ""} onValueChange={setDefaultResourceTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional default resource" />
                </SelectTrigger>
                <SelectContent>
                  {(resourceTemplates.data?.resourceTemplates ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Description">
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <div className="flex items-center justify-between">
            <Label>Payload JSON</Label>
            <Button type="button" variant="outline" size="sm" onClick={() => setPayloadTemplate(defaultExamplePayload())}>
              <FileJson data-icon="inline-start" />
              Load Example
            </Button>
          </div>
          <Textarea
            className="min-h-[280px] font-mono text-xs"
            value={payloadTemplate}
            onChange={(event) => setPayloadTemplate(event.target.value)}
          />
          <VariableEditor variables={customVariables} onChange={setCustomVariables} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              try {
                JSON.parse(payloadTemplate);
              } catch {
                toast.error("Payload JSON is invalid.");
                return;
              }
              void onSave({
                id: template?.id ?? crypto.randomUUID(),
                name,
                description,
                payloadTemplate,
                customVariables,
                defaultResourceTemplateId,
                builtIn: template?.builtIn ?? false,
                createdAt: template?.createdAt ?? now,
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

function VariableEditor({
  variables,
  onChange
}: {
  variables: TemplateVariableDefinition[];
  onChange: (variables: TemplateVariableDefinition[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Custom Variables</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...variables,
              { name: `VAR_${variables.length + 1}`, type: "text", required: false }
            ])
          }
        >
          <Plus data-icon="inline-start" />
          Add Variable
        </Button>
      </div>
      {variables.map((variable, index) => (
        <div key={`${variable.name}-${index}`} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 rounded-lg border p-3">
          <Input
            placeholder="Name"
            value={variable.name}
            onChange={(event) => updateVariable(variables, index, { name: event.target.value }, onChange)}
          />
          <Input
            placeholder="Label"
            value={variable.label ?? ""}
            onChange={(event) => updateVariable(variables, index, { label: event.target.value }, onChange)}
          />
          <Select
            value={variable.type}
            onValueChange={(value: TemplateVariableType) => updateVariable(variables, index, { type: value }, onChange)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["text", "number", "boolean", "enum", "multiEnum", "date", "dateTime"] as const).map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(variables.filter((_, itemIndex) => itemIndex !== index))}
          >
            <Trash2 />
          </Button>
          {(variable.type === "enum" || variable.type === "multiEnum") && (
            <Input
              className="col-span-4"
              placeholder="Options comma-separated"
              value={(variable.options ?? []).join(",")}
              onChange={(event) =>
                updateVariable(
                  variables,
                  index,
                  { options: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) },
                  onChange
                )
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}

function updateVariable(
  variables: TemplateVariableDefinition[],
  index: number,
  patch: Partial<TemplateVariableDefinition>,
  onChange: (variables: TemplateVariableDefinition[]) => void
) {
  onChange(variables.map((variable, itemIndex) => (itemIndex === index ? { ...variable, ...patch } : variable)));
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
