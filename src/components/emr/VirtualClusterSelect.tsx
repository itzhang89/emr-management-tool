import { useEffect } from "react";
import { VirtualClustersEmptyHint } from "@/components/emr/VirtualClustersEmptyHint";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useVirtualClusters } from "@/hooks/useEmr";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { formatVirtualClustersError } from "@/services/appErrorMessage";
import { useSessionStore } from "@/stores/sessionStore";

export function VirtualClusterSelect({ className }: { className?: string }) {
  const t = useT();
  const selectedVirtualClusterId = useSessionStore((state) => state.selectedVirtualClusterId);
  const setSelectedVirtualClusterId = useSessionStore((state) => state.setSelectedVirtualClusterId);
  const activeAccount = useActiveAwsAccount();
  const clusters = useVirtualClusters();
  const availableClusters = clusters.data?.clusters ?? [];
  const effectiveVirtualClusterId =
    selectedVirtualClusterId ??
    availableClusters.find((cluster) => cluster.state === "RUNNING")?.id ??
    availableClusters[0]?.id;

  useEffect(() => {
    if (selectedVirtualClusterId || !availableClusters.length) return;
    const defaultClusterId =
      availableClusters.find((cluster) => cluster.state === "RUNNING")?.id ?? availableClusters[0].id;
    setSelectedVirtualClusterId(defaultClusterId);
  }, [availableClusters, selectedVirtualClusterId, setSelectedVirtualClusterId]);

  if (clusters.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("Loading virtual clusters...")}</p>;
  }

  if (clusters.error) {
    return (
      <p className="max-w-md text-sm text-destructive">
        {formatVirtualClustersError(clusters.error, activeAccount.data?.region)}
      </p>
    );
  }

  if (!availableClusters.length) {
    return (
      <VirtualClustersEmptyHint
        compact
        className="max-w-md"
        accountName={activeAccount.data?.name}
        region={activeAccount.data?.region}
        awsAccountId={activeAccount.data?.identity?.account}
      />
    );
  }

  return (
    <Select value={effectiveVirtualClusterId} onValueChange={setSelectedVirtualClusterId}>
      {/* The tooltip sits on the trigger rather than around the Select: a Radix
          Select root renders no element of its own, so there is nothing for
          `TooltipTrigger asChild` to attach to. */}
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Narrower than it looks like it needs: cluster names are short, and
              the width it used to take came out of the search box beside it.
              Callers that want more ask for it through `className`. */}
          <SelectTrigger className={cn("w-[160px]", className)}>
            <SelectValue placeholder={t("Select virtual cluster")} />
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("Only job runs from this virtual cluster are listed")}</TooltipContent>
      </Tooltip>
      <SelectContent>
        {availableClusters.map((cluster) => (
          <SelectItem key={cluster.id} value={cluster.id}>
            {cluster.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function normalizeVirtualClusterId(virtualClusterId?: string) {
  const trimmed = virtualClusterId?.trim();
  return trimmed ? trimmed : undefined;
}

export function useEffectiveVirtualClusterId() {
  const selectedVirtualClusterId = useSessionStore((state) => state.selectedVirtualClusterId);
  const clusters = useVirtualClusters();
  const availableClusters = clusters.data?.clusters ?? [];
  const normalizedSelected = normalizeVirtualClusterId(selectedVirtualClusterId);
  return (
    normalizedSelected ??
    availableClusters.find((cluster) => cluster.state === "RUNNING")?.id ??
    availableClusters[0]?.id
  );
}
