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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAddLlmModels, useUpdateLlmModel } from "@/hooks/useLlmConfig";
import { modelSeries } from "@/services/llmModelSeries";
import type { LlmModel, LlmModelCapabilities, LlmModelType } from "@/types/domain";

const MODEL_TYPES: Array<{ value: LlmModelType; label: string }> = [
  { value: "chat", label: "Chat" },
  { value: "image", label: "Image" },
  { value: "embed", label: "Embed" }
];

const DEFAULT_CAPABILITIES: LlmModelCapabilities = {
  reasoning: false,
  toolCalling: true,
  text: true,
  vision: false,
  audio: false,
  video: false
};

/** Blank rather than 0: an unset limit is unknown, not zero. */
function numberField(value?: number | null) {
  return value == null ? "" : String(value);
}

function parseLimit(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Adds a model by name or edits a stored one.
 *
 * One dialog for both because the fields are identical — the only difference is
 * whether the model id is still editable in practice (it is, in both).
 *
 * The capability checkboxes are recorded and shown on the model row, but they do
 * not shape outgoing requests: they come from user input or a gateway's guess, and
 * trimming a request by them would turn one mis-set box into "the model suddenly
 * cannot call tools".
 */
export function ModelFormDialog({
  providerId,
  model,
  open,
  onOpenChange
}: {
  providerId: string;
  /** Absent when adding. */
  model?: LlmModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addModels = useAddLlmModels();
  const updateModel = useUpdateLlmModel();
  const editing = model != null;

  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [group, setGroup] = useState("");
  const [groupEdited, setGroupEdited] = useState(false);
  const [modelType, setModelType] = useState<LlmModelType>("chat");
  const [capabilities, setCapabilities] = useState<LlmModelCapabilities>(DEFAULT_CAPABILITIES);
  const [contextWindow, setContextWindow] = useState("");
  const [maxInputTokens, setMaxInputTokens] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");

  useEffect(() => {
    if (!open) return;
    setModelId(model?.modelId ?? "");
    setDisplayName(model?.displayName ?? "");
    setGroup(model?.series ?? "");
    // An existing model's group is whatever was stored, so inference must not
    // start overwriting it as the id is edited.
    setGroupEdited(editing);
    setModelType(model?.modelType ?? "chat");
    setCapabilities(model?.capabilities ?? DEFAULT_CAPABILITIES);
    setContextWindow(numberField(model?.contextWindow));
    setMaxInputTokens(numberField(model?.maxInputTokens));
    setMaxOutputTokens(numberField(model?.maxOutputTokens));
  }, [open, model, editing]);

  // Track the inferred group until the user takes over the field.
  useEffect(() => {
    if (!groupEdited) {
      setGroup(modelId.trim() ? modelSeries(modelId) : "");
    }
  }, [modelId, groupEdited]);

  const toggle = (key: keyof LlmModelCapabilities) => {
    setCapabilities((current) => ({ ...current, [key]: !current[key] }));
  };

  const submit = () => {
    const trimmedId = modelId.trim();
    if (!trimmedId) {
      toast.error("Enter the model id the API expects.");
      return;
    }

    if (editing) {
      updateModel.mutate(
        {
          id: model.id,
          modelId: trimmedId,
          series: group.trim() || undefined,
          displayName: displayName.trim(),
          modelType,
          capabilities,
          contextWindow: parseLimit(contextWindow),
          maxInputTokens: parseLimit(maxInputTokens),
          maxOutputTokens: parseLimit(maxOutputTokens)
        },
        {
          onSuccess: () => {
            toast.success(`${trimmedId} saved`);
            onOpenChange(false);
          },
          onError: (error: Error) => toast.error(error.message || "Failed to save the model")
        }
      );
      return;
    }

    addModels.mutate(
      {
        providerId,
        models: [
          {
            modelId: trimmedId,
            series: group.trim() || undefined,
            displayName: displayName.trim() || undefined,
            modelType,
            capabilities,
            contextWindow: parseLimit(contextWindow),
            maxInputTokens: parseLimit(maxInputTokens),
            maxOutputTokens: parseLimit(maxOutputTokens)
          }
        ]
      },
      {
        onSuccess: (added) => {
          if (added === 0) {
            toast.error(`${trimmedId} is already on this provider`);
            return;
          }
          toast.success(`${trimmedId} added`);
          onOpenChange(false);
        },
        onError: (error: Error) => toast.error(error.message || "Failed to add the model")
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit model" : "Add model"}</DialogTitle>
          <DialogDescription>
            The model id is sent to the API as-is. The group only organises this list.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <section className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Basics
              </p>
              <div className="space-y-2">
                <Label htmlFor="model-id">Model id</Label>
                <Input
                  id="model-id"
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  placeholder="gemini-3.5-flash"
                  className="font-mono text-sm"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model-display-name">Display name</Label>
                <Input
                  id="model-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Gemini 3.5 Flash"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model-group">Group</Label>
                <Input
                  id="model-group"
                  value={group}
                  onChange={(event) => {
                    setGroupEdited(true);
                    setGroup(event.target.value);
                  }}
                  placeholder="Gemini"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Inferred from the model id. Edit it if the grouping looks wrong.
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Capabilities
              </p>
              <div className="space-y-2">
                <Label>Model type</Label>
                <RadioGroup
                  value={modelType}
                  onValueChange={(value) => setModelType(value as LlmModelType)}
                  className="flex gap-4"
                >
                  {MODEL_TYPES.map((option) => (
                    <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
                      <RadioGroupItem value={option.value} />
                      {option.label}
                    </label>
                  ))}
                </RadioGroup>
                {modelType !== "chat" && (
                  <p className="text-xs text-muted-foreground">
                    Only chat models appear in Chat's model picker.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Abilities</Label>
                <div className="flex flex-wrap gap-4">
                  <CapabilityBox
                    id="cap-reasoning"
                    label="Reasoning"
                    checked={capabilities.reasoning}
                    onToggle={() => toggle("reasoning")}
                  />
                  <CapabilityBox
                    id="cap-tools"
                    label="Tool calling"
                    checked={capabilities.toolCalling}
                    onToggle={() => toggle("toolCalling")}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Input modalities</Label>
                <div className="grid grid-cols-2 gap-2">
                  <CapabilityBox
                    id="cap-text"
                    label="Text"
                    checked={capabilities.text}
                    onToggle={() => toggle("text")}
                  />
                  <CapabilityBox
                    id="cap-vision"
                    label="Vision"
                    checked={capabilities.vision}
                    onToggle={() => toggle("vision")}
                  />
                  <CapabilityBox
                    id="cap-audio"
                    label="Audio"
                    checked={capabilities.audio}
                    onToggle={() => toggle("audio")}
                  />
                  <CapabilityBox
                    id="cap-video"
                    label="Video"
                    checked={capabilities.video}
                    onToggle={() => toggle("video")}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Recorded for reference. Requests are not yet trimmed to these.
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Token limits
              </p>
              <div className="space-y-2">
                <Label htmlFor="model-context-window">Context window</Label>
                <Input
                  id="model-context-window"
                  value={contextWindow}
                  onChange={(event) => setContextWindow(event.target.value)}
                  inputMode="numeric"
                  placeholder="128000"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model-max-input">Max input tokens</Label>
                <Input
                  id="model-max-input"
                  value={maxInputTokens}
                  onChange={(event) => setMaxInputTokens(event.target.value)}
                  inputMode="numeric"
                  placeholder="128000"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model-max-output">Max output tokens</Label>
                <Input
                  id="model-max-output"
                  value={maxOutputTokens}
                  onChange={(event) => setMaxOutputTokens(event.target.value)}
                  inputMode="numeric"
                  placeholder="4096"
                  className="font-mono text-sm"
                />
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={addModels.isPending || updateModel.isPending}>
              {addModels.isPending || updateModel.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CapabilityBox({
  id,
  label,
  checked,
  onToggle
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      {label}
    </label>
  );
}
