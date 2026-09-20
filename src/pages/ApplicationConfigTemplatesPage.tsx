import { ArrowDown, ArrowUp, CircleHelp, Copy, Download, Edit2, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { JsonTemplateEditor } from "@/components/templates/JsonTemplateEditor";
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
import { useT } from "@/i18n";
import { defaultExamplePayload } from "@/services/jobConfigExamples";
import { buildKnownTemplateVariables } from "@/services/jsonTemplateVariables";
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
import { cn } from "@/lib/utils";

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
  const t = useT();
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
      toast.success(t("Application config template imported."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import template.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          {embedded ? (
            <h2 className="text-2xl font-semibold tracking-tight">{t("Application Config")}</h2>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">{t("Application Config")}</h1>
          )}
          <p className="text-sm text-muted-foreground">
            {t("Manage full EMR submit JSON templates with variable substitution.")}
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
            {t("Import")}
          </Button>
          <Button onClick={() => setEditing({})}>
            <Plus data-icon="inline-start" />
            {t("Template")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {items.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>{template.name}</CardTitle>
                {template.builtIn ? <Badge variant="secondary">{t("Built-in")}</Badge> : null}
              </div>
              <CardDescription>{template.description ?? t("No description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {(template.customVariables ?? []).length === 1
                  ? t("{count} variable", { count: (template.customVariables ?? []).length })
                  : t("{count} variables", { count: (template.customVariables ?? []).length })}
                {template.defaultResourceTemplateId
                  ? ` · ${t("default resource {id}", { id: template.defaultResourceTemplateId })}`
                  : ""}
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
                  aria-label={t("Export {name}", { name: template.name })}
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
                    if (saved) toast.success(t("Template exported."));
                  }}
                >
                  <Download />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Duplicate {name}", { name: template.name })}
                  onClick={() => duplicateTemplate.mutate(template.id)}
                >
                  <Copy />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Delete {name}", { name: template.name })}
                  onClick={async () => {
                    if (template.builtIn) {
                      toast.error("Built-in example templates are for reference and cannot be deleted.");
                      return;
                    }
                    try {
                      await deleteTemplate.mutateAsync(template.id);
                      toast.success(t("Application config template deleted."));
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
            toast.success(t("Application config template saved."));
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
  const t = useT();
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
  const customVariableNamesKey = customVariables
    .map((variable) => variable.name.trim())
    .filter(Boolean)
    .join("\0");
  const knownVariables = useMemo(
    () => buildKnownTemplateVariables(customVariableNamesKey ? customVariableNamesKey.split("\0") : []),
    [customVariableNamesKey]
  );

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
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {template ? t("Edit application config template") : t("Create application config template")}
          </DialogTitle>
          <DialogDescription>
            {t("Reset restores the editor to the state from when it was opened or first imported.")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("Name")}>
              <Input value={name} onChange={(event) => setName(event.target.value)} {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS} />
            </Field>
            <Field label={t("Default Resource Template")}>
              <Select value={defaultResourceTemplateId ?? ""} onValueChange={setDefaultResourceTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("Optional default resource")} />
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
          <Field label={t("Description")}>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS} />
          </Field>
          <div className="flex items-center justify-between">
            <Label>{t("Payload JSON")}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const confirmed = window.confirm(
                    t("Reset will overwrite all current settings with the initial template state. Continue?")
                  );
                  if (!confirmed) return;
                  applyEditorSnapshot(resetSnapshot);
                  setVariableEditorKey((key) => key + 1);
                }}
              >
                <RotateCcw data-icon="inline-start" />
                {t("Reset")}
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
                    toast.success(t("Template JSON imported into editor."));
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed to import JSON.");
                  }
                }}
              >
                <Upload data-icon="inline-start" />
                {t("Import JSON")}
              </Button>
            </div>
          </div>
          <JsonTemplateEditor
            value={payloadTemplate}
            onChange={setPayloadTemplate}
            knownVariables={knownVariables}
            className="min-h-[280px]"
          />
          <VariableEditor
            key={`${template?.id ?? "new-template"}-${variableEditorKey}`}
            variables={customVariables}
            onChange={setCustomVariables}
          />
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
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
            {t("Save")}
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
  const t = useT();
  const [rows, setRows] = useState<EditableVariable[]>(() => toEditableRows(variables));

  const commitRows = (nextRows: EditableVariable[]) => {
    setRows(nextRows);
    onChange(nextRows.map(stripEditorId));
  };

  return (
    <div className="min-w-0 max-w-full space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t("Custom Variables")}</Label>
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
          {t("Add Variable")}
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
  const t = useT();
  const [optionsDraft, setOptionsDraft] = useState((variable.options ?? []).join(", "));

  useEffect(() => {
    setOptionsDraft((variable.options ?? []).join(", "));
  }, [variable.editorId, variable.options]);

  return (
    <div className="min-w-0 space-y-3 overflow-hidden rounded-lg border p-3">
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_9.5rem_minmax(0,1fr)_auto] items-center gap-2">
        <div className="rounded-md bg-muted px-2 py-2 text-center text-sm font-medium text-muted-foreground">
          #{index + 1}
        </div>
        <Input
          className="min-w-0"
          placeholder={t("Variable name")}
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
          <SelectTrigger className="min-w-0 [&>span]:truncate">
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
        <div className="min-w-0">
          <DefaultValueField variable={variable} onChange={onChange} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <label className="flex items-center gap-1.5 whitespace-nowrap text-sm">
            <Checkbox
              checked={Boolean(variable.required)}
              onCheckedChange={(checked) => onChange({ required: Boolean(checked) })}
            />
            {t("Required")}
          </label>
          <VariableDescriptionControl
            variableName={variable.name}
            description={variable.description}
            onChange={(description) => onChange({ description })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("Move {name} up", { name: variable.name })}
            disabled={index === 0}
            onClick={onMoveUp}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("Move {name} down", { name: variable.name })}
            disabled={index === total - 1}
            onClick={onMoveDown}
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("Remove {name}", { name: variable.name })}
            onClick={onRemove}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {variable.type === "enum" && (
        <div className="flex min-w-0 items-center gap-2">
          <Select
            value={variable.format ?? inferEnumDisplayFormat(variable.options?.length ?? 0)}
            onValueChange={(value) => onChange({ format: value })}
          >
            <SelectTrigger className="w-[8.5rem] shrink-0">
              <SelectValue placeholder={t("Format")} />
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
            placeholder={t("Options, comma-separated")}
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
          className="min-w-0"
          placeholder={t("Options, comma-separated")}
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
          className="min-w-0 max-w-sm"
          placeholder={t("Format, e.g. YYYY-MM-DD")}
          value={variable.format ?? defaultFormatForVariableType(variable.type)}
          onChange={(event) => onChange({ format: event.target.value })}
          {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS}
        />
      )}

      {variable.type === "boolean" && (
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
          <Select
            value={variable.format ?? defaultBooleanOutputStyle()}
            onValueChange={(value) =>
              onChange({
                format: value,
                description: describeBooleanVariable(value, variable.defaultValue as boolean | undefined)
              })
            }
          >
            <SelectTrigger className="w-[11rem] shrink-0">
              <SelectValue placeholder={t("Output format")} />
            </SelectTrigger>
            <SelectContent className="w-[var(--radix-select-trigger-width)]">
              {BOOLEAN_OUTPUT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="min-w-0 max-w-md text-xs leading-relaxed text-muted-foreground sm:pt-2">
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(description ?? "");
  const tooltip = description?.trim() || t("Add variable description");

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
              aria-label={t("Edit {name} description", { name: variableName })}
              className={cn("size-8", description ? "text-primary" : undefined)}
            >
              <CircleHelp className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <div className="space-y-1">
            <Label>{t("Description for {name}", { name: variableName })}</Label>
            <Textarea
              className="min-h-24"
              placeholder={t("Optional description shown on hover in Submit Job.")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              {...TEMPLATE_EDITOR_TEXT_INPUT_PROPS}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => updateOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange(draft.trim() || undefined);
                setOpen(false);
              }}
            >
              {t("Confirm")}
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
  const t = useT();

  if (variable.type === "boolean") {
    const format = parseBooleanOutputStyle(variable.format);
    const defaultValue = resolveBooleanDefaultValue(variable.defaultValue as boolean | undefined);
    const defaultOutput = formatBooleanValue(defaultValue, format);

    return (
      <label className="flex h-10 min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md border px-3 text-sm">
        <Checkbox
          checked={defaultValue}
          onCheckedChange={(checked) =>
            onChange({
              defaultValue: Boolean(checked),
              description: describeBooleanVariable(variable.format, Boolean(checked))
            })
          }
        />
        <span className="shrink-0 text-muted-foreground">{t("Default")}</span>
        <span className="min-w-0 truncate font-mono text-foreground">{defaultOutput}</span>
      </label>
    );
  }

  if (variable.type === "number") {
    return (
      <Input
        className="min-w-0"
        type="number"
        placeholder={t("Default")}
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
        <SelectTrigger className="min-w-0 [&>span]:truncate">
          <SelectValue placeholder={t("Default")} />
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
        className="min-w-0"
        placeholder={t("Default values")}
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
      className="min-w-0"
      placeholder={t("Default")}
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
