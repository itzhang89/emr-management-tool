import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description="Recent EMR on EKS activity and shortcuts." />
      <div className="grid grid-cols-3 gap-4">
        {[
          ["Running Jobs", "3", "Live workloads"],
          ["Recent Jobs", "18", "Last 24 hours"],
          ["Favorite Templates", "5", "Ready to submit"]
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
          <Badge variant="secondary">RUNNING</Badge>
          <span className="text-sm text-muted-foreground">Daily ETL is processing partition 2026-06-09.</span>
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
