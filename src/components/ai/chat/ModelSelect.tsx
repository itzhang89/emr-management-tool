import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useLlmProviders } from "@/hooks/useLlmConfig";

export type ModelOption = {
  /** `LlmModel.id` — what a session or assistant stores. */
  id: string;
  modelId: string;
  series: string;
  providerName: string;
  isDefault: boolean;
};

/**
 * Flattens the provider tree into selectable models.
 *
 * Only enabled providers holding an API key are offered, and only chat models: a
 * model behind a disabled or keyless provider cannot answer, and an image or
 * embedding model cannot hold a conversation, so listing either would only produce
 * a failure at send time.
 */
export function useModelOptions(): ModelOption[] {
  const providers = useLlmProviders();
  return useMemo(() => {
    const options: ModelOption[] = [];
    for (const provider of providers.data ?? []) {
      if (!provider.enabled) continue;
      if (provider.apiKeys.length === 0) continue;
      for (const model of provider.models) {
        if (model.modelType !== "chat") continue;
        options.push({
          id: model.id,
          modelId: model.modelId,
          series: model.series,
          providerName: provider.name,
          isDefault: model.isDefault
        });
      }
    }
    return options;
  }, [providers.data]);
}

export function findModelOption(options: ModelOption[], id?: string | null) {
  return options.find((option) => option.id === id);
}

/** The model a session falls back to when it has no explicit choice. */
export function defaultModelOption(options: ModelOption[]) {
  return options.find((option) => option.isDefault) ?? options[0];
}

/**
 * Model picker, grouped by provider then series so a long list stays navigable.
 */
export function ModelSelect({
  options,
  value,
  onChange,
  disabled,
  placeholder = "Select a model",
  className
}: {
  options: ModelOption[];
  value?: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const grouped = useMemo(() => {
    const byProvider = new Map<string, ModelOption[]>();
    for (const option of options) {
      const existing = byProvider.get(option.providerName);
      if (existing) {
        existing.push(option);
      } else {
        byProvider.set(option.providerName, [option]);
      }
    }
    return [...byProvider.entries()];
  }, [options]);

  return (
    <Select
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={disabled || options.length === 0}
    >
      <SelectTrigger className={className} aria-label="Model">
        <SelectValue placeholder={options.length === 0 ? "No models configured" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {grouped.map(([label, groupOptions]) => (
          <SelectGroup key={label}>
            <SelectLabel className="text-xs">{label}</SelectLabel>
            {groupOptions.map((option) => (
              <SelectItem key={option.id} value={option.id} className="font-mono text-xs">
                {option.modelId}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
