import { Copy, Download, Edit2, FileJson, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
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
import {
  buildImportedJobConfigTemplate,
  parseImportedJobConfigTemplate,
  serializeJobConfigTemplate
} from "@/services/jobConfigImportExport";
import { openTextFile, saveTextFile } from "@/services/fileDownload";
import { defaultFormatForVariableType } from "@/services/dateFormat";
import type { JobConfigTemplate, TemplateVariableDefinition, TemplateVariableType } from "@/types/domain";

type Editing = { template?: JobConfigTemplate } | undefined;

type EditableVariable = TemplateVariableDefinition & { editorId: string };

export function ApplicationConfigTemplatesPage() {
  const templates = useJobConfigTemplates();
  const [editing, setEditing] = useState<Editing>();
  const createTemplate = useCreateJobConfigTemplate();
  const updateTemplate = useUpdateJobConfigTemplate();
  const deleteTemplate = useDeleteJobConfigTemplate();
  const duplicateTemplate = useDuplicateJobConfigTemplate();
  const items = templates.data ?? [];

  const importTemplate = async (raw: string) => {
    try {
      const payload = parseImportedJobConfigTemplate(raw);
      await createTemplate.mutateAsync(buildImportedJobConfigTemplate(payload));
      toast.success("Application config template imported.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import template.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Application Config</h1>
          <p className="text-sm text-muted-foreground">
            Manage full EMR submit JSON templates with variable substitution.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              const content = await openTextFile();
              if (!content) return;
              await importTemplate(content);
            }}
          >
            <Upload data-icon="inline-start" />
            Import
          </Button>
          <Button onClick={() => setEditing({})}>
            <Plus data-icon="inline-start" />
            Template
          </Button>
        </div>
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
                {(template.customVariables ?? []).length} variable
                {(template.customVariables ?? []).length === 1 ? "" : "s"}
                {template.defaultResourceTemplateId
                  ? ` · default resource ${template.defaultResourceTemplateId}`
                  : ""}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="icon" onClick={() => setEditing({ template })}>
                  <Edit2 />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    const saved = await saveTextFile(
                      `${template.name.replace(/\s+/g, "-").toLowerCase()}.json`,
                      serializeJobConfigTemplate({
                        name: template.name,
                        description: template.description,
                        payloadTemplate: template.payloadTemplate,
                        customVariables: template.customVariables ?? [],
                        defaultResourceTemplateId: template.defaultResourceTemplateId
                      })
                    );
                    if (saved) toast.success("Template exported.");
                  }}
                >
                  <Download />
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
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPayloadTemplate(defaultExamplePayload())}>
                <FileJson data-icon="inline-start" />
                Load Example
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  const content = await openTextFile();
                  if (!content) return;
                  try {
                    const imported = parseImportedJobConfigTemplate(content);
                    setName(imported.name);
                    setDescription(imported.description ?? "");
                    setPayloadTemplate(imported.payloadTemplate);
                    setCustomVariables(imported.customVariables);
                    setDefaultResourceTemplateId(imported.defaultResourceTemplateId);
                    toast.success("Template JSON imported into editor.");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to import JSON.");
                  }
                }}
              >
                <Upload data-icon="inline-start" />
                Import JSON
              </Button>
            </div>
          </div>
          <Textarea
            className="min-h-[280px] font-mono text-xs"
            value={payloadTemplate}
            onChange={(event) => setPayloadTemplate(event.target.value)}
          />
          <VariableEditor
            key={template?.id ?? "new-template"}
            variables={customVariables}
            onChange={setCustomVariables}
          />
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
              if (customVariables.some((variable) => !variable.name.trim())) {
                toast.error("Each variable needs a name.");
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
  const [rows, setRows] = useState<EditableVariable[]>(() => toEditableRows(variables));

  const commitRows = (nextRows: EditableVariable[]) => {
    setRows(nextRows);
    onChange(nextRows.map(stripEditorId));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Custom Variables</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            commitRows([
              ...rows,
              {
                editorId: crypto.randomUUID(),
                name: `VAR_${rows.length + 1}`,
                type: "text",
                required: true
              }
            ])
          }
        >
          <Plus data-icon="inline-start" />
          Add Variable
        </Button>
      </div>
      {rows.map((variable, index) => (
        <VariableRow
          key={variable.editorId}
          variable={variable}
          onChange={(patch) =>
            commitRows(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
          }
          onRemove={() => commitRows(rows.filter((_, rowIndex) => rowIndex !== index))}
        />
      ))}
    </div>
  );
}

