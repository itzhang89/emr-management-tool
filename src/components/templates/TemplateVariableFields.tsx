import { format } from "date-fns";
import { CalendarIcon, Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  COMPACT_BOOLEAN_CONTROL_CLASS,
  COMPACT_COMBOBOX_BUTTON_CLASS,
  COMPACT_FIELD_WRAPPER_CLASS,
  COMPACT_NUMBER_INPUT_CLASS,
  COMPACT_SELECT_TRIGGER_CLASS,
  getBooleanShellStyle,
  getDateShellStyle,
  getEnumSelectShellStyle,
  getNumberShellStyle,
  getRadioEnumShellStyle,
  getVariableFieldLayoutClass,
  getVariableFieldLayoutStyle,
  VARIABLE_FIELDS_CONTAINER_CLASS
} from "@/components/templates/variableFieldLayout";
import { formatBooleanValue, parseBooleanOutputStyle } from "@/services/booleanVariable";
import type { TemplateVariableDefinition } from "@/types/domain";
import { defaultFormatForVariableType, formatWithPattern, parseDateValue } from "@/services/dateFormat";
import { parseEnumDisplayFormat } from "@/services/enumVariable";

export function TemplateVariableFields({
  variables,
  values,
  onChange
}: {
  variables: TemplateVariableDefinition[];
  values: Record<string, string | number | boolean | string[]>;
  onChange: (next: Record<string, string | number | boolean | string[]>) => void;
}) {
  if (variables.length === 0) {
    return <p className="text-sm text-muted-foreground">This template has no custom variables.</p>;
  }

  return (
    <div className={VARIABLE_FIELDS_CONTAINER_CLASS}>
      {variables.map((definition) => (
        <VariableField
          key={definition.name}
          className={getVariableFieldLayoutClass(definition)}
          style={getVariableFieldLayoutStyle(definition, values[definition.name])}
          definition={definition}
          value={values[definition.name]}
          onChange={(value) => onChange({ ...values, [definition.name]: value })}
        />
      ))}
    </div>
  );
}

