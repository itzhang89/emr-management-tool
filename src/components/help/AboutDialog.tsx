import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { appUpdater, type UpdateCheckResult } from "@/services/appUpdater";
import { getReleaseInfo } from "@/services/releaseInfo";

export function AboutDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const releaseInfo = getReleaseInfo();
  const [availableUpdate, setAvailableUpdate] = useState<Extract<UpdateCheckResult, { status: "available" }> | null>(
    null
  );
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    setAvailableUpdate(null);
    try {
      const result = await appUpdater.checkForUpdate();
      if (result.status === "unavailable") {
        toast.info(result.reason);
      } else if (result.status === "no-update") {
        toast.success("You are already using the latest version.");
      } else {
        setAvailableUpdate(result);
        toast.success(`Version ${result.version} is available.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to check for updates.");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const installUpdate = async () => {
    if (!availableUpdate) return;
    setInstallingUpdate(true);
    try {
      await availableUpdate.install();
      toast.success("Update installed. Restart the app to use the new version.");
      setAvailableUpdate(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to install update.");
    } finally {
      setInstallingUpdate(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>EMR on EKS Management Tool</DialogTitle>
            {releaseInfo.isDevelopment ? <Badge variant="secondary">Development</Badge> : null}
          </div>
          <DialogDescription>Desktop GUI for submitting and managing EMR on EKS jobs.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1 text-sm">
            <p>
              Version: <span className="font-medium">{releaseInfo.version}</span>
            </p>
            <p className="text-muted-foreground">Channel: {releaseInfo.channelLabel}</p>
          </div>

          {availableUpdate ? (
            <p className="text-sm text-muted-foreground">
              Upgrade available: <span className="font-medium text-foreground">{availableUpdate.version}</span>
            </p>
          ) : null}

          <Button
            type="button"
            variant="outline"
            disabled={checkingUpdate || installingUpdate}
            onClick={availableUpdate ? installUpdate : checkForUpdates}
          >
            {availableUpdate ? (
              <>
                <Download data-icon="inline-start" />
                {installingUpdate ? "Installing..." : `Install ${availableUpdate.version}`}
              </>
            ) : (
              <>
                <RefreshCw data-icon="inline-start" />
                {checkingUpdate ? "Checking..." : "Check for updates"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