function VariableRow({
  variable,
  onChange,
  onRemove
}: {
  variable: EditableVariable;
  onChange: (patch: Partial<EditableVariable>) => void;
  onRemove: () => void;
}) {
  const [optionsDraft, setOptionsDraft] = useState((variable.options ?? []).join(", "));

  useEffect(() => {
    setOptionsDraft((variable.options ?? []).join(", "));
  }, [variable.editorId, variable.options]);

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="grid grid-cols-[1fr_180px_auto] gap-2">
        <Input
          placeholder="Variable name"
          value={variable.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <Select
          value={variable.type}
          onValueChange={(value: TemplateVariableType) =>
            onChange({
              type: value,
              defaultValue: undefined,
              options: undefined,
              format: value === "date" || value === "dateTime" ? defaultFormatForVariableType(value) : undefined
            })
          }
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
        <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>

      <DefaultValueField variable={variable} onChange={onChange} />

      {(variable.type === "enum" || variable.type === "multiEnum") && (
        <Input
          placeholder="Options, comma-separated"
          value={optionsDraft}
          onChange={(event) => setOptionsDraft(event.target.value)}
          onBlur={() =>
            onChange({
              options: optionsDraft
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
            })
          }
        />
      )}

      {(variable.type === "date" || variable.type === "dateTime") && (
        <Input
          placeholder="Format, e.g. YYYY-MM-DD"
          value={variable.format ?? defaultFormatForVariableType(variable.type)}
          onChange={(event) => onChange({ format: event.target.value })}
        />
      )}

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={Boolean(variable.required)} onCheckedChange={(checked) => onChange({ required: Boolean(checked) })} />
        Required
      </label>
    </div>
  );
}

function DefaultValueField({
  variable,
  onChange
}: {
  variable: EditableVariable;
  onChange: (patch: Partial<EditableVariable>) => void;
}) {
  if (variable.type === "boolean") {
    return (
      <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
        <span>Default value</span>
        <Switch
          checked={Boolean(variable.defaultValue)}
          onCheckedChange={(checked) => onChange({ defaultValue: checked })}
        />
      </label>
    );
  }

  if (variable.type === "number") {
    return (
      <Field label="Default value">
        <Input
          type="number"
          value={variable.defaultValue === undefined ? "" : String(variable.defaultValue)}
          onChange={(event) =>
            onChange({ defaultValue: event.target.value === "" ? undefined : Number(event.target.value) })
          }
        />
      </Field>
    );
  }

  if (variable.type === "enum") {
    const options = variable.options ?? [];
    return (
      <Field label="Default value">
        <Select
          value={variable.defaultValue === undefined ? "" : String(variable.defaultValue)}
          onValueChange={(value) => onChange({ defaultValue: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Optional default" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  }

  if (variable.type === "multiEnum") {
    return (
      <Field label="Default value">
        <Input
          placeholder="Comma-separated default selections"
          value={Array.isArray(variable.defaultValue) ? variable.defaultValue.join(", ") : ""}
          onChange={(event) =>
            onChange({
              defaultValue: event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
            })
          }
        />
      </Field>
    );
  }

  return (
    <Field label="Default value">
      <Input
        placeholder="Optional default"
        value={variable.defaultValue === undefined ? "" : String(variable.defaultValue)}
        onChange={(event) => onChange({ defaultValue: event.target.value || undefined })}
      />
    </Field>
  );
}

function toEditableRows(variables: TemplateVariableDefinition[]): EditableVariable[] {
  return variables.map((variable) => ({
    ...variable,
    required: variable.required ?? true,
    format:
      variable.format ??
      (variable.type === "date" || variable.type === "dateTime" ? defaultFormatForVariableType(variable.type) : undefined),
    editorId: crypto.randomUUID()
  }));
}

function stripEditorId(variable: EditableVariable): TemplateVariableDefinition {
  const { editorId: _editorId, ...definition } = variable;
  return definition;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