function VariableField({
  className,
  style,
  definition,
  value,
  onChange
}: {
  className?: string;
  style?: React.CSSProperties;
  definition: TemplateVariableDefinition;
  value: string | number | boolean | string[] | undefined;
  onChange: (value: string | number | boolean | string[]) => void;
}) {
  const label = definition.label ?? definition.name;

  if (definition.type === "boolean") {
    const checked = Boolean(value);
    const output = formatBooleanValue(checked, parseBooleanOutputStyle(definition.format));

    return (
      <CompactFieldShell
        label={label}
        description={definition.description}
        className={className}
        style={style}
        shellStyle={getBooleanShellStyle(definition)}
      >
        <div className={COMPACT_BOOLEAN_CONTROL_CLASS}>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{output}</span>
          <Checkbox
            id={definition.name}
            className="shrink-0"
            checked={checked}
            onCheckedChange={(nextChecked) => onChange(Boolean(nextChecked))}
          />
        </div>
      </CompactFieldShell>
    );
  }

  if (definition.type === "number") {
    const numberValue = Number(value ?? 0);

    return (
      <CompactFieldShell
        label={label}
        description={definition.description}
        className={className}
        style={style}
        shellStyle={getNumberShellStyle(definition)}
      >
        <Input
          type="number"
          className={COMPACT_NUMBER_INPUT_CLASS}
          value={numberValue}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </CompactFieldShell>
    );
  }

  if (definition.type === "enum") {
    const options = definition.options ?? [];
    const displayFormat = parseEnumDisplayFormat(definition.format, options);

    if (displayFormat === "radio") {
      return (
        <CompactFieldShell
          label={label}
          description={definition.description}
          className={className}
          style={style}
          shellStyle={getRadioEnumShellStyle(options)}
        >
          <RadioGroup value={String(value ?? "")} onValueChange={onChange} className="flex w-full flex-nowrap gap-x-4">
            {options.map((option) => (
              <div key={option} className="flex items-center gap-2">
                <RadioGroupItem value={option} id={`${definition.name}-${option}`} />
                <Label htmlFor={`${definition.name}-${option}`} className="font-normal">
                  {option}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CompactFieldShell>
      );
    }

    if (displayFormat === "select") {
      return (
        <CompactFieldShell
          label={label}
          description={definition.description}
          className={className}
          style={style}
          shellStyle={getEnumSelectShellStyle(definition)}
        >
          <Select value={String(value ?? "")} onValueChange={onChange}>
            <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}>
              <SelectValue placeholder={`Select ${label}`} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CompactFieldShell>
      );
    }

    return (
      <EnumCombobox
        className={className}
        style={style}
        label={label}
        description={definition.description}
        options={options}
        shellStyle={getEnumSelectShellStyle(definition)}
        value={String(value ?? "")}
        onChange={onChange}
      />
    );
  }

  if (definition.type === "multiEnum") {
    const options = definition.options ?? [];
    const selected = Array.isArray(value) ? value : [];
    return (
      <Field label={label} description={definition.description} className={className} style={style}>
        <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-3">
          {options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(option)}
                onCheckedChange={(checked) => {
                  onChange(checked ? [...selected, option] : selected.filter((item) => item !== option));
                }}
              />
              {option}
            </label>
          ))}
        </div>
      </Field>
    );
  }

  if (definition.type === "date" || definition.type === "dateTime") {
    return (
      <DateTimeField
        className={className}
        style={style}
        definition={definition}
        label={label}
        description={definition.description}
        includeTime={definition.type === "dateTime"}
        displayFormat={definition.format ?? defaultFormatForVariableType(definition.type)}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
      />
    );
  }

  return (
    <Field label={label} description={definition.description} className={className} style={style}>
      <Input
        value={String(value ?? "")}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function EnumCombobox({
  className,
  style,
  label,
  description,
  options,
  shellStyle,
  value,
  onChange
}: {
  className?: string;
  style?: React.CSSProperties;
  label: string;
  description?: string;
  options: string[];
  shellStyle: React.CSSProperties;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const displayText = value || `Select ${label}`;

  return (
    <CompactFieldShell
      label={label}
      description={description}
      className={className}
      style={style}
      shellStyle={shellStyle}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className={COMPACT_COMBOBOX_BUTTON_CLASS}
          >
            <span>{displayText}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>No option found.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 size-4", value === option ? "opacity-100" : "opacity-0")} />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </CompactFieldShell>
  );
}

function DateTimeField({
  className,
  style,
  definition,
  label,
  description,
  includeTime,
  displayFormat,
  value,
  onChange
}: {
  className?: string;
  style?: React.CSSProperties;
  definition: TemplateVariableDefinition;
  label: string;
  description?: string;
  includeTime: boolean;
  displayFormat: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = value ? parseDateValue(value) : undefined;
  const [time, setTime] = useState(selected ? format(selected, "HH:mm") : "00:00");

  const display = useMemo(() => {
    if (!selected) return `Pick ${label.toLowerCase()}`;
    return formatWithPattern(selected, displayFormat);
  }, [displayFormat, label, selected]);

  return (
    <CompactFieldShell
      label={label}
      description={description}
      className={className}
      style={style}
      shellStyle={getDateShellStyle(definition)}
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("w-full !justify-start gap-2 px-3 font-normal", COMPACT_SELECT_TRIGGER_CLASS)}
          >
            <CalendarIcon className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{display}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(date) => {
              if (!date) return;
              if (includeTime) {
                const [hours, minutes] = time.split(":").map(Number);
                date.setHours(hours, minutes, 0, 0);
              }
              onChange(date.toISOString());
            }}
          />
          {includeTime ? (
            <div className="border-t p-3">
              <Input
                type="time"
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                  if (!selected) return;
                  const next = new Date(selected);
                  const [hours, minutes] = event.target.value.split(":").map(Number);
                  next.setHours(hours, minutes, 0, 0);
                  onChange(next.toISOString());
                }}
              />
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </CompactFieldShell>
  );
}

function CompactFieldShell({
  label,
  description,
  children,
  className,
  style,
  shellStyle
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  shellStyle?: React.CSSProperties;
}) {
  return (
    <div className={cn(COMPACT_FIELD_WRAPPER_CLASS, className)} style={{ ...style, ...shellStyle }}>
      <Label className="w-full min-w-0 truncate" title={label}>
        <VariableLabel label={label} description={description} />
      </Label>
      {children}
    </div>
  );
}

function Field({
  label,
  description,
  children,
  className,
  style
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn("min-w-0 space-y-2", className)} style={style}>
      <Label className="whitespace-nowrap">
        <VariableLabel label={label} description={description} />
      </Label>
      {children}
    </div>
  );
}

function VariableLabel({ label, description }: { label: string; description?: string }) {
  if (!description) {
    return <>{label}</>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-4">{label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{description}</TooltipContent>
    </Tooltip>
  );
}
