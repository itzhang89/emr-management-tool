import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useJobRuns } from "@/hooks/useEmr";
import { useTemplates } from "@/hooks/useTemplates";

export function DashboardPage() {
  const jobs = useJobRuns();
  const templates = useTemplates();
  const jobList = jobs.data ?? [];
  const runningJobs = jobList.filter((job) => job.state === "RUNNING").length;
  const recentJobs = jobList.length;
  const templateCount = (templates.data?.applicationTemplates.length ?? 0) + (templates.data?.resourceTemplates.length ?? 0);
  const latestJob = jobList[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description="Recent EMR on EKS activity and shortcuts." />
      <div className="grid grid-cols-3 gap-4">
        {[
          ["Running Jobs", String(runningJobs), "Live workloads"],
          ["Recent Jobs", String(recentJobs), "Local account history"],
          ["Templates", String(templateCount), "Ready to submit"]
        ].map(([title, value, description]) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent Jobs</CardTitle>
          <CardDescription>Jobs submitted from this workstation appear here.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          {latestJob ? (
            <>
              <Badge variant={latestJob.state === "FAILED" ? "destructive" : "secondary"}>{latestJob.state}</Badge>
              <span className="text-sm text-muted-foreground">{latestJob.name}</span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No local jobs have been submitted for the active account.</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
