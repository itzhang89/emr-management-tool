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
  getVariableFieldLayoutClass,
  getVariableFieldLayoutStyle,
  VARIABLE_FIELDS_CONTAINER_CLASS
} from "@/components/templates/variableFieldLayout";
import { formatBooleanValue, parseBooleanOutputStyle } from "@/services/booleanVariable";
import type { TemplateVariableDefinition } from "@/types/domain";
import { defaultFormatForVariableType, formatWithPattern, parseDateValue } from "@/services/dateFormat";

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
      <Field label={label} description={definition.description} className={className} style={style}>
        <div className="flex h-10 items-center justify-between gap-3 rounded-md border bg-background px-3">
          <span className="font-mono text-xs text-muted-foreground">{output}</span>
          <Checkbox
            id={definition.name}
            checked={checked}
            onCheckedChange={(nextChecked) => onChange(Boolean(nextChecked))}
          />
        </div>
      </Field>
    );
  }

  if (definition.type === "number") {
    return (
      <Field label={label} description={definition.description} className={className} style={style}>
        <Input type="number" value={Number(value ?? 0)} onChange={(event) => onChange(Number(event.target.value))} />
      </Field>
    );
  }

  if (definition.type === "enum") {
    const options = definition.options ?? [];
    if (options.length <= 4) {
      return (
        <Field label={label} description={definition.description} className={className} style={style}>
          <RadioGroup value={String(value ?? "")} onValueChange={onChange} className="flex flex-nowrap gap-x-4">
            {options.map((option) => (
              <div key={option} className="flex items-center gap-2">
                <RadioGroupItem value={option} id={`${definition.name}-${option}`} />
                <Label htmlFor={`${definition.name}-${option}`} className="font-normal">
                  {option}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </Field>
      );
    }
    if (options.length <= 10) {
      return (
        <Field label={label} description={definition.description} className={className} style={style}>
          <Select value={String(value ?? "")} onValueChange={onChange}>
            <SelectTrigger>
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
        </Field>
      );
    }
    return (
      <EnumCombobox
        className={className}
        style={style}
        label={label}
        description={definition.description}
        options={options}
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
  value,
  onChange
}: {
  className?: string;
  style?: React.CSSProperties;
  label: string;
  description?: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Field label={label} description={description} className={className} style={style}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between">
            {value || `Select ${label}`}
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
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
    </Field>
  );
}

function DateTimeField({
  className,
  style,
  label,
  description,
  includeTime,
  displayFormat,
  value,
  onChange
}: {
  className?: string;
  style?: React.CSSProperties;
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
    <div className={cn("flex w-fit max-w-full flex-col items-start gap-2", className)} style={style}>
      <Label className="whitespace-nowrap">
        <VariableLabel label={label} description={description} />
      </Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-fit max-w-full justify-start text-left font-normal">
            <CalendarIcon className="mr-2 size-4 shrink-0" />
            {display}
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
