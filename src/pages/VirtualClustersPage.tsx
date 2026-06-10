import { RefreshCw, ZoomIn } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useVirtualClusters } from "@/hooks/useEmr";
import type { AppError } from "@/types/domain";

export function VirtualClustersPage() {
  const clusters = useVirtualClusters();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Virtual Clusters</h1>
          <p className="text-sm text-muted-foreground">Display EMR Virtual Clusters available in the selected region.</p>
        </div>
        <Button variant="outline" onClick={() => clusters.refetch()}>
          <RefreshCw data-icon="inline-start" />
          Refresh
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Clusters</CardTitle>
          <CardDescription>Cluster operations are read-only by design.</CardDescription>
        </CardHeader>
        <CardContent>
          {clusters.isLoading ? <p className="text-sm text-muted-foreground">Loading virtual clusters...</p> : null}
          {clusters.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage(clusters.error)}
            </p>
          ) : null}
          {clusters.data?.clusters.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No virtual clusters were returned for the active account and region.
            </p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Namespace</TableHead>
                <TableHead>EKS Cluster</TableHead>
                <TableHead>Created Time</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(clusters.data?.clusters ?? []).map((cluster) => (
                <TableRow key={cluster.id}>
                  <TableCell className="font-medium">{cluster.name}</TableCell>
                  <TableCell>
                    <Badge variant={cluster.state === "RUNNING" ? "default" : "secondary"}>{cluster.state}</Badge>
                  </TableCell>
                  <TableCell>{cluster.namespace}</TableCell>
                  <TableCell>{cluster.eksClusterName}</TableCell>
                  <TableCell>{new Date(cluster.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <ZoomIn data-icon="inline-start" />
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function errorMessage(error: unknown) {
  const appError = error as Partial<AppError>;
  if (appError.code === "DemoModeUnavailable") {
    return "Virtual clusters require the Tauri desktop runtime. Start with npm run tauri -- dev.";
  }
  return appError.message ?? "Failed to load virtual clusters.";
}
