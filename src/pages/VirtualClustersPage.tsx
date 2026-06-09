import { RefreshCw, ZoomIn } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useVirtualClusters } from "@/hooks/useEmr";
import { useSessionStore } from "@/stores/sessionStore";

export function VirtualClustersPage() {
  const region = useSessionStore((state) => state.region);
  const clusters = useVirtualClusters(region);

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
              {(clusters.data ?? []).map((cluster) => (
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
