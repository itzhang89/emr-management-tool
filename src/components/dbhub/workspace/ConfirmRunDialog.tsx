import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

/**
 * The question the gate asks before a statement runs.
 *
 * The tiers are the AI's permission model; for the person typing they are
 * advice, and this is where the advice is given. The final decision is theirs,
 * so the dialog has no third state and no countdown — it is a question with two
 * answers, and Cancel is the one the keyboard lands on.
 *
 * The statement is rendered here, from the editor, and never from anything the
 * backend or a model wrote. That matters most on the AI's side of this — an
 * approval prompt is exactly where an injected instruction would want to be
 * speaking — and it is the same rule here because it costs nothing to keep.
 *
 * "Always allow this kind" is deliberately absent. It would have to write a
 * rule, rules are keyed by verb or routine name, and for a bounded `DELETE`
 * there is no safe key: `DELETE: free` would loosen whole-table deletes too, and
 * a table name does not match at all. That needs table-scoped keys, and until
 * they exist the honest answer is one question at a time.
 */
export function ConfirmRunDialog({
  open,
  onOpenChange,
  sql,
  reason,
  onConfirm,
  pending = false
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Exactly what will run, as the editor holds it. */
  sql: string;
  /** Why the gate is asking — it differs by tier and says which. */
  reason: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Run this statement?")}</DialogTitle>
          <DialogDescription>{reason}</DialogDescription>
        </DialogHeader>

        <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
          {sql}
        </pre>

        <p className="text-xs text-muted-foreground">
          {t("Nothing has run yet.")}
        </p>

        <DialogFooter>
          <Button type="button" variant="outline" autoFocus onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button type="button" disabled={pending} onClick={onConfirm}>
            {t("Run it")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
