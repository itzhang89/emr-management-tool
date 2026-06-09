import { Copy, Square, ZoomIn } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCancelJobRun, useJobRuns } from "@/hooks/useEmr";
import { useSessionStore } from "@/stores/sessionStore";

export function JobHistoryPage() {
  const selectedVirtualClusterId = useSessionStore((state) => state.selectedVirtualClusterId);
  const setSelectedJobId = useSessionStore((state) => state.setSelectedJobId);
  const jobs = useJobRuns(selectedVirtualClusterId);
  const cancelJob = useCancelJobRun();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Job History</h1>
        <p className="text-sm text-muted-foreground">Review submitted jobs, clone configurations, or cancel active runs.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Submitted Jobs</CardTitle>
          <CardDescription>Local history and remote job states share the same view.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Name</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Created Time</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Virtual Cluster</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(jobs.data ?? []).map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">{job.name}</TableCell>
                  <TableCell>
                    <Badge variant={job.state === "FAILED" ? "destructive" : job.state === "RUNNING" ? "default" : "secondary"}>
                      {job.state}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(job.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{job.durationSeconds ? `${Math.round(job.durationSeconds / 60)}m` : "-"}</TableCell>
                  <TableCell>{job.virtualClusterName ?? job.virtualClusterId}</TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedJobId(job.id)}>
                      <ZoomIn data-icon="inline-start" />
                      Detail
                    </Button>
                    <Button variant="ghost" size="sm">
                      <Copy data-icon="inline-start" />
                      Clone
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelJob.mutate({ id: job.id, virtualClusterId: job.virtualClusterId })}
                    >
                      <Square data-icon="inline-start" />
                      Cancel
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {jobs.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    No submitted jobs yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
