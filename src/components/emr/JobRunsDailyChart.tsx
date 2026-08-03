import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from "@/components/ui/chart";
import type { DailyJobCount } from "@/services/jobRunStats";

const chartConfig = {
  success: { label: "Success", color: "hsl(142 71% 35%)" },
  failed: { label: "Failed", color: "hsl(0 84% 60%)" }
} satisfies ChartConfig;

export function JobRunsDailyChart({
  data,
  rangeDays,
  selectedDate,
  onSelectDate,
  syncing
}: {
  data: DailyJobCount[];
  rangeDays: number;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  syncing?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Job Runs ({rangeDays} days)</CardTitle>
          <CardDescription>Daily completed vs failed job counts for the selected cluster.</CardDescription>
        </div>
        {syncing ? <span className="text-xs text-muted-foreground">Syncing…</span> : null}
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-[21/9] w-full">
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ left: 8, right: 8, top: 8 }}
            onClick={(state) => {
              const index = typeof state?.activeIndex === "number" ? state.activeIndex : undefined;
              const date = index != null ? data[index]?.date : undefined;
              if (date) onSelectDate(date);
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="success" stackId="runs" fill="var(--color-success)" radius={[0, 0, 0, 0]} cursor="pointer">
              {data.map((entry) => (
                <Cell
                  key={`success-${entry.date}`}
                  fillOpacity={entry.date === selectedDate ? 1 : 0.55}
                  stroke={entry.date === selectedDate ? "var(--color-foreground)" : undefined}
                  strokeWidth={entry.date === selectedDate ? 1 : 0}
                />
              ))}
            </Bar>
            <Bar dataKey="failed" stackId="runs" fill="var(--color-failed)" radius={[2, 2, 0, 0]} cursor="pointer">
              {data.map((entry) => (
                <Cell
                  key={`failed-${entry.date}`}
                  fillOpacity={entry.date === selectedDate ? 1 : 0.55}
                  stroke={entry.date === selectedDate ? "var(--color-foreground)" : undefined}
                  strokeWidth={entry.date === selectedDate ? 1 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
