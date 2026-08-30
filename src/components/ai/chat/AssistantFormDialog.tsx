import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { accentClasses, ACCENT_NAMES } from "@/components/ai/chat/MessageBubble";
import { ModelSelect, useModelOptions } from "@/components/ai/chat/ModelSelect";
import { useCreateChatAssistant, useUpdateChatAssistant } from "@/hooks/useChat";
import { cn } from "@/lib/utils";
import type { ChatAssistant } from "@/types/domain";

/** Tool names the MCP server exposes, all read-only. */
const AVAILABLE_TOOLS = [
  "analyze_job_failure",
  "find_job",
  "describe_job",
  "list_accounts",
  "list_job_log_objects",
  "get_job_log_text"
];

export function AssistantFormDialog({
  assistant,
  open,
  onOpenChange
}: {
  /** null creates a new assistant. */
  assistant: ChatAssistant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createAssistant = useCreateChatAssistant();
  const updateAssistant = useUpdateChatAssistant();
  const modelOptions = useModelOptions();

  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [accent, setAccent] = useState("blue");
  const [restrictTools, setRestrictTools] = useState(false);
  const [enabledTools, setEnabledTools] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(assistant?.name ?? "");
    setSystemPrompt(assistant?.systemPrompt ?? "");
    setDefaultModelId(assistant?.defaultModelId ?? null);
    setAccent(assistant?.accent ?? "blue");
    // null means "every tool", which is the default for a new assistant.
    setRestrictTools(Boolean(assistant?.enabledTools));
    setEnabledTools(assistant?.enabledTools ?? [...AVAILABLE_TOOLS]);
  }, [open, assistant]);

  const toggleTool = (tool: string) => {
    setEnabledTools((current) =>
      current.includes(tool) ? current.filter((name) => name !== tool) : [...current, tool]
    );
  };

  const submit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Enter a name for this assistant.");
      return;
    }
    if (restrictTools && enabledTools.length === 0) {
      toast.error("Select at least one tool, or allow all of them.");
      return;
    }

    const tools = restrictTools ? enabledTools : null;

    if (assistant) {
      updateAssistant.mutate(
        {
          id: assistant.id,
          name: trimmedName,
          systemPrompt,
          defaultModelId: defaultModelId ?? undefined,
          // Explicit null clears the restriction back to all tools.
          enabledTools: tools,
          accent
        },
        {
          onSuccess: () => {
            toast.success(`${trimmedName} saved`);
            onOpenChange(false);
          },
          onError: (error: Error) => toast.error(error.message || "Failed to save the assistant")
        }
      );
      return;
    }

    createAssistant.mutate(
      {
        name: trimmedName,
        systemPrompt: systemPrompt.trim() || undefined,
        defaultModelId: defaultModelId ?? undefined,
        enabledTools: tools ?? undefined,
        accent
      },
      {
        onSuccess: () => {
          toast.success(`${trimmedName} added`);
          onOpenChange(false);
        },
        onError: (error: Error) => toast.error(error.message || "Failed to add the assistant")
      }
    );
  };

  const pending = createAssistant.isPending || updateAssistant.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{assistant ? `Configure ${assistant.name}` : "Add assistant"}</DialogTitle>
          <DialogDescription>
            An assistant is a preset: its instructions, default model, and which tools it may use.
          </DialogDescription>
        </DialogHeader>

        <form
          className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="assistant-name">Name</Label>
            <Input
              id="assistant-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Spark tuning"
            />
          </div>

          <div className="space-y-2">
            <Label>Avatar colour</Label>
            <div className="flex gap-2">
              {ACCENT_NAMES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={`Use the ${option} avatar colour`}
                  aria-pressed={accent === option}
                  onClick={() => setAccent(option)}
                  className={cn(
                    "size-7 rounded-full ring-offset-2 transition-shadow",
                    accentClasses(option),
                    accent === option && "ring-2 ring-ring"
                  )}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="assistant-prompt">Instructions</Label>
            <Textarea
              id="assistant-prompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="How this assistant should work, and in what order to use its tools."
              className="min-h-32 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label>Default model</Label>
            <ModelSelect
              options={modelOptions}
              value={defaultModelId}
              onChange={setDefaultModelId}
              placeholder="Use the globally-default model"
            />
            <p className="text-xs text-muted-foreground">
              A conversation can still override this from its header.
            </p>
          </div>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={restrictTools}
                onCheckedChange={(checked) => setRestrictTools(checked === true)}
              />
              Restrict which tools this assistant may use
            </label>
            {restrictTools && (
              <div className="space-y-1 rounded-md border p-2">
                {AVAILABLE_TOOLS.map((tool) => (
                  <label
                    key={tool}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={enabledTools.includes(tool)}
                      onCheckedChange={() => toggleTool(tool)}
                    />
                    <span className="font-mono">{tool}</span>
                  </label>
                ))}
              </div>
            )}
            {!restrictTools && (
              <p className="text-xs text-muted-foreground">
                All read-only MCP tools are available. None of them can change AWS state.
              </p>
            )}
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "Saving..." : assistant ? "Save" : "Add assistant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
