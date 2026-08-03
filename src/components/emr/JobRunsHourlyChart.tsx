import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from "@/components/ui/chart";
import type { HourlyJobCount } from "@/services/jobRunStats";
import { parseLocalDateKey } from "@/services/jobRunStats";

const chartConfig = {
  success: { label: "Success", color: "hsl(142 71% 35%)" },
  failed: { label: "Failed", color: "hsl(0 84% 60%)" }
} satisfies ChartConfig;

export function JobRunsHourlyChart({
  data,
  selectedDate,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  onToday
}: {
  data: HourlyJobCount[];
  selectedDate: string;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const total = data.reduce((sum, hour) => sum + hour.success + hour.failed, 0);
  const titleDate = format(parseLocalDateKey(selectedDate), "MMM d, yyyy");

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{titleDate} · Hourly</CardTitle>
          <CardDescription>Completed vs failed job counts by local hour.</CardDescription>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" aria-label="Previous day" disabled={!canGoPrev} onClick={onPrev}>
            <ChevronLeft />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onToday}>
            Today
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="Next day" disabled={!canGoNext} onClick={onNext}>
            <ChevronRight />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">No completed/failed jobs this day.</p>
        ) : null}
        <ChartContainer config={chartConfig} className="aspect-[21/9] w-full">
          <BarChart accessibilityLayer data={data} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={2} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="success" stackId="runs" fill="var(--color-success)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="failed" stackId="runs" fill="var(--color-failed)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
