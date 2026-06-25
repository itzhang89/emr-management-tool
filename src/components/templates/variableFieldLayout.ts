import type { TemplateVariableDefinition } from "@/types/domain";

export const VARIABLE_FIELDS_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-4";

export function getVariableFieldLayoutClass(definition: TemplateVariableDefinition): string {
  if (definition.type === "multiEnum") {
    return "col-span-full";
  }

  if (definition.type === "enum") {
    const optionCount = definition.options?.length ?? 0;
    if (optionCount <= 4) {
      return "col-span-full sm:col-span-2";
    }
  }

  if (definition.type === "date" || definition.type === "dateTime") {
    return "col-span-full sm:col-span-2";
  }

  return "min-w-0";
}
