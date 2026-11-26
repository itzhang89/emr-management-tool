import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n";

export function DeleteVariableButton({ name, label, onDelete, className }: {
  name: string;
  label: string;
  onDelete: () => void;
  className?: string;
}) {
  const t = useT();
  const variableName = name.trim();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} className={className}>
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle className="break-words pr-6">
          {variableName ? t("Delete variable “{name}”?", { name: variableName }) : t("Delete this variable?")}
        </DialogTitle>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{t("Cancel")}</Button>
          </DialogClose>
          <Button type="button" variant="destructive" onClick={onDelete}>{t("Delete")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
