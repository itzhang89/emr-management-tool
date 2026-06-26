import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function LogDestinationPopover({ items }: { items: Array<[string, string]> }) {
  if (items.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Log destination details">
          <Info className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="grid gap-3 text-sm">
          {items.map(([label, value]) => (
            <div key={label}>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="break-all font-mono text-xs">{value}</div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
