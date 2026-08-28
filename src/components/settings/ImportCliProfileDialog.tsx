import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useAwsCliProfiles } from "@/hooks/useAwsSettings";
import type { AwsCliProfileSummary } from "@/types/domain";

type ImportCliProfileDialogProps = {
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (profile: AwsCliProfileSummary) => void;
  renderError: (error: unknown) => ReactNode;
};

export function ImportCliProfileDialog({
  open,
  pending,
  onOpenChange,
  onImport,
  renderError
}: ImportCliProfileDialogProps) {
  const cliProfiles = useAwsCliProfiles();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import AWS CLI Profiles</DialogTitle>
          <DialogDescription>
            Import local AWS CLI static credential profiles. If the profile is missing a region or the name is already
            used, you will complete the details in the add-account form.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[min(60vh,26rem)] space-y-2 overflow-y-auto 2xl:space-y-2.5">
          {cliProfiles.isLoading ? <p className="text-sm text-muted-foreground">Scanning AWS CLI profiles...</p> : null}
          {cliProfiles.error ? renderError(cliProfiles.error) : null}
          {cliProfiles.data?.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground 2xl:p-4 2xl:text-sm">
              No AWS CLI profiles were found in the local credentials or config files.
            </p>
          ) : null}
          {cliProfiles.data?.map((profile) => (
            <div
              key={profile.profileName}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 2xl:px-4 2xl:py-3"
            >
              <div className="min-w-0 space-y-0.5 2xl:space-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-medium 2xl:text-base">{profile.profileName}</p>
                  {profile.canImport ? (
                    <Badge
                      variant="secondary"
                      className="px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide 2xl:text-[11px]"
                    >
                      Importable
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide 2xl:text-[11px]"
                    >
                      Unsupported
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground 2xl:text-sm">
                  {profile.region ?? "No region"} · {profile.accessKeyIdMasked ?? "No static access key"}
                </p>
                {profile.importError ? (
                  <p className="truncate text-[11px] text-muted-foreground/80 2xl:text-xs">{profile.importError}</p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 2xl:h-10 2xl:px-4"
                disabled={!profile.canImport || pending}
                onClick={() => onImport(profile)}
              >
                <Download data-icon="inline-start" className="size-4" />
                Import
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
