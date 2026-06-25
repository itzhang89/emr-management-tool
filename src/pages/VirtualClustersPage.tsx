import { RefreshCw, ZoomIn } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VirtualClustersEmptyHint } from "@/components/emr/VirtualClustersEmptyHint";
import { PageHeader } from "@/components/layout/PageHeader";
import { useVirtualClusters } from "@/hooks/useEmr";
import { useActiveAwsAccount } from "@/hooks/useAwsSettings";
import { formatVirtualClustersError } from "@/services/appErrorMessage";
import type { VirtualCluster } from "@/types/domain";

export function VirtualClustersPage() {
  const activeAccount = useActiveAwsAccount();
  const clusters = useVirtualClusters();
  const [selectedCluster, setSelectedCluster] = useState<VirtualCluster>();
  const activeRegion = activeAccount.data?.region;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        pageId="clusters"
        actions={
          <Button variant="outline" onClick={() => clusters.refetch()}>
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Clusters</CardTitle>
          <CardDescription>Cluster operations are read-only by design.</CardDescription>
        </CardHeader>
        <CardContent>
          {clusters.isLoading ? <p className="text-sm text-muted-foreground">Loading virtual clusters...</p> : null}
          {clusters.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {formatVirtualClustersError(clusters.error, activeRegion)}
            </p>
          ) : null}
          {clusters.data?.clusters.length === 0 && !clusters.isLoading && !clusters.error ? (
            <VirtualClustersEmptyHint
              accountName={activeAccount.data?.name}
              region={activeRegion}
              awsAccountId={activeAccount.data?.identity?.account}
            />
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
                    <Button variant="ghost" size="sm" onClick={() => setSelectedCluster(cluster)}>
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
      <VirtualClusterDetailsDialog
        cluster={selectedCluster}
        onOpenChange={(open) => !open && setSelectedCluster(undefined)}
      />
    </div>
  );
}

function VirtualClusterDetailsDialog({
  cluster,
  onOpenChange
}: {
  cluster?: VirtualCluster;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(cluster)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Virtual Cluster Details</DialogTitle>
          <DialogDescription>Read-only metadata for the selected EMR Virtual Cluster.</DialogDescription>
        </DialogHeader>
        {cluster ? (
          <div className="grid grid-cols-[140px_1fr] gap-3 text-sm">
            <Detail label="ID" value={cluster.id} />
            <Detail label="Name" value={cluster.name} />
            <Detail label="State" value={cluster.state} />
            <Detail label="Namespace" value={cluster.namespace} />
            <Detail label="EKS Cluster" value={cluster.eksClusterName} />
            <Detail label="Created Time" value={new Date(cluster.createdAt).toLocaleString()} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <>
      <div className="font-medium text-muted-foreground">{label}</div>
      <div className="break-all">{value ?? "-"}</div>
    </>
  );
}
