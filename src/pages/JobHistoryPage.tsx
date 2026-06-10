import { Copy, Square, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCancelJobRun, useJobRuns } from "@/hooks/useEmr";
import { useSessionStore } from "@/stores/sessionStore";
import type { AppError } from "@/types/domain";

export function JobHistoryPage() {
  const selectedVirtualClusterId = useSessionStore((state) => state.selectedVirtualClusterId);
  const selectedJobId = useSessionStore((state) => state.selectedJobId);
  const setSelectedJobId = useSessionStore((state) => state.setSelectedJobId);
  const setClonedJobRequest = useSessionStore((state) => state.setClonedJobRequest);
  const jobs = useJobRuns(selectedVirtualClusterId);
  const cancelJob = useCancelJobRun();
  const selectedJob = jobs.data?.find((job) => job.id === selectedJobId);

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
          {jobs.isLoading ? <p className="text-sm text-muted-foreground">Loading job history...</p> : null}
          {jobs.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage(jobs.error)}
            </p>
          ) : null}
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (!job.sourceRequest) {
                          toast.error("This job was discovered from EMR and has no locally saved submit configuration to clone.");
                          return;
                        }
                        setClonedJobRequest(job.sourceRequest);
                      }}
                    >
                      <Copy data-icon="inline-start" />
                      Clone
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={cancelJob.isPending || !["PENDING", "SUBMITTED", "RUNNING"].includes(job.state)}
                      onClick={() =>
                        cancelJob.mutate(
                          { id: job.id, virtualClusterId: job.virtualClusterId },
                          {
                            onSuccess: () => toast.success("Cancel requested."),
                            onError: (error) => toast.error(errorMessage(error))
                          }
                        )
                      }
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
      {selectedJob ? (
        <Card>
          <CardHeader>
            <CardTitle>Job Detail</CardTitle>
            <CardDescription>{selectedJob.id}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <Detail label="Name" value={selectedJob.name} />
            <Detail label="State" value={selectedJob.state} />
            <Detail label="Virtual Cluster" value={selectedJob.virtualClusterName ?? selectedJob.virtualClusterId} />
            <Detail label="Created" value={new Date(selectedJob.createdAt).toLocaleString()} />
            <Detail label="Started" value={selectedJob.startedAt ? new Date(selectedJob.startedAt).toLocaleString() : "-"} />
            <Detail label="Finished" value={selectedJob.finishedAt ? new Date(selectedJob.finishedAt).toLocaleString() : "-"} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function errorMessage(error: unknown) {
  const appError = error as Partial<AppError>;
  if (appError.code === "DemoModeUnavailable") {
    return "Job history requires the Tauri desktop runtime. Start with npm run tauri -- dev.";
  }
  return appError.message ?? "Job operation failed.";
}
