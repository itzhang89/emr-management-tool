import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShortcutsReferenceList } from "@/components/help/ShortcutsReferenceList";
import { useT } from "@/i18n";
import { formatShortcutsHelpLabel } from "@/lib/keyboardShortcut";

export function ShortcutsDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Keyboard shortcuts")}</DialogTitle>
          <DialogDescription>
            {t("Open from Help → Keyboard Shortcuts, or press {shortcut} anytime.", {
              shortcut: formatShortcutsHelpLabel()
            })}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[min(70vh,32rem)] pr-3">
          <ShortcutsReferenceList />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
