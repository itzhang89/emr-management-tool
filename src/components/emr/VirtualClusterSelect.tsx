import { useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useVirtualClusters } from "@/hooks/useEmr";
import { useSessionStore } from "@/stores/sessionStore";
import { cn } from "@/lib/utils";

export function VirtualClusterSelect({ className }: { className?: string }) {
  const selectedVirtualClusterId = useSessionStore((state) => state.selectedVirtualClusterId);
  const setSelectedVirtualClusterId = useSessionStore((state) => state.setSelectedVirtualClusterId);
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

  if (!availableClusters.length) {
    return <p className="text-sm text-muted-foreground">No virtual clusters available.</p>;
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

export function useEffectiveVirtualClusterId() {
  const selectedVirtualClusterId = useSessionStore((state) => state.selectedVirtualClusterId);
  const clusters = useVirtualClusters();
  const availableClusters = clusters.data?.clusters ?? [];
  return (
    selectedVirtualClusterId ??
    availableClusters.find((cluster) => cluster.state === "RUNNING")?.id ??
    availableClusters[0]?.id ??
    ""
  );
}
