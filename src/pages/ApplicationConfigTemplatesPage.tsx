import { ArrowDown, ArrowUp, CircleHelp, Copy, Download, Edit2, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import {
  BOOLEAN_OUTPUT_OPTIONS,
  defaultBooleanOutputStyle,
  describeBooleanVariable,
  formatBooleanValue,
  parseBooleanOutputStyle,
  resolveBooleanDefaultValue
} from "@/services/booleanVariable";
import { ENUM_DISPLAY_OPTIONS, inferEnumDisplayFormat, parseEnumDisplayFormat } from "@/services/enumVariable";
import type { JobConfigTemplate, TemplateVariableDefinition, TemplateVariableType } from "@/types/domain";

type Editing = { template?: JobConfigTemplate } | undefined;

type EditableVariable = TemplateVariableDefinition & { editorId: string };

const TEMPLATE_EDITOR_TEXT_INPUT_PROPS = {
  autoCapitalize: "none",
  autoCorrect: "off",
  spellCheck: false
} as const;

type TemplateEditorSnapshot = Pick<
  JobConfigTemplate,
  "name" | "description" | "payloadTemplate" | "customVariables" | "defaultResourceTemplateId"
>;

export function ApplicationConfigTemplatesPage({ embedded = false }: { embedded?: boolean }) {
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
          {embedded ? (
            <h2 className="text-2xl font-semibold tracking-tight">Application Config</h2>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">Application Config</h1>
          )}
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
                <Button variant="ghost" size="icon" aria-label={`Edit ${template.name}`} onClick={() => setEditing({ template })}>
                  <Edit2 />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Export ${template.name}`}
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
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Duplicate ${template.name}`}
                  onClick={() => duplicateTemplate.mutate(template.id)}
                >
                  <Copy />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${template.name}`}
                  onClick={async () => {
                    if (template.builtIn) {
                      toast.error("Built-in example templates are for reference and cannot be deleted.");
                      return;
                    }
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
  const [resetSnapshot, setResetSnapshot] = useState<TemplateEditorSnapshot>(() => createEditorSnapshot());
  const [variableEditorKey, setVariableEditorKey] = useState(0);

  useEffect(() => {
    const snapshot = createEditorSnapshot(template);
    applyEditorSnapshot(snapshot);
    setResetSnapshot(snapshot);
    setVariableEditorKey((key) => key + 1);
  }, [template]);

  const applyEditorSnapshot = (snapshot: TemplateEditorSnapshot) => {
    setName(snapshot.name);
    setDescription(snapshot.description ?? "");
    setPayloadTemplate(snapshot.payloadTemplate);
    setCustomVariables(snapshot.customVariables);
    setDefaultResourceTemplateId(snapshot.defaultResourceTemplateId);
  };

  if (!editing) return null;

  return (
    <Dialog open={Boolean(editing)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? "Edit" : "Create"} application config template</DialogTitle>
          <DialogDescription>Reset restores the editor to the state from when it was opened or first imported.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name">
              <Input value={name} onChange={(event) => setName(event.target.value)} {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS} />
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
            <Input value={description} onChange={(event) => setDescription(event.target.value)} {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS} />
          </Field>
          <div className="flex items-center justify-between">
            <Label>Payload JSON</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const confirmed = window.confirm(
                    "Reset will overwrite all current settings with the initial template state. Continue?"
                  );
                  if (!confirmed) return;
                  applyEditorSnapshot(resetSnapshot);
                  setVariableEditorKey((key) => key + 1);
                }}
              >
                <RotateCcw data-icon="inline-start" />
                Reset
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
                    const snapshot = createEditorSnapshot(imported);
                    applyEditorSnapshot(snapshot);
                    setResetSnapshot(snapshot);
                    setVariableEditorKey((key) => key + 1);
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
            {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS}
          />
          <VariableEditor
            key={`${template?.id ?? "new-template"}-${variableEditorKey}`}
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
          index={index}
          total={rows.length}
          variable={variable}
          onChange={(patch) =>
            commitRows(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
          }
          onMoveUp={() => {
            if (index === 0) return;
            const nextRows = [...rows];
            [nextRows[index - 1], nextRows[index]] = [nextRows[index], nextRows[index - 1]];
            commitRows(nextRows);
          }}
          onMoveDown={() => {
            if (index === rows.length - 1) return;
            const nextRows = [...rows];
            [nextRows[index], nextRows[index + 1]] = [nextRows[index + 1], nextRows[index]];
            commitRows(nextRows);
          }}
          onRemove={() => commitRows(rows.filter((_, rowIndex) => rowIndex !== index))}
        />
      ))}
    </div>
  );
}

function VariableRow({
  index,
  total,
  variable,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove
}: {
  index: number;
  total: number;
  variable: EditableVariable;
  onChange: (patch: Partial<EditableVariable>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const [optionsDraft, setOptionsDraft] = useState((variable.options ?? []).join(", "));

  useEffect(() => {
    setOptionsDraft((variable.options ?? []).join(", "));
  }, [variable.editorId, variable.options]);

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="grid grid-cols-[44px_minmax(160px,1fr)_150px_minmax(180px,1fr)_110px_auto] items-center gap-2">
        <div className="rounded-md bg-muted px-2 py-2 text-center text-sm font-medium text-muted-foreground">
          #{index + 1}
        </div>
        <Input
          placeholder="Variable name"
          value={variable.name}
          onChange={(event) => onChange({ name: event.target.value })}
          {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS}
        />
        <Select
          value={variable.type}
          onValueChange={(value: TemplateVariableType) => {
            const format =
              value === "date" || value === "dateTime"
                ? defaultFormatForVariableType(value)
                : value === "boolean"
                  ? defaultBooleanOutputStyle()
                  : value === "enum"
                    ? inferEnumDisplayFormat(variable.options?.length ?? 0)
                    : undefined;
            const defaultValue = value === "boolean" ? false : undefined;

            onChange({
              type: value,
              defaultValue,
              options: undefined,
              format,
              description: value === "boolean" ? describeBooleanVariable(format, defaultValue) : undefined
            });
          }}
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
        <DefaultValueField variable={variable} onChange={onChange} />
        <label className="flex items-center justify-center gap-2 text-sm">
          <Checkbox checked={Boolean(variable.required)} onCheckedChange={(checked) => onChange({ required: Boolean(checked) })} />
          Required
        </label>
        <div className="flex justify-end gap-1">
          <VariableDescriptionControl
            variableName={variable.name}
            description={variable.description}
            onChange={(description) => onChange({ description })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${variable.name} up`}
            disabled={index === 0}
            onClick={onMoveUp}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${variable.name} down`}
            disabled={index === total - 1}
            onClick={onMoveDown}
          >
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${variable.name}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>

      {variable.type === "enum" && (
        <div className="flex items-center gap-2">
          <Select
            value={variable.format ?? inferEnumDisplayFormat(variable.options?.length ?? 0)}
            onValueChange={(value) => onChange({ format: value })}
          >
            <SelectTrigger className="w-[8.5rem] shrink-0">
              <SelectValue placeholder="Format" />
            </SelectTrigger>
            <SelectContent>
              {ENUM_DISPLAY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="min-w-0 flex-1"
            placeholder="Options, comma-separated"
            value={optionsDraft}
            onChange={(event) => setOptionsDraft(event.target.value)}
            {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS}
            onBlur={() =>
              onChange({
                options: optionsDraft
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean)
              })
            }
          />
        </div>
      )}

      {variable.type === "multiEnum" && (
        <Input
          placeholder="Options, comma-separated"
          value={optionsDraft}
          onChange={(event) => setOptionsDraft(event.target.value)}
          {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS}
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
          {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS}
        />
      )}

      {variable.type === "boolean" && (
        <div className="grid items-start gap-2 sm:grid-cols-[220px_minmax(0,1fr)]">
          <Select
            value={variable.format ?? defaultBooleanOutputStyle()}
            onValueChange={(value) =>
              onChange({
                format: value,
                description: describeBooleanVariable(value, variable.defaultValue as boolean | undefined)
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Output format" />
            </SelectTrigger>
            <SelectContent>
              {BOOLEAN_OUTPUT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {variable.description}
          </p>
        </div>
      )}
    </div>
  );
}

function VariableDescriptionControl({
  variableName,
  description,
  onChange
}: {
  variableName: string;
  description?: string;
  onChange: (description: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(description ?? "");
  const tooltip = description?.trim() || "Add variable description";

  const updateOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setDraft(description ?? "");
    }
  };

  return (
    <Tooltip>
      <Popover open={open} onOpenChange={updateOpen}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Edit ${variableName} description`}
              className={description ? "text-primary" : undefined}
            >
              <CircleHelp />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <div className="space-y-1">
            <Label>Description for {variableName}</Label>
            <Textarea
              className="min-h-24"
              placeholder="Optional description shown on hover in Submit Job."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => updateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange(draft.trim() || undefined);
                setOpen(false);
              }}
            >
              Confirm
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
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
    const format = parseBooleanOutputStyle(variable.format);
    const defaultValue = resolveBooleanDefaultValue(variable.defaultValue as boolean | undefined);
    const defaultOutput = formatBooleanValue(defaultValue, format);

    return (
      <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm">
        <Checkbox
          checked={defaultValue}
          onCheckedChange={(checked) =>
            onChange({
              defaultValue: Boolean(checked),
              description: describeBooleanVariable(variable.format, Boolean(checked))
            })
          }
        />
        <span className="text-muted-foreground">Default</span>
        <span className="font-mono text-foreground">{defaultOutput}</span>
      </label>
    );
  }

  if (variable.type === "number") {
    return (
      <Input
        type="number"
        placeholder="Default"
        value={variable.defaultValue === undefined ? "" : String(variable.defaultValue)}
        onChange={(event) =>
          onChange({ defaultValue: event.target.value === "" ? undefined : Number(event.target.value) })
        }
      />
    );
  }

  if (variable.type === "enum") {
    const options = variable.options ?? [];
    return (
      <Select
        value={variable.defaultValue === undefined ? "" : String(variable.defaultValue)}
        onValueChange={(value) => onChange({ defaultValue: value })}
      >
        <SelectTrigger>
          <SelectValue placeholder="Default" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (variable.type === "multiEnum") {
    return (
      <Input
        placeholder="Default values"
        value={Array.isArray(variable.defaultValue) ? variable.defaultValue.join(", ") : ""}
        {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS}
        onChange={(event) =>
          onChange({
            defaultValue: event.target.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          })
        }
      />
    );
  }

  return (
    <Input
      placeholder="Default"
      value={variable.defaultValue === undefined ? "" : String(variable.defaultValue)}
      onChange={(event) => onChange({ defaultValue: event.target.value || undefined })}
      {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS}
    />
  );
}

function toEditableRows(variables: TemplateVariableDefinition[]): EditableVariable[] {
  return variables.map((variable) => {
    const format =
      variable.format ??
      (variable.type === "date" || variable.type === "dateTime"
        ? defaultFormatForVariableType(variable.type)
        : variable.type === "boolean"
          ? defaultBooleanOutputStyle()
          : variable.type === "enum"
            ? parseEnumDisplayFormat(undefined, variable.options ?? [])
            : undefined);

    return {
      ...variable,
      required: variable.required ?? true,
      format,
      description:
        variable.type === "boolean" && !variable.description?.trim()
          ? describeBooleanVariable(format, variable.defaultValue as boolean | undefined)
          : variable.description,
      editorId: crypto.randomUUID()
    };
  });
}

function stripEditorId(variable: EditableVariable): TemplateVariableDefinition {
  const { editorId: _editorId, ...definition } = variable;
  if (definition.type === "boolean") {
    const format = definition.format ?? defaultBooleanOutputStyle();
    return {
      ...definition,
      format,
      description: definition.description?.trim() || describeBooleanVariable(format, definition.defaultValue as boolean | undefined)
    };
  }
  if (definition.type === "enum") {
    return {
      ...definition,
      format: parseEnumDisplayFormat(definition.format, definition.options ?? [])
    };
  }
  return definition;
}

function createEditorSnapshot(template?: Partial<TemplateEditorSnapshot>): TemplateEditorSnapshot {
  return {
    name: template?.name ?? "",
    description: template?.description ?? "",
    payloadTemplate: template?.payloadTemplate ?? defaultExamplePayload(),
    customVariables: template?.customVariables ?? [],
    defaultResourceTemplateId: template?.defaultResourceTemplateId
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
