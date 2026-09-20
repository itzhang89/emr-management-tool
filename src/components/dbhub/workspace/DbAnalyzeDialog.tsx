import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";

/**
 * Asks what to analyze before jumping to Chat. The instruction becomes the
 * leading lines of the auto-sent message; catalog context is appended by
 * {@link dbAnalysisPrompt}.
 */
export function DbAnalyzeDialog({
  open,
  onOpenChange,
  connectionName,
  focusLabel,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionName: string;
  /** Short label like `sales.orders` or the connection name alone. */
  focusLabel: string;
  onConfirm: (instruction: string) => void;
}) {
  const t = useT();
  const [instruction, setInstruction] = useState("");

  useEffect(() => {
    if (open) setInstruction("");
  }, [open]);

  const trimmed = instruction.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Analyze with AI")}</DialogTitle>
          <DialogDescription>
            {t("Opens a new Chat session for")}{" "}
            <span className="font-medium text-foreground">
              {connectionName}
              {focusLabel && focusLabel !== connectionName ? ` / ${focusLabel}` : ""}
            </span>
            {t(". Describe what you want the assistant to do.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="db-analyze-instruction">{t("Instruction")}</Label>
          <Textarea
            id="db-analyze-instruction"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={t("e.g. Count rows by status in the last 7 days and flag anomalies")}
            className="min-h-24"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && trimmed) {
                event.preventDefault();
                onConfirm(trimmed);
              }
            }}
          />
          <p className="text-xs text-muted-foreground">{t("⌘/Ctrl+Enter to send")}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            type="button"
            disabled={!trimmed}
            onClick={() => onConfirm(trimmed)}
          >
            {t("Open Chat")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
