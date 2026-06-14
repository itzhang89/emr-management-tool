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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { TemplateVariableDefinition } from "@/types/domain";
import { defaultFormatForVariableType, formatWithPattern } from "@/services/dateFormat";

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
    <div className="grid grid-cols-2 gap-4">
      {variables.map((definition) => (
        <VariableField
          key={definition.name}
          definition={definition}
          value={values[definition.name]}
          onChange={(value) => onChange({ ...values, [definition.name]: value })}
        />
      ))}
    </div>
  );
}

function VariableField({
  definition,
  value,
  onChange
}: {
  definition: TemplateVariableDefinition;
  value: string | number | boolean | string[] | undefined;
  onChange: (value: string | number | boolean | string[]) => void;
}) {
  const label = definition.label ?? definition.name;

  if (definition.type === "boolean") {
    return (
      <div className="flex items-center justify-between rounded-lg border p-3">
        <Label htmlFor={definition.name}>{label}</Label>
        <Switch id={definition.name} checked={Boolean(value)} onCheckedChange={onChange} />
      </div>
    );
  }

  if (definition.type === "number") {
    return (
      <Field label={label}>
        <Input type="number" value={Number(value ?? 0)} onChange={(event) => onChange(Number(event.target.value))} />
      </Field>
    );
  }

  if (definition.type === "enum") {
    const options = definition.options ?? [];
    if (options.length <= 4) {
      return (
        <Field label={label}>
          <RadioGroup value={String(value ?? "")} onValueChange={onChange} className="gap-2">
            {options.map((option) => (
              <div key={option} className="flex items-center gap-2">
                <RadioGroupItem value={option} id={`${definition.name}-${option}`} />
                <Label htmlFor={`${definition.name}-${option}`}>{option}</Label>
              </div>
            ))}
          </RadioGroup>
        </Field>
      );
    }
    if (options.length <= 10) {
      return (
        <Field label={label}>
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
    return <EnumCombobox label={label} options={options} value={String(value ?? "")} onChange={onChange} />;
  }

  if (definition.type === "multiEnum") {
    const options = definition.options ?? [];
    const selected = Array.isArray(value) ? value : [];
    return (
      <Field label={label} className="col-span-2">
        <div className="grid grid-cols-2 gap-2">
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
        label={label}
        includeTime={definition.type === "dateTime"}
        displayFormat={definition.format ?? defaultFormatForVariableType(definition.type)}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
      />
    );
  }

  return (
    <Field label={label}>
      <Input value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function EnumCombobox({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Field label={label}>
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
  label,
  includeTime,
  displayFormat,
  value,
  onChange
}: {
  label: string;
  includeTime: boolean;
  displayFormat: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = value ? new Date(value) : undefined;
  const [time, setTime] = useState(selected ? format(selected, "HH:mm") : "00:00");

  const display = useMemo(() => {
    if (!selected) return `Pick ${label.toLowerCase()}`;
    return formatWithPattern(selected, displayFormat);
  }, [displayFormat, label, selected]);

  return (
    <Field label={label}>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start text-left font-normal">
            <CalendarIcon className="mr-2 size-4" />
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
    </Field>
  );
}

function Field({
  label,
  children,
  className
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
