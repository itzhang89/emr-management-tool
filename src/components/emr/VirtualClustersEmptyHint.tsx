import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

type VirtualClustersEmptyHintProps = {
  accountName?: string;
  region?: string;
  awsAccountId?: string;
  compact?: boolean;
  className?: string;
};

export function VirtualClustersEmptyHint({
  accountName,
  region,
  awsAccountId,
  compact = false,
  className
}: VirtualClustersEmptyHintProps) {
  const t = useT();
  const regionLabel = region ?? t("the selected region");

  if (compact) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {t("No virtual clusters in")} <span className="font-medium text-foreground">{regionLabel}</span>
        {t(". A wrong account region is the most common cause—open Settings and confirm it matches the region shown in the AWS Console for your EMR virtual cluster.")}
      </p>
    );
  }

  return (
    <div className={cn("rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground", className)}>
      <p className="font-medium">{t("No virtual clusters in {region}", { region: regionLabel })}</p>
      <p className="mt-2 text-muted-foreground">
        {t("The AWS API call succeeded but returned an empty list. This usually means the region configured for this account does not match where your EMR virtual cluster was created—not missing IAM permissions.")}
      </p>
      <dl className="mt-3 grid gap-1 text-sm">
        {accountName ? (
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <dt className="text-muted-foreground">{t("Account")}</dt>
            <dd className="font-medium">{accountName}</dd>
          </div>
        ) : null}
        <div className="grid grid-cols-[120px_1fr] gap-2">
          <dt className="text-muted-foreground">{t("Region")}</dt>
          <dd className="font-medium">{regionLabel}</dd>
        </div>
        {awsAccountId ? (
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <dt className="text-muted-foreground">{t("AWS account")}</dt>
            <dd className="font-medium">{awsAccountId}</dd>
          </div>
        ) : null}
      </dl>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
        <li>{t("Open AWS Console → EMR → Virtual clusters and note the region shown there.")}</li>
        <li>
          {t("In Settings, make sure this account uses that same region. Re-import the AWS CLI profile to refresh the region, or delete the account and add it again with the correct region.")}
        </li>
        <li>
          {t("Verify in a terminal:")}{" "}
          <code className="rounded bg-background/80 px-1 py-0.5 text-xs text-foreground">
            aws emr-containers list-virtual-clusters --region &lt;console-region&gt; --profile &lt;profile&gt;
          </code>
        </li>
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        {t("If the CLI command returns clusters but this app does not, open Help → View Logs. If the API is denied instead of empty, grant")}{" "}
        <code className="text-foreground">emr-containers:ListVirtualClusters</code>.
      </p>
    </div>
  );
}
