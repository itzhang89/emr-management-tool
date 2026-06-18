import { useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { useVirtualClusters } from "@/hooks/useEmr";
import { cn } from "@/lib/utils";
import { formatVirtualClustersError } from "@/services/appErrorMessage";
import { useSessionStore } from "@/stores/sessionStore";

export function VirtualClusterSelect({ className }: { className?: string }) {
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
    return <p className="text-sm text-muted-foreground">Loading virtual clusters...</p>;
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
      <p className="max-w-md text-sm text-muted-foreground">
        No virtual clusters in {activeAccount.data?.region ?? "the selected region"}. Check Settings region and
        emr-containers:ListVirtualClusters.
      </p>
    );
  }

  return (
    <Select value={effectiveVirtualClusterId} onValueChange={setSelectedVirtualClusterId}>
      <SelectTrigger className={cn("w-[220px]", className)}>
        <SelectValue placeholder="Select virtual cluster" />
      </SelectTrigger>
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
