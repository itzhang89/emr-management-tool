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
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Delete AWS account?")}</DialogTitle>
          <DialogDescription>
            {accountName ? (
              <>
                {t("This permanently removes")}{" "}
                <span className="font-medium text-foreground">{accountName}</span>{" "}
                {t("and its stored credentials from this app. This cannot be undone.")}
              </>
            ) : (
              t("This permanently removes the account and its stored credentials from this app. This cannot be undone.")
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? t("Deleting...") : t("Delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
