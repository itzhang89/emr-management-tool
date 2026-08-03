import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

type DeleteAccountDialogProps = {
  open: boolean;
  accountName?: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function DeleteAccountDialog({
  open,
  accountName,
  pending,
  onOpenChange,
  onConfirm
}: DeleteAccountDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete AWS account?</DialogTitle>
          <DialogDescription>
            {accountName ? (
              <>
                This permanently removes <span className="font-medium text-foreground">{accountName}</span> and its stored
                credentials from this app. This cannot be undone.
              </>
            ) : (
              "This permanently removes the account and its stored credentials from this app. This cannot be undone."
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
