import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { getPageMeta, type PageId } from "@/pages/pageMeta";

export function PageHeader({
  pageId,
  actions,
  titleAddon
}: {
  pageId: PageId;
  actions?: ReactNode;
  titleAddon?: ReactNode;
}) {
  const { label, description } = getPageMeta(pageId);

  return (
    <div className={cn("shrink-0", actions && "flex items-start justify-between gap-4")}>
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
          {titleAddon}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}
