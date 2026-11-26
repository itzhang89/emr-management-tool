import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useEffectiveVirtualClusterId } from "@/components/emr/VirtualClusterSelect";
import { Button } from "@/components/ui/button";
import { useJobConfigTemplates, useSubmitUser } from "@/hooks/useJobConfigTemplates";
import { useT } from "@/i18n";
import { readSubmitJobLastTemplate } from "@/services/submitJobFormStorage";
import { BUILTIN_TEMPLATE_VARIABLES, getBuiltinTemplateVariableValues } from "@/services/templateEngine";
import type { AwsAccountSummary } from "@/types/domain";

export function BuiltinTemplateVariables({ account }: { account: AwsAccountSummary }) {
  const t = useT();
  const { data: templates } = useJobConfigTemplates();
  const { data: submitUser } = useSubmitUser();
  const clusterId = useEffectiveVirtualClusterId();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const lastTemplateId = readSubmitJobLastTemplate(account.id);
  const template = templates?.find((item) => item.id === lastTemplateId) ?? templates?.[0];
  const values = getBuiltinTemplateVariableValues(template?.name, {
    virtualClusterId: clusterId ?? "",
    submitUser: submitUser ?? "user",
    account
  }, now);

  return (
    <section className="space-y-2">
      <h2 className="text-base font-medium">{t("Built-in variables")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("Read-only preview. template_name uses the actual name of the template selected for submission. example is the name of the sample template.")}
      </p>
      <dl className="divide-y rounded-md border">
        {BUILTIN_TEMPLATE_VARIABLES.map((name) => {
          const value = values[name];
          return (
            <div key={name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-2 px-3 py-1">
              <dt className="min-w-0 break-words text-sm">
                <code>{name}</code>
                {name === "AWS_USERNAME" && (
                  <p className="text-xs text-muted-foreground">{t("IAM user name (aws:username).")}</p>
                )}
              </dt>
              <dd className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 break-all text-sm">{value || t("Unavailable")}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={t("Copy value of {name}", { name })}
                  disabled={!value}
                  onClick={async () => {
                    if (!value) return;
                    try {
                      await navigator.clipboard.writeText(value);
                      toast.success(t("Copied to clipboard"));
                    } catch {
                      toast.error(t("Could not copy value."));
                    }
                  }}
                >
                  <Copy />
                </Button>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
