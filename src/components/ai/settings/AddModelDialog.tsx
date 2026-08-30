import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { useAddLlmModels } from "@/hooks/useLlmConfig";
import { modelSeries } from "@/services/llmModelSeries";

/**
 * Adds one model by name, for endpoints whose /models cannot be reached or that
 * offer a model the listing omits.
 *
 * The series field previews what would be inferred from the id and stays
 * editable — the inference is a heuristic, so the user gets the last word.
 */
export function AddModelDialog({
  endpointId,
  open,
  onOpenChange
}: {
  endpointId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addModels = useAddLlmModels();
  const [modelId, setModelId] = useState("");
  const [series, setSeries] = useState("");
  const [seriesEdited, setSeriesEdited] = useState(false);

  useEffect(() => {
    if (open) {
      setModelId("");
      setSeries("");
      setSeriesEdited(false);
    }
  }, [open]);

  // Track the inferred series until the user takes over the field.
  useEffect(() => {
    if (!seriesEdited) {
      setSeries(modelId.trim() ? modelSeries(modelId) : "");
    }
  }, [modelId, seriesEdited]);

  const submit = () => {
    const trimmedId = modelId.trim();
    if (!trimmedId) {
      toast.error("Enter the model id the API expects.");
      return;
    }

    addModels.mutate(
      {
        endpointId,
        models: [{ modelId: trimmedId, series: series.trim() || undefined }]
      },
      {
        onSuccess: (added) => {
          if (added === 0) {
            toast.error(`${trimmedId} is already on this endpoint`);
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add model</DialogTitle>
          <DialogDescription>
            The model id is sent to the API as-is. The series only groups it in this list.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="model-id">Model id</Label>
            <Input
              id="model-id"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="claude-opus-4-8"
              className="font-mono text-sm"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="model-series">Series</Label>
            <Input
              id="model-series"
              value={series}
              onChange={(event) => {
                setSeriesEdited(true);
                setSeries(event.target.value);
              }}
              placeholder="claude-opus"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Inferred from the model id. Edit it if the grouping looks wrong.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={addModels.isPending}>
              {addModels.isPending ? "Adding..." : "Add model"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
